"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmWebsites } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import { buildCrmEmployeeScopePredicate, requireCrmClientAccess, resolveCrmEmployeeScope } from "@/lib/crm-client-access";

const MESSAGES = {
  fr: {
    urlRequired: "URL du site requise.",
    invalidUrl: "URL du site invalide.",
    clientRequired: "Client requis.",
    clientNotFound: "Client introuvable.",
    websiteNotFound: "Site introuvable.",
  },
  en: {
    urlRequired: "Website URL required.",
    invalidUrl: "Invalid website URL.",
    clientRequired: "Client required.",
    clientNotFound: "Client not found.",
    websiteNotFound: "Website not found.",
  },
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
  // P0-2G — an EMPLOYEE may only create a website for a client assigned to
  // them; OWNER/ADMIN/MANAGER (unrestricted scope) are unaffected. Same
  // SELECT-then-check primitive already used by createProject (3e40246)
  // and lib/actions/crm-clients.ts's own mutations.
  await requireCrmClientAccess(clientId, new Error(MESSAGES[locale].clientNotFound));

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
  const url = normalizeUrl(formData.get("url"), locale);
  const label = (formData.get("label") as string)?.trim() || null;

  // P0-2G — the scope check is folded directly into this UPDATE's own
  // WHERE clause (atomic, single statement) rather than a separate
  // SELECT-then-check: an EMPLOYEE outside their scope matches zero rows,
  // indistinguishable from a genuinely nonexistent id, with no TOCTOU
  // window between checking and mutating.
  const scope = await resolveCrmEmployeeScope();
  const [website] = await db
    .update(crmWebsites)
    .set({ url, label })
    .where(and(eq(crmWebsites.id, id), buildCrmEmployeeScopePredicate(scope, crmWebsites.clientId)))
    .returning();
  if (!website) throw new Error(MESSAGES[locale].websiteNotFound);

  await logCrmAudit({
    action: "crm.website_updated",
    targetType: "crm_website",
    targetId: id,
    clientId: website.clientId,
    metadata: { url },
  });

  revalidatePath(`/admin/crm/clients/${website.clientId}`);
  revalidatePath(`/admin/crm/clients/${website.clientId}/seo`);
  return website;
}

export async function deleteWebsite(id: string) {
  await requireStaffRole();
  const locale = await getLocale();

  // P0-2G — same atomic, single-statement scope check as updateWebsite
  // above, folded into this DELETE's own WHERE clause — no separate
  // SELECT-then-check, no TOCTOU window.
  const scope = await resolveCrmEmployeeScope();
  // Cascades to seo_audits, seo_audit_issues, seo_keywords, seo_keyword_rankings.
  const [deleted] = await db
    .delete(crmWebsites)
    .where(and(eq(crmWebsites.id, id), buildCrmEmployeeScopePredicate(scope, crmWebsites.clientId)))
    .returning();
  if (!deleted) throw new Error(MESSAGES[locale].websiteNotFound);

  await logCrmAudit({
    action: "crm.website_deleted",
    targetType: "crm_website",
    targetId: id,
    clientId: deleted.clientId,
    metadata: { url: deleted.url },
  });

  revalidatePath(`/admin/crm/clients/${deleted.clientId}`);
  revalidatePath(`/admin/crm/clients/${deleted.clientId}/seo`);
}
