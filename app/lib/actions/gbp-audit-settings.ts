"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpAuditSettings } from "@/db/audit-schema";
import { requireAuditAdminRole } from "@/lib/gbp-audit/session";
import { getAuditSettings } from "@/lib/gbp-audit/settings";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  fr: {
    outOfRange: (label: string, max: number) => `${label} doit être un nombre entre 1 et ${max}.`,
    invalidEmail: "Adresse e-mail de contact invalide.",
    footerNoteTooLong: "La note de pied de rapport est limitée à 300 caractères.",
  },
  en: {
    outOfRange: (label: string, max: number) => `${label} must be a number between 1 and ${max}.`,
    invalidEmail: "Invalid contact email address.",
    footerNoteTooLong: "The report footer note is limited to 300 characters.",
  },
} as const;

const LABELS = {
  fr: {
    severityPenaltyCritical: "La pénalité « Critique »",
    severityPenaltyImportant: "La pénalité « Important »",
    severityPenaltyModerate: "La pénalité « Modéré »",
    severityPenaltyOpportunity: "La pénalité « Opportunité »",
    reportLinkDefaultExpiryDays: "L'expiration par défaut",
    reportLinkMaxAttempts: "Le nombre maximal de tentatives",
    rateLimitQuoteRequestsPerHour: "La limite de demandes de devis",
    rateLimitPortalViewsPerWindow: "La limite de consultations du portail",
  },
  en: {
    severityPenaltyCritical: "The \"Critical\" penalty",
    severityPenaltyImportant: "The \"Important\" penalty",
    severityPenaltyModerate: "The \"Moderate\" penalty",
    severityPenaltyOpportunity: "The \"Opportunity\" penalty",
    reportLinkDefaultExpiryDays: "The default expiry",
    reportLinkMaxAttempts: "The maximum number of attempts",
    rateLimitQuoteRequestsPerHour: "The quote request limit",
    rateLimitPortalViewsPerWindow: "The portal view limit",
  },
} as const;

function positiveInt(formData: FormData, field: string, labelKey: keyof (typeof LABELS)["fr"], max: number, locale: Locale): number {
  const raw = Number(formData.get(field));
  if (!Number.isFinite(raw) || raw < 1 || raw > max) {
    throw new Error(MESSAGES[locale].outOfRange(LABELS[locale][labelKey], max));
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
  const [session, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);
  const email = String(formData.get("reportContactEmail") ?? "").trim();
  if (!EMAIL_PATTERN.test(email)) throw new Error(MESSAGES[locale].invalidEmail);
  const footerNote = (formData.get("reportFooterNote") as string)?.trim() || null;
  if (footerNote && footerNote.length > 300) throw new Error(MESSAGES[locale].footerNoteTooLong);

  await applyUpdate(session, { reportContactEmail: email, reportFooterNote: footerNote }, "settings_general_updated");
}

export async function updateScoringSettings(formData: FormData) {
  const [session, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);
  await applyUpdate(
    session,
    {
      severityPenaltyCritical: positiveInt(formData, "severityPenaltyCritical", "severityPenaltyCritical", 100, locale),
      severityPenaltyImportant: positiveInt(formData, "severityPenaltyImportant", "severityPenaltyImportant", 100, locale),
      severityPenaltyModerate: positiveInt(formData, "severityPenaltyModerate", "severityPenaltyModerate", 100, locale),
      severityPenaltyOpportunity: positiveInt(formData, "severityPenaltyOpportunity", "severityPenaltyOpportunity", 100, locale),
    },
    "settings_scoring_updated",
  );
}

export async function updateReportSettings(formData: FormData) {
  const [session, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);
  await applyUpdate(
    session,
    {
      reportLinkDefaultExpiryDays: positiveInt(formData, "reportLinkDefaultExpiryDays", "reportLinkDefaultExpiryDays", 365, locale),
      reportLinkMaxAttempts: positiveInt(formData, "reportLinkMaxAttempts", "reportLinkMaxAttempts", 100, locale),
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
  const [session, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);
  await applyUpdate(
    session,
    {
      rateLimitQuoteRequestsPerHour: positiveInt(formData, "rateLimitQuoteRequestsPerHour", "rateLimitQuoteRequestsPerHour", 1000, locale),
      rateLimitPortalViewsPerWindow: positiveInt(formData, "rateLimitPortalViewsPerWindow", "rateLimitPortalViewsPerWindow", 1000, locale),
    },
    "settings_security_updated",
  );
}
