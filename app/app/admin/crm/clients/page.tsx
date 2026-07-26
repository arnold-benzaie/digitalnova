import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients } from "@/db/schema";
import { Badge, CLIENT_STAGE_CLASS, CLIENT_STAGE_OPTIONS, getClientStageOptions } from "@/components/crm/badges";
import { CreateClientForm } from "@/components/crm/create-client-form";
import { SeedCrmButton } from "@/components/crm/seed-button";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

const STAGE_VALUES = CLIENT_STAGE_OPTIONS.map((o) => o.value);
const PAGE_SIZE = 20;

type Params = { q?: string; stage?: string; archived?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/clients?${qs}` : "/admin/crm/clients";
}

function buildExportHref(params: Params, format: "csv" | "pdf") {
  const merged: Record<string, string> = { format };
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") merged[key] = value;
  }
  return `/api/crm/export/clients?${new URLSearchParams(merged).toString()}`;
}

export default async function CrmClientsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].crm.clients;
  const stageLabel = Object.fromEntries(getClientStageOptions(locale).map((o) => [o.value, o.label]));
  const stageOptions = getClientStageOptions(locale);

  const q = params.q?.trim() ?? "";
  const stageFilter = params.stage && STAGE_VALUES.includes(params.stage) ? params.stage : "";
  const archivedFilter = params.archived === "archived" || params.archived === "all" ? params.archived : "active";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) {
    conditions.push(
      or(ilike(crmClients.name, `%${q}%`), ilike(crmClients.contactName, `%${q}%`), ilike(crmClients.email, `%${q}%`)),
    );
  }
  if (stageFilter) conditions.push(eq(crmClients.stage, stageFilter));
  if (archivedFilter === "active") conditions.push(isNull(crmClients.archivedAt));
  if (archivedFilter === "archived") conditions.push(isNotNull(crmClients.archivedAt));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [clients, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(crmClients)
      .where(whereClause)
      .orderBy(desc(crmClients.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ count: sql<number>`count(*)::int` }).from(crmClients).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(crmClients),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || stageFilter || archivedFilter !== "active");

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
          <p className="mt-1 text-sm text-pm-gris">{t.resultsSummary(totalCount, overallCount, hasFilters)}</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={buildExportHref(params, "csv")}
            className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
          >
            {t.exportCsv}
          </a>
          <a
            href={buildExportHref(params, "pdf")}
            className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
          >
            {t.exportPdf}
          </a>
          {overallCount === 0 && <SeedCrmButton locale={locale} />}
        </div>
      </div>

      <div className="mt-6">
        <CreateClientForm locale={locale} />
      </div>

      <form action="/admin/crm/clients" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="q" className="sr-only">
          {t.searchLabel}
        </label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <label htmlFor="stage" className="sr-only">
          {t.stageFilterLabel}
        </label>
        <select
          id="stage"
          name="stage"
          defaultValue={stageFilter}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="">{t.allStages}</option>
          {stageOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label htmlFor="archived" className="sr-only">
          {t.statusFilterLabel}
        </label>
        <select
          id="archived"
          name="archived"
          defaultValue={archivedFilter}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="active">{t.activeOption}</option>
          <option value="archived">{t.archivedOption}</option>
          <option value="all">{t.allOption}</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
        >
          {dictionaries[locale].common.filter}
        </button>
        {hasFilters && (
          <Link href="/admin/crm/clients" className="text-xs text-pm-gris underline">
            {t.reset}
          </Link>
        )}
      </form>

      {clients.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}
          </p>
          {overallCount > 0 && <p className="mt-1 text-sm text-pm-gris">{t.emptyFilteredDescription}</p>}
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">{t.columns.name}</th>
                  <th className="px-5 py-3">{t.columns.contact}</th>
                  <th className="px-5 py-3">{t.columns.stage}</th>
                  <th className="px-5 py-3">{t.columns.owner}</th>
                  <th className="px-5 py-3">{t.columns.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-t border-pm-gris-2">
                    <td className="px-5 py-3 font-medium text-pm-noir">
                      <Link href={`/admin/crm/clients/${client.id}`} className="hover:underline">
                        {client.name}
                      </Link>
                      {client.archivedAt && (
                        <span className="ml-2 inline-block rounded-full bg-pm-gris-2/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-pm-gris">
                          {t.archivedBadge}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-pm-gris">
                      {client.contactName ?? t.noValue}
                      {client.email && <div className="text-xs">{client.email}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <Badge label={stageLabel[client.stage] ?? client.stage} className={CLIENT_STAGE_CLASS[client.stage] ?? ""} />
                    </td>
                    <td className="px-5 py-3 text-pm-gris">{client.ownerName ?? t.noValue}</td>
                    <td className="px-5 py-3 text-pm-gris">{formatDate(client.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <Link
                href={buildHref(params, { page: page > 1 ? String(page - 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${
                  page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
                }`}
              >
                {dictionaries[locale].common.previous}
              </Link>
              <span className="text-pm-gris">{t.pageOf(page, totalPages)}</span>
              <Link
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${
                  page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
                }`}
              >
                {dictionaries[locale].common.next}
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}
