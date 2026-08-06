import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { crmClients, crmWebsites, seoAuditIssues, seoAudits, seoKeywordRankings, seoKeywords } from "@/db/schema";
import {
  AddSeoKeywordForm,
  AddWebsiteForm,
  DeleteSeoKeywordButton,
  DeleteWebsiteButton,
  EditWebsiteForm,
  RefreshKeywordRankingsButton,
  RunSeoAuditButton,
  SeoIssueStatusSelect,
} from "@/components/crm/seo-actions";
import { requireStaffRole } from "@/lib/dev-role";
import {
  getSeoIssueCategoryLabel,
  getSeoIssuePriorityLabel,
  seoScoreBand,
} from "@/lib/seo-shared";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const SCORE_TONE_CLASS: Record<string, string> = {
  good: "bg-pm-g-green/10 text-pm-g-green",
  warning: "bg-pm-or/10 text-pm-or-2",
  bad: "bg-pm-rouge/10 text-pm-rouge",
};

export default async function CrmClientSeoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRole();
  const [{ id }, locale] = await Promise.all([params, getLocale()]);
  const t = dictionaries[locale].crm.seo.page;
  const backLinkLabel = dictionaries[locale].crm.googleTabs.backToClient;
  const categoryLabel = getSeoIssueCategoryLabel(locale);
  const priorityLabel = getSeoIssuePriorityLabel(locale);

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1);
  if (!client) notFound();

  const websites = await db.select().from(crmWebsites).where(eq(crmWebsites.clientId, id)).orderBy(crmWebsites.createdAt);

  const websiteData = await Promise.all(
    websites.map(async (website) => {
      const auditHistory = await db
        .select()
        .from(seoAudits)
        .where(eq(seoAudits.websiteId, website.id))
        .orderBy(desc(seoAudits.createdAt))
        .limit(10);
      const latestCompleted = auditHistory.find((a) => a.status === "completed") ?? null;
      const issues = latestCompleted
        ? (await db.select().from(seoAuditIssues).where(eq(seoAuditIssues.auditId, latestCompleted.id))).sort(
            (a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3),
          )
        : [];
      const keywords = await db.select().from(seoKeywords).where(eq(seoKeywords.websiteId, website.id)).orderBy(seoKeywords.createdAt);
      const keywordData = await Promise.all(
        keywords.map(async (keyword) => {
          const [latestRanking] = await db
            .select()
            .from(seoKeywordRankings)
            .where(eq(seoKeywordRankings.keywordId, keyword.id))
            .orderBy(desc(seoKeywordRankings.checkedAt))
            .limit(1);
          return { keyword, latestRanking: latestRanking ?? null };
        }),
      );
      return { website, auditHistory, latestCompleted, issues, keywords: keywordData };
    }),
  );

  return (
    <>
      <Link href={`/admin/crm/clients/${id}`} className="text-xs text-pm-gris underline">
        {backLinkLabel}
      </Link>

      <div className="mt-4">
        <AdminPageHero title={t.heading(client.name)} subtitle={t.subtitle} actions={<AddWebsiteForm clientId={id} locale={locale} />} />
      </div>

      {websiteData.length === 0 && (
        <div className={`mt-6 ${panelClass} text-sm text-pm-gris`}>
          {t.noWebsites}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-8">
        {websiteData.map(({ website, auditHistory, latestCompleted, issues, keywords }) => {
          const band = latestCompleted ? seoScoreBand(latestCompleted.score ?? 0, locale) : null;

          return (
            <section key={website.id} className={panelClass}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-serif text-lg font-semibold text-pm-noir">{website.label || website.url}</p>
                  <a href={website.url} target="_blank" rel="noreferrer" className="text-sm text-pm-gris underline">
                    {website.url}
                  </a>
                  <div className="mt-2 flex items-center gap-3">
                    <EditWebsiteForm website={website} locale={locale} />
                    <DeleteWebsiteButton id={website.id} locale={locale} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {band && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${SCORE_TONE_CLASS[band.tone]}`}>
                      {t.scorePrefix} {latestCompleted!.score}/100 — {band.label}
                    </span>
                  )}
                  <RunSeoAuditButton websiteId={website.id} locale={locale} />
                </div>
              </div>

              {!latestCompleted ? (
                <p className="mt-4 text-sm text-pm-gris">{t.noAuditYet}</p>
              ) : (
                <>
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <TechFact label={t.techFacts.pageTitle} value={latestCompleted.pageTitle ?? t.techFacts.missingTitle} />
                    <TechFact label={t.techFacts.metaDescription} value={latestCompleted.metaDescription ?? t.techFacts.missingDescription} />
                    <TechFact label={t.techFacts.h1Count} value={String(latestCompleted.h1Count ?? t.noValue)} />
                    <TechFact label={t.techFacts.indexable} value={boolLabel(latestCompleted.indexable, t)} />
                    <TechFact label={t.techFacts.sitemap} value={boolLabel(latestCompleted.sitemapFound, t)} />
                    <TechFact label={t.techFacts.robots} value={boolLabel(latestCompleted.robotsTxtFound, t)} />
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">
                      {t.recommendationsTitle(issues.length)}
                    </h3>
                    <a
                      href={`/api/crm/seo/audits/${latestCompleted.id}/pdf`}
                      className="text-xs text-pm-noir underline"
                    >
                      {t.exportPdf}
                    </a>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {issues.length === 0 && <p className="text-sm text-pm-gris">{t.noRecommendations}</p>}
                    {issues.map((issue) => (
                      <div key={issue.id} className="rounded-xl border border-pm-gris-2 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-pm-noir">{issue.title}</p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-pm-gris-2/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-pm-gris">
                              {categoryLabel[issue.category] ?? issue.category}
                            </span>
                            <span className="rounded-full bg-pm-gris-2/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-pm-gris">
                              {priorityLabel[issue.priority] ?? issue.priority}
                            </span>
                            <SeoIssueStatusSelect issueId={issue.id} status={issue.status} />
                          </div>
                        </div>
                        {issue.description && <p className="mt-1 text-xs text-pm-gris">{issue.description}</p>}
                        {issue.recommendation && (
                          <p className="mt-1 text-xs text-pm-noir">→ {issue.recommendation}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-pm-gris">
                    {t.auditHistoryTitle}
                  </h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[400px] text-left text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-pm-gris">
                          <th className="pb-2 pr-4">{t.columns.date}</th>
                          <th className="pb-2 pr-4">{t.columns.score}</th>
                          <th className="pb-2">{t.columns.status}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditHistory.map((audit) => (
                          <tr key={audit.id} className="border-t border-pm-gris-2">
                            <td className="py-2 pr-4 text-pm-noir">
                              {formatDateTime(audit.createdAt, locale)}
                            </td>
                            <td className="py-2 pr-4 text-pm-noir">{audit.score ?? t.noValue}</td>
                            <td className="py-2 text-pm-gris">
                              {audit.status === "completed"
                                ? t.auditStatus.completed
                                : audit.status === "running"
                                  ? t.auditStatus.running
                                  : t.auditStatus.failed}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="mt-6 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.keywordTrackingTitle}</h3>
                {keywords.length > 0 && <RefreshKeywordRankingsButton websiteId={website.id} locale={locale} />}
              </div>
              <div className="mt-2">
                <AddSeoKeywordForm websiteId={website.id} locale={locale} />
              </div>
              {keywords.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-pm-gris">
                        <th className="pb-2 pr-4">{t.keywordColumns.keyword}</th>
                        <th className="pb-2 pr-4">{t.keywordColumns.targetUrl}</th>
                        <th className="pb-2 pr-4">{t.keywordColumns.position}</th>
                        <th className="pb-2 pr-4">{t.keywordColumns.checkedAt}</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {keywords.map(({ keyword, latestRanking }) => (
                        <tr key={keyword.id} className="border-t border-pm-gris-2">
                          <td className="py-2 pr-4 text-pm-noir">{keyword.keyword}</td>
                          <td className="py-2 pr-4 text-pm-gris">{keyword.targetUrl ?? t.noValue}</td>
                          <td className="py-2 pr-4 text-pm-noir">
                            {latestRanking ? (latestRanking.position ?? t.outOfTop100) : t.notChecked}
                          </td>
                          <td className="py-2 pr-4 text-pm-gris">
                            {latestRanking ? formatDate(latestRanking.checkedAt, locale) : t.noValue}
                          </td>
                          <td className="py-2">
                            <DeleteSeoKeywordButton id={keyword.id} locale={locale} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function boolLabel(value: boolean | null, t: { noValue: string; boolYes: string; boolNo: string }): string {
  if (value === null) return t.noValue;
  return value ? t.boolYes : t.boolNo;
}

function TechFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-pm-gris-2 p-3">
      <p className="text-[10px] uppercase tracking-wide text-pm-gris">{label}</p>
      <p className="mt-1 text-sm text-pm-noir">{value}</p>
    </div>
  );
}
