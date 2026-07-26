"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpServiceOffers } from "@/db/audit-schema";
import { requireAuditAdminRole } from "@/lib/gbp-audit/session";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: {
    invalidCtaUrl: "Le lien (CTA) doit être une URL valide, ex. https://exemple.com.",
    ctaUrlMustBeHttp: "Le lien (CTA) doit commencer par http:// ou https://.",
    nameRequired: "Le nom de l'offre est requis.",
    cannotGenerateKey: "Impossible de générer une clé pour ce nom.",
    offerNotFound: "Cette offre est introuvable.",
  },
  en: {
    invalidCtaUrl: "The link (CTA) must be a valid URL, e.g. https://example.com.",
    ctaUrlMustBeHttp: "The link (CTA) must start with http:// or https://.",
    nameRequired: "The offer name is required.",
    cannotGenerateKey: "Could not generate a key for this name.",
    offerNotFound: "This offer could not be found.",
  },
} as const;

function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function parseCtaUrl(formData: FormData, locale: Locale): string | null {
  const raw = (formData.get("ctaUrl") as string)?.trim() || null;
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(MESSAGES[locale].invalidCtaUrl);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(MESSAGES[locale].ctaUrlMustBeHttp);
  }
  return raw;
}

export async function createServiceOffer(formData: FormData) {
  const [, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);

  const label = String(formData.get("label") ?? "").trim();
  if (!label) throw new Error(MESSAGES[locale].nameRequired);
  const description = (formData.get("description") as string)?.trim() || null;
  const ctaUrl = parseCtaUrl(formData, locale);

  const baseKey = slugifyKey(label);
  if (!baseKey) throw new Error(MESSAGES[locale].cannotGenerateKey);
  let key = baseKey;
  const [existing] = await auditDb.select({ key: gbpServiceOffers.key }).from(gbpServiceOffers).where(eq(gbpServiceOffers.key, key)).limit(1);
  if (existing) key = `${baseKey}_${Date.now().toString(36)}`;

  const [offer] = await auditDb.insert(gbpServiceOffers).values({ key, label, description, ctaUrl }).returning();
  await logAuditActivity({ action: "service_offer_created", targetType: "gbp_service_offers", targetId: offer.id, metadata: { label } });
  revalidatePath("/admin/audit/offres");
}

export async function updateServiceOffer(id: string, formData: FormData) {
  const [, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);

  const label = String(formData.get("label") ?? "").trim();
  if (!label) throw new Error(MESSAGES[locale].nameRequired);
  const description = (formData.get("description") as string)?.trim() || null;
  const ctaUrl = parseCtaUrl(formData, locale);

  const { rowCount } = await auditDb.update(gbpServiceOffers).set({ label, description, ctaUrl }).where(eq(gbpServiceOffers.id, id));
  if (rowCount === 0) throw new Error(MESSAGES[locale].offerNotFound);
  await logAuditActivity({ action: "service_offer_updated", targetType: "gbp_service_offers", targetId: id, metadata: { label } });
  revalidatePath("/admin/audit/offres");
}

export async function toggleServiceOfferActive(id: string, active: boolean) {
  const locale = await getLocale();
  await requireAuditAdminRole();
  const { rowCount } = await auditDb.update(gbpServiceOffers).set({ active }).where(eq(gbpServiceOffers.id, id));
  if (rowCount === 0) throw new Error(MESSAGES[locale].offerNotFound);
  await logAuditActivity({ action: "service_offer_toggled", targetType: "gbp_service_offers", targetId: id, metadata: { active } });
  revalidatePath("/admin/audit/offres");
}

export async function deleteServiceOffer(id: string) {
  const [, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);
  const { rowCount } = await auditDb.delete(gbpServiceOffers).where(eq(gbpServiceOffers.id, id));
  if (rowCount === 0) throw new Error(MESSAGES[locale].offerNotFound);
  await logAuditActivity({ action: "service_offer_deleted", targetType: "gbp_service_offers", targetId: id });
  revalidatePath("/admin/audit/offres");
}
