"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAuditReports, gbpAudits, gbpReportAccessLinks } from "@/db/audit-schema";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { requireAuditStaffRole, requireAuditSupervisorRole } from "@/lib/gbp-audit/session";
import { dispatchAuditWebhookEvent } from "@/lib/gbp-audit/webhooks";
import { notifyAuditRoles } from "@/lib/gbp-audit/notify";
import { getAuditSettings } from "@/lib/gbp-audit/settings";

async function businessNameFor(auditId: string): Promise<string | null> {
  const [row] = await auditDb
    .select({ legalName: auditBusinesses.legalName })
    .from(gbpAudits)
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .where(eq(gbpAudits.id, auditId))
    .limit(1);
  return row?.legalName ?? null;
}

/** Agent submits the audit for supervisor review — locks nothing yet, just changes status + timestamp. */
export async function submitAuditForReview(auditId: string) {
  await requireAuditStaffRole();
  await auditDb.update(gbpAudits).set({ status: "pending_review", submittedAt: new Date() }).where(eq(gbpAudits.id, auditId));
  await logAuditActivity({ action: "audit_submitted", targetType: "gbp_audit", targetId: auditId });
  await dispatchAuditWebhookEvent("gbp_audit.audit_submitted", { auditId });

  const [name, settings] = await Promise.all([businessNameFor(auditId), getAuditSettings()]);
  if (settings.notifyOnAuditSubmitted) {
    await notifyAuditRoles(["admin", "supervisor"], {
      kind: "audit_submitted",
      title: "Audit soumis pour validation",
      body: name ? `${name} est prêt à être revu.` : null,
      href: `/admin/audit/${auditId}/rapport`,
    });
  }

  revalidatePath(`/admin/audit/${auditId}`);
  revalidatePath(`/admin/audit/${auditId}/rapport`);
}

/** Supervisor/admin only — quality gate before anything reaches a prospect. */
export async function approveAudit(auditId: string, clientSummary: string) {
  const session = await requireAuditSupervisorRole();

  if (!clientSummary.trim()) throw new Error("Un résumé pour le client est requis avant d'approuver.");

  await auditDb
    .update(gbpAudits)
    .set({ status: "approved", approvedAt: new Date(), approvedByName: session.fullName ?? session.email })
    .where(eq(gbpAudits.id, auditId));

  const [existingReport] = await auditDb.select({ id: gbpAuditReports.id }).from(gbpAuditReports).where(eq(gbpAuditReports.auditId, auditId)).limit(1);
  if (existingReport) {
    await auditDb.update(gbpAuditReports).set({ clientSummary }).where(eq(gbpAuditReports.id, existingReport.id));
  } else {
    await auditDb.insert(gbpAuditReports).values({ auditId, clientSummary });
  }

  await logAuditActivity({ action: "audit_approved", targetType: "gbp_audit", targetId: auditId, metadata: { approvedBy: session.fullName ?? session.email } });
  await dispatchAuditWebhookEvent("gbp_audit.audit_approved", { auditId });

  const [name, settings] = await Promise.all([businessNameFor(auditId), getAuditSettings()]);
  if (settings.notifyOnAuditApproved) {
    await notifyAuditRoles(["admin", "supervisor", "staff"], {
      kind: "audit_approved",
      title: "Audit approuvé",
      body: name ? `${name} est approuvé et prêt à être envoyé.` : null,
      href: `/admin/audit/${auditId}/rapport`,
    });
  }

  revalidatePath(`/admin/audit/${auditId}`);
  revalidatePath(`/admin/audit/${auditId}/rapport`);
}

