"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmWebsites } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: { urlRequired: "URL du site requise.", invalidUrl: "URL du site invalide.", clientRequired: "Client requis.", websiteNotFound: "Site introuvable." },
  en: { urlRequired: "Website URL required.", invalidUrl: "Invalid website URL.", clientRequired: "Client required.", websiteNotFound: "Website not found." },
} as const;

function normalizeUrl(raw: FormDataEntryValue | null, locale: Locale): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(MESSAGES[locale].urlRequired);
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    throw new Error(MESSAGES[locale].invalidUrl);
  }
}

export async function createWebsite(formData: FormData) {
  await requireStaffRole();
  const locale = await getLocale();
  const clientId = formData.get("clientId");
  if (typeof clientId !== "string" || !clientId) throw new Error(MESSAGES[locale].clientRequired);

  const url = normalizeUrl(formData.get("url"), locale);
  const label = (formData.get("label") as string)?.trim() || null;

  const [website] = await db.insert(crmWebsites).values({ clientId, url, label }).returning();

  await logCrmAudit({
    action: "crm.website_added",
    targetType: "crm_website",
    targetId: website.id,
    clientId,
    metadata: { url },
  });

  revalidatePath(`/admin/crm/clients/${clientId}`);
  revalidatePath(`/admin/crm/clients/${clientId}/seo`);
  return website;
}

export async function updateWebsite(id: string, formData: FormData) {
  await requireStaffRole();
  const locale = await getLocale();
  const [existing] = await db.select().from(crmWebsites).where(eq(crmWebsites.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].websiteNotFound);

  const url = normalizeUrl(formData.get("url"), locale);
  const label = (formData.get("label") as string)?.trim() || null;

  const [website] = await db.update(crmWebsites).set({ url, label }).where(eq(crmWebsites.id, id)).returning();

  await logCrmAudit({
    action: "crm.website_updated",
    targetType: "crm_website",
    targetId: id,
    clientId: existing.clientId,
    metadata: { url },
  });

  revalidatePath(`/admin/crm/clients/${existing.clientId}`);
  revalidatePath(`/admin/crm/clients/${existing.clientId}/seo`);
  return website;
}

export async function deleteWebsite(id: string) {
  await requireStaffRole();
  const locale = await getLocale();
  const [existing] = await db.select().from(crmWebsites).where(eq(crmWebsites.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].websiteNotFound);

  // Cascades to seo_audits, seo_audit_issues, seo_keywords, seo_keyword_rankings.
  await db.delete(crmWebsites).where(eq(crmWebsites.id, id));

  await logCrmAudit({
    action: "crm.website_deleted",
    targetType: "crm_website",
    targetId: id,
    clientId: existing.clientId,
    metadata: { url: existing.url },
  });

  revalidatePath(`/admin/crm/clients/${existing.clientId}`);
  revalidatePath(`/admin/crm/clients/${existing.clientId}/seo`);
}
