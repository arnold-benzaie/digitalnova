"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, auditProspects, gbpAudits } from "@/db/audit-schema";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { dispatchAuditWebhookEvent } from "@/lib/gbp-audit/webhooks";
import { GBP_PROFILE_STATUS_OPTIONS } from "@/lib/gbp-audit/checklist";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const PROFILE_STATUS_VALUES = GBP_PROFILE_STATUS_OPTIONS.map((o) => o.value);
const LANGUAGES = ["fr", "en"] as const;

const MESSAGES = {
  fr: {
    requiredSuffix: (label: string) => `${label} est requis.`,
    statusNotDirectlySettable:
      "Ce statut ne peut pas être défini directement — utilisez les actions dédiées de l'onglet Rapport (soumettre, approuver, demander des corrections, envoyer).",
    auditNotFound: "Audit introuvable.",
    auditAlreadyInReview: "Cet audit est déjà engagé dans le circuit de validation — utilisez les actions de l'onglet Rapport.",
    invalidProfileStatus: "Statut de profil invalide.",
    businessMismatch: "Cette entreprise ne correspond pas à cet audit.",
  },
  en: {
    requiredSuffix: (label: string) => `${label} is required.`,
    statusNotDirectlySettable:
      "This status cannot be set directly — use the dedicated actions in the Report tab (submit, approve, request changes, send).",
    auditNotFound: "Audit not found.",
    auditAlreadyInReview: "This audit is already engaged in the review workflow — use the actions in the Report tab.",
    invalidProfileStatus: "Invalid profile status.",
    businessMismatch: "This business does not match this audit.",
  },
} as const;

const REQUIRED_LABELS = {
  fr: { firstName: "Le prénom du prospect", lastName: "Le nom du prospect", legalName: "Le nom officiel de l'entreprise" },
  en: { firstName: "The prospect's first name", lastName: "The prospect's last name", legalName: "The company's legal name" },
} as const;

function requiredString(formData: FormData, field: string, labelKey: keyof (typeof REQUIRED_LABELS)["fr"], locale: Locale): string {
  const value = formData.get(field);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(MESSAGES[locale].requiredSuffix(REQUIRED_LABELS[locale][labelKey]));
  }
  return value.trim();
}