export async function requestAuditChanges(auditId: string, note: string) {
  await requireAuditSupervisorRole();
  if (!note.trim()) throw new Error("Une note expliquant les corrections attendues est requise.");
  await auditDb.update(gbpAudits).set({ status: "changes_requested" }).where(eq(gbpAudits.id, auditId));
  await logAuditActivity({ action: "audit_changes_requested", targetType: "gbp_audit", targetId: auditId, metadata: { note } });

  const [name, settings] = await Promise.all([businessNameFor(auditId), getAuditSettings()]);
  if (settings.notifyOnChangesRequested) {
    await notifyAuditRoles(["admin", "supervisor", "staff"], {
      kind: "audit_changes_requested",
      title: "Corrections demandées",
      body: name ? `${name} : ${note}`.slice(0, 200) : note.slice(0, 200),
      href: `/admin/audit/${auditId}/rapport`,
    });
  }

  revalidatePath(`/admin/audit/${auditId}`);
  revalidatePath(`/admin/audit/${auditId}/rapport`);
}

/** Creates (or returns the existing active) secure token link for the approved report — this is what gets emailed to the prospect. */
export async function createOrGetReportAccessLink(auditId: string, expiresInDays: number | null) {
  await requireAuditStaffRole();

  const [report] = await auditDb.select().from(gbpAuditReports).where(eq(gbpAuditReports.auditId, auditId)).limit(1);
  if (!report) throw new Error("Le rapport doit être approuvé avant de générer un lien.");

  const [existing] = await auditDb
    .select()
    .from(gbpReportAccessLinks)
    .where(eq(gbpReportAccessLinks.reportId, report.id))
    .limit(1);

  if (existing && !existing.revokedAt) return existing;

  const settings = await getAuditSettings();
  const token = randomBytes(32).toString("base64url");
  const requestedExpiresInDays = expiresInDays ?? settings.reportLinkDefaultExpiryDays;
  const clampedExpiresInDays = Number.isFinite(requestedExpiresInDays) ? Math.min(365, Math.max(1, requestedExpiresInDays)) : null;
  const expiresAt = clampedExpiresInDays ? new Date(Date.now() + clampedExpiresInDays * 24 * 60 * 60 * 1000) : null;

  const [link] = await auditDb
    .insert(gbpReportAccessLinks)
    .values({ reportId: report.id, token, expiresAt, maxAttempts: settings.reportLinkMaxAttempts })
    .returning();

  await logAuditActivity({ action: "report_access_link_created", targetType: "gbp_report_access_link", targetId: link.id, metadata: { auditId } });
  revalidatePath(`/admin/audit/${auditId}/rapport`);
  return link;
}

export async function revokeReportAccessLink(linkId: string, auditId: string) {
  await requireAuditStaffRole();

  const [link] = await auditDb
    .select({ id: gbpReportAccessLinks.id })
    .from(gbpReportAccessLinks)
    .innerJoin(gbpAuditReports, eq(gbpReportAccessLinks.reportId, gbpAuditReports.id))
    .where(and(eq(gbpReportAccessLinks.id, linkId), eq(gbpAuditReports.auditId, auditId)))
    .limit(1);
  if (!link) throw new Error("Ce lien est introuvable pour cet audit.");

  await auditDb.update(gbpReportAccessLinks).set({ revokedAt: new Date() }).where(eq(gbpReportAccessLinks.id, linkId));
  await logAuditActivity({ action: "report_access_link_revoked", targetType: "gbp_report_access_link", targetId: linkId, metadata: { auditId } });
  revalidatePath(`/admin/audit/${auditId}/rapport`);
}

/** Marks the audit as sent (after staff has actually emailed the client — see spec §17, real email delivery is a later phase). */
export async function markAuditSent(auditId: string) {
  await requireAuditStaffRole();
  await auditDb.update(gbpAudits).set({ status: "sent", sentAt: new Date() }).where(eq(gbpAudits.id, auditId));
  await logAuditActivity({ action: "audit_sent", targetType: "gbp_audit", targetId: auditId });
  await dispatchAuditWebhookEvent("gbp_audit.report_sent", { auditId });
  revalidatePath(`/admin/audit/${auditId}`);
  revalidatePath(`/admin/audit/${auditId}/rapport`);
}
