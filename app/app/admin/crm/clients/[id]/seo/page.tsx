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
  SEO_ISSUE_CATEGORY_LABEL,
  SEO_ISSUE_PRIORITY_LABEL,
  seoScoreBand,
} from "@/lib/seo-shared";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const SCORE_TONE_CLASS: Record<string, string> = {
  good: "bg-pm-g-green/10 text-pm-g-green",
  warning: "bg-pm-or/10 text-pm-or-2",
  bad: "bg-pm-rouge/10 text-pm-rouge",
};

export default async function CrmClientSeoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRole();
  const { id } = await params;

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
        ← Retour à la fiche client
      </Link>

      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">SEO — {client.name}</h1>
          <p className="mt-1 text-sm text-pm-gris">
            Audits techniques, mots-clés et recommandations (données simulées — module en mode mock).
          </p>
        </div>
        <AddWebsiteForm clientId={id} />
      </div>

      {websiteData.length === 0 && (
        <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-8 text-sm text-pm-gris">
          Aucun site web enregistré pour ce client. Ajoutez un site pour lancer un premier audit SEO.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-8">
        {websiteData.map(({ website, auditHistory, latestCompleted, issues, keywords }) => {
          const band = latestCompleted ? seoScoreBand(latestCompleted.score ?? 0) : null;

          return (
            <section key={website.id} className="rounded-2xl border border-pm-gris-2 bg-white p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-serif text-lg font-semibold text-pm-noir">{website.label || website.url}</p>
                  <a href={website.url} target="_blank" rel="noreferrer" className="text-sm text-pm-gris underline">
                    {website.url}
                  </a>
                  <div className="mt-2 flex items-center gap-3">
                    <EditWebsiteForm website={website} />
                    <DeleteWebsiteButton id={website.id} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {band && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${SCORE_TONE_CLASS[band.tone]}`}>
                      Score : {latestCompleted!.score}/100 — {band.label}
                    </span>
                  )}
                  <RunSeoAuditButton websiteId={website.id} />
                </div>
              </div>

              {!latestCompleted ? (
                <p className="mt-4 text-sm text-pm-gris">Aucun audit encore réalisé sur ce site.</p>
              ) : (
                <>
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <TechFact label="Titre de page" value={latestCompleted.pageTitle ?? "Manquant"} />
                    <TechFact label="Meta description" value={latestCompleted.metaDescription ?? "Manquante"} />
                    <TechFact label="Nombre de H1" value={String(latestCompleted.h1Count ?? "—")} />
                    <TechFact label="Indexable" value={boolLabel(latestCompleted.indexable)} />
                    <TechFact label="Sitemap.xml" value={boolLabel(latestCompleted.sitemapFound)} />
                    <TechFact label="Robots.txt" value={boolLabel(latestCompleted.robotsTxtFound)} />
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">
                      Recommandations ({issues.length})
                    </h3>
                    <a
                      href={`/api/crm/seo/audits/${latestCompleted.id}/pdf`}
                      className="text-xs text-pm-noir underline"
                    >
                      Exporter le rapport PDF
                    </a>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {issues.length === 0 && <p className="text-sm text-pm-gris">Aucune recommandation.</p>}
                    {issues.map((issue) => (
                      <div key={issue.id} className="rounded-xl border border-pm-gris-2 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-pm-noir">{issue.title}</p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-pm-gris-2/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-pm-gris">
                              {SEO_ISSUE_CATEGORY_LABEL[issue.category] ?? issue.category}
                            </span>
                            <span className="rounded-full bg-pm-gris-2/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-pm-gris">
                              {SEO_ISSUE_PRIORITY_LABEL[issue.priority] ?? issue.priority}
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
                    Historique des audits
                  </h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[400px] text-left text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-pm-gris">
                          <th className="pb-2 pr-4">Date</th>
                          <th className="pb-2 pr-4">Score</th>
                          <th className="pb-2">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditHistory.map((audit) => (
                          <tr key={audit.id} className="border-t border-pm-gris-2">
                            <td className="py-2 pr-4 text-pm-noir">
                              {audit.createdAt.toLocaleDateString("fr-FR")} {audit.createdAt.toLocaleTimeString("fr-FR")}
                            </td>
                            <td className="py-2 pr-4 text-pm-noir">{audit.score ?? "—"}</td>
                            <td className="py-2 text-pm-gris">
                              {audit.status === "completed" ? "Terminé" : audit.status === "running" ? "En cours" : "Échoué"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="mt-6 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Suivi des mots-clés</h3>
                {keywords.length > 0 && <RefreshKeywordRankingsButton websiteId={website.id} />}
              </div>
              <div className="mt-2">
                <AddSeoKeywordForm websiteId={website.id} />
              </div>
              {keywords.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-pm-gris">
                        <th className="pb-2 pr-4">Mot-clé</th>
                        <th className="pb-2 pr-4">URL ciblée</th>
                        <th className="pb-2 pr-4">Position actuelle</th>
                        <th className="pb-2 pr-4">Vérifié le</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {keywords.map(({ keyword, latestRanking }) => (
                        <tr key={keyword.id} className="border-t border-pm-gris-2">
                          <td className="py-2 pr-4 text-pm-noir">{keyword.keyword}</td>
                          <td className="py-2 pr-4 text-pm-gris">{keyword.targetUrl ?? "—"}</td>
                          <td className="py-2 pr-4 text-pm-noir">
                            {latestRanking ? (latestRanking.position ?? "Hors top 100") : "Non vérifié"}
                          </td>
                          <td className="py-2 pr-4 text-pm-gris">
                            {latestRanking ? latestRanking.checkedAt.toLocaleDateString("fr-FR") : "—"}
                          </td>
                          <td className="py-2">
                            <DeleteSeoKeywordButton id={keyword.id} />
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

function boolLabel(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Oui" : "Non";
}

function TechFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-pm-gris-2 p-3">
      <p className="text-[10px] uppercase tracking-wide text-pm-gris">{label}</p>
      <p className="mt-1 text-sm text-pm-noir">{value}</p>
    </div>
  );
}
