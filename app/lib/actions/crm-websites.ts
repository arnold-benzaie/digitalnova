"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmWebsites } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";

function normalizeUrl(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("URL du site requise.");
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    throw new Error("URL du site invalide.");
  }
}

export async function createWebsite(formData: FormData) {
  const clientId = formData.get("clientId");
  if (typeof clientId !== "string" || !clientId) throw new Error("Client requis.");

  const url = normalizeUrl(formData.get("url"));
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
  const [existing] = await db.select().from(crmWebsites).where(eq(crmWebsites.id, id)).limit(1);
  if (!existing) throw new Error("Site introuvable.");

  const url = normalizeUrl(formData.get("url"));
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
  const [existing] = await db.select().from(crmWebsites).where(eq(crmWebsites.id, id)).limit(1);
  if (!existing) throw new Error("Site introuvable.");

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
