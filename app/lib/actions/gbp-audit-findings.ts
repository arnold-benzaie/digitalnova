"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpAuditFindings, gbpAudits, gbpFindingStatusHistory } from "@/db/audit-schema";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { dispatchAuditWebhookEvent } from "@/lib/gbp-audit/webhooks";
import { computeFullAuditScore, GBP_CORRECTION_STATUSES, GBP_FINDING_RESULTS, GBP_SEVERITIES } from "@/lib/gbp-audit/checklist";
import { getAuditSettings } from "@/lib/gbp-audit/settings";

/** Recomputes and persists the overall + 8 sub-scores for an audit from its current findings. Called after every finding save. */
async function recomputeAndPersistScore(auditId: string) {
  const [findings, settings] = await Promise.all([
    auditDb
      .select({ sectionCode: gbpAuditFindings.sectionCode, result: gbpAuditFindings.result, severity: gbpAuditFindings.severity })
      .from(gbpAuditFindings)
      .where(eq(gbpAuditFindings.auditId, auditId)),
    getAuditSettings(),
  ]);

  const score = computeFullAuditScore(findings, {
    critical: settings.severityPenaltyCritical,
    important: settings.severityPenaltyImportant,
    moderate: settings.severityPenaltyModerate,
    opportunity: settings.severityPenaltyOpportunity,
  });

  await auditDb
    .update(gbpAudits)
    .set({
      scoreOverall: score.overall,
      scoreCompliance: score.compliance,
      scoreCompleteness: score.completeness,
      scoreReputation: score.reputation,
      scoreContent: score.content,
      scoreLocalConsistency: score.localConsistency,
      scoreVisibility: score.visibility,
      scoreSuspensionRisk: score.suspensionRisk,
      scoreUserExperience: score.userExperience,
    })
    .where(eq(gbpAudits.id, auditId));

  return score;
}

/**
 * Upsert a single check's result — one row per (auditId, sectionCode,
 * checkKey), created on first save and updated afterward. Always
 * recomputes the audit's score before returning so the UI can show it
 * immediately without a second round-trip.
 */
export async function saveFinding(input: {
  auditId: string;
  sectionCode: string;
  checkKey: string;
  result: string;
  severity: string | null;
  explanation: string | null;
  source: string | null;
  recommendation: string | null;
  ownerName: string | null;
  etaDays: number | null;
}) {
  await requireAuditStaffRole();

  if (!GBP_FINDING_RESULTS.includes(input.result as (typeof GBP_FINDING_RESULTS)[number])) {
    throw new Error("Résultat de contrôle invalide.");
  }
  if (input.severity && !GBP_SEVERITIES.includes(input.severity as (typeof GBP_SEVERITIES)[number])) {
    throw new Error("Niveau de gravité invalide.");
  }

  const [existing] = await auditDb
    .select({ id: gbpAuditFindings.id })
    .from(gbpAuditFindings)
    .where(
      and(
        eq(gbpAuditFindings.auditId, input.auditId),
        eq(gbpAuditFindings.sectionCode, input.sectionCode),
        eq(gbpAuditFindings.checkKey, input.checkKey),
      ),
    )
    .limit(1);

  const values = {
    result: input.result,
    severity: input.severity,
    explanation: input.explanation,
    source: input.source,
    recommendation: input.recommendation,
    ownerName: input.ownerName,
    etaDays: input.etaDays,
    updatedAt: new Date(),
  };

  let findingId: string;
  if (existing) {
    findingId = existing.id;
    await auditDb.update(gbpAuditFindings).set(values).where(eq(gbpAuditFindings.id, existing.id));
  } else {
    const [created] = await auditDb
      .insert(gbpAuditFindings)
      .values({ auditId: input.auditId, sectionCode: input.sectionCode, checkKey: input.checkKey, ...values })
      .returning();
    findingId = created.id;
  }

  const score = await recomputeAndPersistScore(input.auditId);

  await logAuditActivity({
    action: "finding_saved",
    targetType: "gbp_audit_finding",
    targetId: findingId,
    metadata: { auditId: input.auditId, sectionCode: input.sectionCode, checkKey: input.checkKey, result: input.result },
  });

  revalidatePath(`/admin/audit/${input.auditId}`);
  revalidatePath(`/admin/audit/${input.auditId}/audit`);

  return { findingId, score };
}

export async function updateFindingCorrectionStatus(findingId: string, auditId: string, status: string) {
  await requireAuditStaffRole();
  if (!GBP_CORRECTION_STATUSES.includes(status as (typeof GBP_CORRECTION_STATUSES)[number])) {
    throw new Error("Statut de correction invalide.");
  }

  const [current] = await auditDb.select({ correctionStatus: gbpAuditFindings.correctionStatus }).from(gbpAuditFindings).where(eq(gbpAuditFindings.id, findingId)).limit(1);
  if (!current) throw new Error("Constat introuvable.");

  await auditDb.update(gbpAuditFindings).set({ correctionStatus: status, updatedAt: new Date() }).where(eq(gbpAuditFindings.id, findingId));
  await auditDb.insert(gbpFindingStatusHistory).values({ findingId, fromStatus: current.correctionStatus, toStatus: status });

  await logAuditActivity({
    action: "finding_correction_status_changed",
    targetType: "gbp_audit_finding",
    targetId: findingId,
    metadata: { auditId, from: current.correctionStatus, to: status },
  });
  await dispatchAuditWebhookEvent("gbp_audit.finding_status_changed", { findingId, auditId, status });

  revalidatePath(`/admin/audit/${auditId}`);
  revalidatePath(`/admin/audit/${auditId}/audit`);
  revalidatePath(`/admin/audit/${auditId}/timeline`);
}
