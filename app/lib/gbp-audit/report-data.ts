import { eq } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { gbpAuditFindings, gbpCompetitors, gbpCorrectionTasks, gbpServiceOffers } from "@/db/audit-schema";
import { GBP_AUDIT_CHECKS, GBP_AUDIT_SECTIONS, GBP_FINDING_RESULT_LABEL, SUBSCORE_LABEL } from "@/lib/gbp-audit/checklist";
import { compareToCompetitor } from "@/lib/gbp-audit/competitor-scoring";
import { getAuditSettings } from "@/lib/gbp-audit/settings";
import type { GbpAuditReportData, GbpAuditReportFinding } from "@/lib/pdf/gbp-audit-report";

const SECTION_TITLE = Object.fromEntries(GBP_AUDIT_SECTIONS.map((s) => [s.code, s.title]));
const CHECK_LABEL = Object.fromEntries(
  GBP_AUDIT_SECTIONS.flatMap((s) => GBP_AUDIT_CHECKS[s.code].map((c) => [`${s.code}:${c.key}`, c.label])),
);

export async function buildAuditReportData(input: {
  auditId: string;
  businessName: string;
  agentName: string | null;
  executiveSummary: string | null;
  clientSummary: string | null;
  score: {
    scoreOverall: number | null;
    scoreCompliance: number | null;
    scoreCompleteness: number | null;
    scoreReputation: number | null;
    scoreContent: number | null;
    scoreLocalConsistency: number | null;
    scoreVisibility: number | null;
    scoreSuspensionRisk: number | null;
    scoreUserExperience: number | null;
  };
  businessProfile: { rating: number | null; reviewCount: number | null; photoCount: number | null; postsRecent: boolean | null };
  clientFacing: boolean;
}): Promise<GbpAuditReportData> {
  const findings = await auditDb.select().from(gbpAuditFindings).where(eq(gbpAuditFindings.auditId, input.auditId));

  const toReportFinding = (f: (typeof findings)[number]): GbpAuditReportFinding => ({
    sectionLabel: SECTION_TITLE[f.sectionCode] ?? "Section archivée",
    checkLabel: CHECK_LABEL[`${f.sectionCode}:${f.checkKey}`] ?? "Contrôle archivé",
    result: f.result,
    severity: f.severity,
    explanation: f.explanation,
    recommendation: f.recommendation,
  });

  const criticalFindings = findings.filter((f) => f.severity === "critical" && f.result !== "compliant").map(toReportFinding);
  const importantFindings = findings.filter((f) => f.severity === "important" && f.result !== "compliant").map(toReportFinding);
  const compliantCount = findings.filter((f) => f.result === "compliant").length;
  const opportunityCount = findings.filter((f) => f.severity === "opportunity" || f.result === "improvement_recommended").length;

  const [correctionTasks, offers, competitors, settings] = await Promise.all([
    auditDb.select().from(gbpCorrectionTasks).where(eq(gbpCorrectionTasks.auditId, input.auditId)),
    auditDb.select().from(gbpServiceOffers).where(eq(gbpServiceOffers.active, true)),
    auditDb.select().from(gbpCompetitors).where(eq(gbpCompetitors.auditId, input.auditId)),
    getAuditSettings(),
  ]);

  const competitorComparisons = competitors.map((c) => ({
    name: c.name,
    comparison: compareToCompetitor(input.businessProfile, { rating: c.rating, reviewCount: c.reviewCount, photoCount: c.photoCount, postsRecent: c.postsRecent }),
  }));

  return {
    businessName: input.businessName,
    agentName: input.agentName,
    generatedAt: new Date(),
    score: input.score.scoreOverall,
    subScores: [
      { label: SUBSCORE_LABEL.compliance, value: input.score.scoreCompliance },
      { label: SUBSCORE_LABEL.completeness, value: input.score.scoreCompleteness },
      { label: SUBSCORE_LABEL.reputation, value: input.score.scoreReputation },
      { label: SUBSCORE_LABEL.content, value: input.score.scoreContent },
      { label: SUBSCORE_LABEL.localConsistency, value: input.score.scoreLocalConsistency },
      { label: SUBSCORE_LABEL.visibility, value: input.score.scoreVisibility },
      { label: SUBSCORE_LABEL.suspensionRisk, value: input.score.scoreSuspensionRisk },
      { label: SUBSCORE_LABEL.userExperience, value: input.score.scoreUserExperience },
    ],
    executiveSummary: input.clientFacing ? input.clientSummary : input.executiveSummary,
    compliantCount,
    criticalFindings,
    importantFindings,
    opportunityCount,
    correctionTasks: correctionTasks.map((t) => ({ phase: t.phase, title: t.title, priority: t.priority, ownerName: t.ownerName, etaDays: t.etaDays })),
    recommendedOffers: offers.map((o) => ({ label: o.label, description: o.description })),
    competitorComparisons,
    clientFacing: input.clientFacing,
    contactEmail: settings.reportContactEmail,
    footerNote: settings.reportFooterNote,
  };
}

export function findingResultLabel(result: string): string {
  return GBP_FINDING_RESULT_LABEL[result as keyof typeof GBP_FINDING_RESULT_LABEL] ?? "Non évalué";
}