function optionalString(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Single intake action: creates the prospect, their business, and an empty
 * audit shell (status "not_started") in one transaction against the
 * AUDIT database, then routes the agent straight to the new audit.
 */
export async function createProspectBusinessAndAudit(formData: FormData) {
  const [session, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);

  const firstName = requiredString(formData, "firstName", "firstName", locale);
  const lastName = requiredString(formData, "lastName", "lastName", locale);
  const legalName = requiredString(formData, "legalName", "legalName", locale);

  const preferredLanguageRaw = formData.get("preferredLanguage");
  const preferredLanguage = LANGUAGES.includes(preferredLanguageRaw as (typeof LANGUAGES)[number])
    ? (preferredLanguageRaw as string)
    : "fr";

  const profileStatusRaw = formData.get("profileStatus");
  const profileStatus = PROFILE_STATUS_VALUES.includes(profileStatusRaw as string)
    ? (profileStatusRaw as string)
    : "unknown";

  const locationCountRaw = formData.get("locationCount");
  const locationCount = Math.max(1, parseInt(String(locationCountRaw ?? "1"), 10) || 1);

  const { prospect, business, audit } = await auditDb.transaction(async (tx) => {
    const [prospect] = await tx
      .insert(auditProspects)
      .values({
        firstName,
        lastName,
        email: optionalString(formData, "email"),
        phone: optionalString(formData, "phone"),
        whatsapp: optionalString(formData, "whatsapp"),
        preferredLanguage,
        country: optionalString(formData, "prospectCountry"),
        timezone: optionalString(formData, "timezone"),
        source: optionalString(formData, "source"),
        ownerName: optionalString(formData, "ownerName") ?? session.fullName ?? session.email,
        notes: optionalString(formData, "notes"),
      })
      .returning();

    const [business] = await tx
      .insert(auditBusinesses)
      .values({
        prospectId: prospect.id,
        legalName,
        googleDisplayName: optionalString(formData, "googleDisplayName"),
        industry: optionalString(formData, "industry"),
        primaryCategory: optionalString(formData, "primaryCategory"),
        address: optionalString(formData, "address"),
        serviceArea: optionalString(formData, "serviceArea"),
        city: optionalString(formData, "city"),
        region: optionalString(formData, "region"),
        country: optionalString(formData, "businessCountry"),
        phone: optionalString(formData, "businessPhone"),
        websiteUrl: optionalString(formData, "websiteUrl"),
        googleProfileUrl: optionalString(formData, "googleProfileUrl"),
        googleMapsUrl: optionalString(formData, "googleMapsUrl"),
        googlePlaceId: optionalString(formData, "googlePlaceId"),
        locationCount,
        profileStatus,
      })
      .returning();

    const [audit] = await tx
      .insert(gbpAudits)
      .values({
        businessId: business.id,
        prospectId: prospect.id,
        assignedAgentName: optionalString(formData, "ownerName") ?? session.fullName ?? session.email,
        status: "not_started",
      })
      .returning();

    return { prospect, business, audit };
  });

  await logAuditActivity({
    action: "prospect_created",
    targetType: "audit_prospect",
    targetId: prospect.id,
    metadata: { firstName, lastName, businessName: legalName, auditId: audit.id },
  });
  await logAuditActivity({
    action: "audit_created",
    targetType: "gbp_audit",
    targetId: audit.id,
    metadata: { businessId: business.id, businessName: legalName },
  });

  await dispatchAuditWebhookEvent("gbp_audit.prospect_created", { prospectId: prospect.id, businessName: legalName });
  await dispatchAuditWebhookEvent("gbp_audit.audit_created", { auditId: audit.id, businessId: business.id });

  revalidatePath("/admin/audit");
  revalidatePath("/admin/audit/liste");
  redirect(`/admin/audit/${audit.id}`);
}

// The only two statuses this generic action may set or start from. Every
// other transition (pending_review, changes_requested, approved, sent) has
// its own gated action in lib/actions/gbp-audit-report.ts — some of them
// supervisor-only, some of them creating a report row or stamping
// approvedAt/approvedByName as a side effect. Letting this action set any
// of the 6 status values (as it originally did, guarded only by
// requireAuditStaffRole) let any staff member jump an audit straight to
// "approved" or "sent" without ever going through review, with none of
// those side effects applied — a real bypass of the supervisor gate.
const FREELY_SETTABLE_STATUSES = ["not_started", "in_progress"];

export async function updateAuditStatus(auditId: string, status: string) {
  const [, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);

  if (!FREELY_SETTABLE_STATUSES.includes(status)) {
    throw new Error(MESSAGES[locale].statusNotDirectlySettable);
  }

  const [current] = await auditDb.select({ status: gbpAudits.status }).from(gbpAudits).where(eq(gbpAudits.id, auditId)).limit(1);
  if (!current) throw new Error(MESSAGES[locale].auditNotFound);
  if (!FREELY_SETTABLE_STATUSES.includes(current.status)) {
    throw new Error(MESSAGES[locale].auditAlreadyInReview);
  }

  const [audit] = await auditDb.update(gbpAudits).set({ status }).where(eq(gbpAudits.id, auditId)).returning();

  await logAuditActivity({
    action: "status_changed",
    targetType: "gbp_audit",
    targetId: auditId,
    metadata: { status },
  });
  await dispatchAuditWebhookEvent("gbp_audit.status_changed", { auditId, status });

  revalidatePath("/admin/audit");
  revalidatePath("/admin/audit/liste");
  revalidatePath(`/admin/audit/${auditId}`);
  return audit;
}

export async function updateBusinessProfileStatus(auditId: string, businessId: string, status: string) {
  const [, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);

  if (!PROFILE_STATUS_VALUES.includes(status)) {
    throw new Error(MESSAGES[locale].invalidProfileStatus);
  }

  // auditBusinesses has no direct auditId column — confirm the given
  // businessId is actually the one this auditId points to before writing.
  const [audit] = await auditDb.select({ businessId: gbpAudits.businessId }).from(gbpAudits).where(eq(gbpAudits.id, auditId)).limit(1);
  if (!audit || audit.businessId !== businessId) throw new Error(MESSAGES[locale].businessMismatch);

  await auditDb.update(auditBusinesses).set({ profileStatus: status }).where(eq(auditBusinesses.id, businessId));

  await logAuditActivity({
    action: "business_profile_status_changed",
    targetType: "audit_businesses",
    targetId: businessId,
    metadata: { auditId, status },
  });
  await dispatchAuditWebhookEvent("gbp_audit.profile_status_changed", { auditId, businessId, status });

  revalidatePath(`/admin/audit/${auditId}`);
}
