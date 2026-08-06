import { eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAuditEvidence, gbpAuditFindings, gbpAudits } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditChecklistView } from "@/components/gbp-audit/audit-checklist-view";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import type { FindingState } from "@/components/gbp-audit/finding-row";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";

export default async function AuditChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.checklist;

  // Both only depend on the route param, not on each other — fetch in parallel.
  const [[audit], findings] = await Promise.all([
    auditDb
      .select({ id: gbpAudits.id, businessName: auditBusinesses.legalName })
      .from(gbpAudits)
      .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
      .where(eq(gbpAudits.id, id))
      .limit(1),
    auditDb.select().from(gbpAuditFindings).where(eq(gbpAuditFindings.auditId, id)),
  ]);

  if (!audit) notFound();
  const findingIds = findings.map((f) => f.id);
  const evidenceCounts = findingIds.length
    ? await auditDb.select({ findingId: gbpAuditEvidence.findingId }).from(gbpAuditEvidence).where(inArray(gbpAuditEvidence.findingId, findingIds))
    : [];

  const evidenceCountByFinding = new Map<string, number>();
  for (const row of evidenceCounts) {
    evidenceCountByFinding.set(row.findingId, (evidenceCountByFinding.get(row.findingId) ?? 0) + 1);
  }

  const findingsBySection: Record<string, Record<string, FindingState>> = {};
  for (const f of findings) {
    findingsBySection[f.sectionCode] ??= {};
    findingsBySection[f.sectionCode][f.checkKey] = {
      id: f.id,
      result: f.result,
      severity: f.severity,
      explanation: f.explanation,
      source: f.source,
      recommendation: f.recommendation,
      ownerName: f.ownerName,
      etaDays: f.etaDays,
      correctionStatus: f.correctionStatus,
      evidenceCount: evidenceCountByFinding.get(f.id) ?? 0,
    };
  }

  return (
    <>
      <AdminPageHero title={audit.businessName} subtitle={t.pageLead} />
      <AuditTabs auditId={id} active="audit" locale={locale} />
      <AuditChecklistView auditId={id} findingsBySection={findingsBySection} locale={locale} />
    </>
  );
}
