"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmWebsites, seoAuditIssues, seoAudits, seoKeywordRankings, seoKeywords } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getSeoProvider } from "@/lib/seo";
import { SEO_ISSUE_STATUS_VALUES } from "@/lib/seo-shared";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: {
    websiteNotFound: "Site introuvable.",
    invalidStatus: "Statut invalide.",
    recommendationNotFound: "Recommandation introuvable.",
    websiteRequired: "Site requis.",
    keywordRequired: "Mot-clé requis.",
    keywordAlreadyTracked: "Ce mot-clé est déjà suivi pour ce site.",
    keywordNotFound: "Mot-clé introuvable.",
    noTrackedKeyword: "Aucun mot-clé suivi pour ce site.",
  },
  en: {
    websiteNotFound: "Website not found.",
    invalidStatus: "Invalid status.",
    recommendationNotFound: "Recommendation not found.",
    websiteRequired: "Website required.",
    keywordRequired: "Keyword required.",
    keywordAlreadyTracked: "This keyword is already tracked for this website.",
    keywordNotFound: "Keyword not found.",
    noTrackedKeyword: "No keyword tracked for this website.",
  },
} as const;

async function getWebsiteOrThrow(websiteId: string, locale: Locale) {
  const [website] = await db.select().from(crmWebsites).where(eq(crmWebsites.id, websiteId)).limit(1);
  if (!website) throw new Error(MESSAGES[locale].websiteNotFound);
  return website;
}

/**
 * Runs a technical SEO audit against a website via the SEO provider (mock
 * until a real crawler/PageSpeed credential exists — see lib/seo). The mock
 * resolves synchronously, but the row still moves through "running" ->
 * "completed" so the UI/n8n events model the real async flow a live
 * crawler would need.
 */
export async function runSeoAudit(websiteId: string) {
  const locale = await getLocale();
  const website = await getWebsiteOrThrow(websiteId, locale);

  const [audit] = await db.insert(seoAudits).values({ websiteId, status: "running" }).returning();

  await dispatchWebhookEvent("seo.audit_created", {
    auditId: audit.id,
    websiteId,
    clientId: website.clientId,
    url: website.url,
  });

  const provider = getSeoProvider();
  const result = await provider.runTechnicalAudit(website.url);

  const [completed] = await db
    .update(seoAudits)
    .set({
      status: "completed",
      score: result.score,
      summary: result.summary,
      pageTitle: result.pageTitle,
      metaDescription: result.metaDescription,
      h1Count: result.h1Count,
      indexable: result.indexable,
      sitemapFound: result.sitemapFound,
      robotsTxtFound: result.robotsTxtFound,
      completedAt: new Date(),
    })
    .where(eq(seoAudits.id, audit.id))
    .returning();

  if (result.issues.length) {
    await db.insert(seoAuditIssues).values(
      result.issues.map((issue) => ({
        auditId: audit.id,
        category: issue.category,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        recommendation: issue.recommendation,
      })),
    );
  }

  await logCrmAudit({
    action: "crm.seo_audit_completed",
    targetType: "seo_audit",
    targetId: audit.id,
    clientId: website.clientId,
    metadata: { url: website.url, score: result.score, issueCount: result.issues.length },
  });

  await dispatchWebhookEvent("seo.audit_completed", {
    auditId: audit.id,
    websiteId,
    clientId: website.clientId,
    url: website.url,
    score: result.score,
    issueCount: result.issues.length,
  });

  revalidatePath(`/admin/crm/clients/${website.clientId}/seo`);
  revalidatePath(`/admin/crm/clients/${website.clientId}`);
  return completed;
}

