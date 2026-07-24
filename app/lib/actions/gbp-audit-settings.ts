"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpAuditSettings } from "@/db/audit-schema";
import { requireAuditAdminRole } from "@/lib/gbp-audit/session";
import { getAuditSettings } from "@/lib/gbp-audit/settings";
import { logAuditActivity } from "@/lib/gbp-audit/activity";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function positiveInt(formData: FormData, field: string, label: string, max: number): number {
  const raw = Number(formData.get(field));
  if (!Number.isFinite(raw) || raw < 1 || raw > max) {
    throw new Error(`${label} doit être un nombre entre 1 et ${max}.`);
  }
  return Math.round(raw);
}

async function applyUpdate(session: Awaited<ReturnType<typeof requireAuditAdminRole>>, patch: Partial<typeof gbpAuditSettings.$inferInsert>, action: string) {
  const settings = await getAuditSettings();
  await auditDb.update(gbpAuditSettings).set({ ...patch, updatedAt: new Date(), updatedByUserId: session.userId }).where(eq(gbpAuditSettings.id, settings.id));
  await logAuditActivity({ action, targetType: "gbp_audit_settings", targetId: settings.id, metadata: { updatedBy: session.email } });
  revalidatePath("/admin/audit/parametres");
}

export async function updateGeneralSettings(formData: FormData) {
  const session = await requireAuditAdminRole();
  const email = String(formData.get("reportContactEmail") ?? "").trim();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Adresse e-mail de contact invalide.");
  const footerNote = (formData.get("reportFooterNote") as string)?.trim() || null;
  if (footerNote && footerNote.length > 300) throw new Error("La note de pied de rapport est limitée à 300 caractères.");

  await applyUpdate(session, { reportContactEmail: email, reportFooterNote: footerNote }, "settings_general_updated");
}

export async function updateScoringSettings(formData: FormData) {
  const session = await requireAuditAdminRole();
  await applyUpdate(
    session,
    {
      severityPenaltyCritical: positiveInt(formData, "severityPenaltyCritical", "La pénalité « Critique »", 100),
      severityPenaltyImportant: positiveInt(formData, "severityPenaltyImportant", "La pénalité « Important »", 100),
      severityPenaltyModerate: positiveInt(formData, "severityPenaltyModerate", "La pénalité « Modéré »", 100),
      severityPenaltyOpportunity: positiveInt(formData, "severityPenaltyOpportunity", "La pénalité « Opportunité »", 100),
    },
    "settings_scoring_updated",
  );
}

export async function updateReportSettings(formData: FormData) {
  const session = await requireAuditAdminRole();
  await applyUpdate(
    session,
    {
      reportLinkDefaultExpiryDays: positiveInt(formData, "reportLinkDefaultExpiryDays", "L'expiration par défaut", 365),
      reportLinkMaxAttempts: positiveInt(formData, "reportLinkMaxAttempts", "Le nombre maximal de tentatives", 100),
    },
    "settings_pdf_updated",
  );
}

export async function updateNotificationSettings(formData: FormData) {
  const session = await requireAuditAdminRole();
  await applyUpdate(
    session,
    {
      notifyOnQuoteRequest: formData.get("notifyOnQuoteRequest") === "on",
      notifyOnAuditSubmitted: formData.get("notifyOnAuditSubmitted") === "on",
      notifyOnChangesRequested: formData.get("notifyOnChangesRequested") === "on",
      notifyOnAuditApproved: formData.get("notifyOnAuditApproved") === "on",
    },
    "settings_notifications_updated",
  );
}

export async function updateWebhookSettings(formData: FormData) {
  const session = await requireAuditAdminRole();
  await applyUpdate(session, { webhooksEnabled: formData.get("webhooksEnabled") === "on" }, "settings_webhooks_updated");
}

export async function updateSecuritySettings(formData: FormData) {
  const session = await requireAuditAdminRole();
  await applyUpdate(
    session,
    {
      rateLimitQuoteRequestsPerHour: positiveInt(formData, "rateLimitQuoteRequestsPerHour", "La limite de demandes de devis", 1000),
      rateLimitPortalViewsPerWindow: positiveInt(formData, "rateLimitPortalViewsPerWindow", "La limite de consultations du portail", 1000),
    },
    "settings_security_updated",
  );
}
