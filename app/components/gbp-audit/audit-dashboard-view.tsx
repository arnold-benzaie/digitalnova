import Link from "next/link";
import { getAuditStatusLabel } from "@/lib/gbp-audit/checklist";
import { Pagination } from "@/components/gbp-audit/ui/pagination";
import { SortableHeader } from "@/components/gbp-audit/ui/sortable-header";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { AuditRow } from "@/components/gbp-audit/audit-row";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type AuditListRow = {
  id: string;
  status: string;
  scoreOverall: number | null;
  assignedAgentName: string | null;
  createdAt: Date;
  businessName: string;
  prospectFirstName: string;
  prospectLastName: string;
};

type FilterParams = { q: string; status: string; agent: string; sort: string; dir: "asc" | "desc"; page: string };

function buildHref(params: FilterParams, overrides: Partial<Record<keyof FilterParams, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/audit/liste?${qs}` : "/admin/audit/liste";
}

/** Pure presentational view — no DB/auth access — so it can be rendered both by the real (auth-gated) page and by an isolated preview harness for visual/responsive QA without needing a live Clerk session. */
export function AuditDashboardView({
  audits,
  totalAudits,
  filteredCount,
  agents,
  params,
  totalPages,
  locale = "fr",
}: {
  audits: AuditListRow[];
  totalAudits: number;
  filteredCount: number;
  agents: string[];
  params: FilterParams;
  totalPages: number;
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.list;
  const statusLabel = getAuditStatusLabel(locale);
  const hasFilters = Boolean(params.q || params.status || params.agent);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
          <p className="mt-1 text-sm text-pm-gris">{t.resultsCount(filteredCount, totalAudits, hasFilters)}</p>
        </div>
        <Link
          href="/admin/audit/nouveau"
          className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pm-noir-2"
        >
          {dictionaries[locale].auditModule.dashboard.newAudit}
        </Link>
      </div>

      <form action="/admin/audit/liste" className="mt-6 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">
        <label htmlFor="q" className="sr-only">{t.searchLabel}</label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/15 sm:max-w-xs"
        />
        <label htmlFor="status" className="sr-only">{t.statusFilterLabel}</label>
        <select id="status" name="status" defaultValue={params.status} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{t.allStatuses}</option>
          {Object.entries(statusLabel).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label htmlFor="agent" className="sr-only">{t.agentFilterLabel}</label>
        <select id="agent" name="agent" defaultValue={params.agent} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{t.allAgents}</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pm-noir-2">
          {t.filter}
        </button>
        {hasFilters && (
          <Link href="/admin/audit/liste" className="text-xs text-pm-gris underline underline-offset-2">
            {t.reset}
          </Link>
        )}
      </form>

      {audits.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" />
              </svg>
            }
            title={totalAudits === 0 ? t.emptyNoAuditsTitle : t.emptyNoResultsTitle}
            description={totalAudits === 0 ? t.emptyNoAuditsDescription : t.emptyNoResultsDescription}
            action={
              totalAudits === 0 ? (
                <Link href="/admin/audit/nouveau" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pm-noir-2">
                  {dictionaries[locale].auditModule.dashboard.newAudit}
                </Link>
              ) : (
                <Link href="/admin/audit/liste" className="text-sm text-pm-noir underline underline-offset-2">
                  {t.resetFilters}
                </Link>
              )
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3"><SortableHeader label={t.columns.business} column="business" activeSort={params.sort} activeDir={params.dir} buildHref={(s, d) => buildHref(params, { sort: s, dir: d, page: undefined })} /></th>
                  <th className="px-5 py-3">{t.columns.prospect}</th>
                  <th className="px-5 py-3"><SortableHeader label={t.columns.status} column="status" activeSort={params.sort} activeDir={params.dir} buildHref={(s, d) => buildHref(params, { sort: s, dir: d, page: undefined })} /></th>
                  <th className="px-5 py-3"><SortableHeader label={t.columns.score} column="score" activeSort={params.sort} activeDir={params.dir} buildHref={(s, d) => buildHref(params, { sort: s, dir: d, page: undefined })} /></th>
                  <th className="px-5 py-3">{t.columns.agent}</th>
                  <th className="px-5 py-3"><SortableHeader label={t.columns.createdAt} column="createdAt" activeSort={params.sort} activeDir={params.dir} buildHref={(s, d) => buildHref(params, { sort: s, dir: d, page: undefined })} /></th>
                  <th className="px-5 py-3" aria-label={t.columns.actions} />
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => (
                  <AuditRow key={audit.id} audit={audit} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={parseInt(params.page, 10) || 1} totalPages={totalPages} buildHref={(p) => buildHref(params, { page: String(p) })} locale={locale} />
        </>
      )}
    </>
  );
}