export async function updateSeoIssueStatus(issueId: string, status: string) {
  const locale = await getLocale();
  if (!SEO_ISSUE_STATUS_VALUES.includes(status)) throw new Error(MESSAGES[locale].invalidStatus);

  const [issue] = await db
    .update(seoAuditIssues)
    .set({ status, updatedAt: new Date() })
    .where(eq(seoAuditIssues.id, issueId))
    .returning();
  if (!issue) throw new Error(MESSAGES[locale].recommendationNotFound);

  const [audit] = await db.select().from(seoAudits).where(eq(seoAudits.id, issue.auditId)).limit(1);
  const website = audit ? await getWebsiteOrThrow(audit.websiteId, locale) : null;

  await logCrmAudit({
    action: "crm.seo_issue_status_changed",
    targetType: "seo_audit_issue",
    targetId: issueId,
    clientId: website?.clientId,
    metadata: { status, title: issue.title },
  });

  await dispatchWebhookEvent("seo.audit_updated", {
    auditId: issue.auditId,
    issueId,
    status,
    clientId: website?.clientId,
  });

  if (website) {
    revalidatePath(`/admin/crm/clients/${website.clientId}/seo`);
    revalidatePath(`/admin/crm/clients/${website.clientId}`);
  }
}

export async function addSeoKeyword(formData: FormData) {
  const locale = await getLocale();
  const websiteId = formData.get("websiteId");
  if (typeof websiteId !== "string" || !websiteId) throw new Error(MESSAGES[locale].websiteRequired);
  const keyword = (formData.get("keyword") as string)?.trim();
  if (!keyword) throw new Error(MESSAGES[locale].keywordRequired);
  const targetUrl = (formData.get("targetUrl") as string)?.trim() || null;

  const website = await getWebsiteOrThrow(websiteId, locale);

  const [row] = await db.insert(seoKeywords).values({ websiteId, keyword, targetUrl }).onConflictDoNothing().returning();
  if (!row) throw new Error(MESSAGES[locale].keywordAlreadyTracked);

  await logCrmAudit({
    action: "crm.seo_keyword_added",
    targetType: "seo_keyword",
    targetId: row.id,
    clientId: website.clientId,
    metadata: { keyword },
  });

  revalidatePath(`/admin/crm/clients/${website.clientId}/seo`);
  return row;
}

export async function deleteSeoKeyword(id: string) {
  const locale = await getLocale();
  const [existing] = await db.select().from(seoKeywords).where(eq(seoKeywords.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].keywordNotFound);
  const website = await getWebsiteOrThrow(existing.websiteId, locale);

  await db.delete(seoKeywords).where(eq(seoKeywords.id, id));

  await logCrmAudit({
    action: "crm.seo_keyword_deleted",
    targetType: "seo_keyword",
    targetId: id,
    clientId: website.clientId,
    metadata: { keyword: existing.keyword },
  });

  revalidatePath(`/admin/crm/clients/${website.clientId}/seo`);
}

/** Checks current positions for every tracked keyword on a website and
 * appends a new ranking snapshot per keyword — this is what powers the
 * position-history view. */
export async function refreshKeywordRankings(websiteId: string) {
  const locale = await getLocale();
  const website = await getWebsiteOrThrow(websiteId, locale);
  const keywords = await db.select().from(seoKeywords).where(eq(seoKeywords.websiteId, websiteId));
  if (keywords.length === 0) throw new Error(MESSAGES[locale].noTrackedKeyword);

  const provider = getSeoProvider();
  const rankings = await provider.checkKeywordRankings(
    website.url,
    keywords.map((k) => k.keyword),
  );

  const byKeyword = new Map(keywords.map((k) => [k.keyword, k.id]));
  const rows = rankings
    .filter((r) => byKeyword.has(r.keyword))
    .map((r) => ({
      keywordId: byKeyword.get(r.keyword)!,
      searchEngine: r.searchEngine,
      position: r.position,
    }));

  if (rows.length) {
    await db.insert(seoKeywordRankings).values(rows);
  }

  await logCrmAudit({
    action: "crm.seo_keywords_refreshed",
    targetType: "crm_website",
    targetId: websiteId,
    clientId: website.clientId,
    metadata: { keywordCount: rows.length },
  });

  revalidatePath(`/admin/crm/clients/${website.clientId}/seo`);
}

export async function getAuditHistory(websiteId: string, limit = 20) {
  return db
    .select()
    .from(seoAudits)
    .where(eq(seoAudits.websiteId, websiteId))
    .orderBy(desc(seoAudits.createdAt))
    .limit(limit);
}
