import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { contracts, crmClients } from "@/db/schema";
import { Badge, CONTRACT_STATUS_CLASS, getContractStatusLabel } from "@/components/crm/badges";
import { EditContractForm, SendContractButton, SimulateSignatureButton } from "@/components/crm/contract-actions";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

const STATUS_VALUES = ["draft", "sent", "signed", "declined"];
const PAGE_SIZE = 20;

type Params = { q?: string; status?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/contracts?${qs}` : "/admin/crm/contracts";
}

export default async function CrmContractsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].crm.contracts;
  const contractStatusLabel = getContractStatusLabel(locale);
  const statusOptions = Object.entries(contractStatusLabel).map(([value, label]) => ({ value, label }));

  const q = params.q?.trim() ?? "";
  const status = params.status && STATUS_VALUES.includes(params.status) ? params.status : "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) conditions.push(ilike(contracts.title, `%${q}%`));
  if (status) conditions.push(eq(contracts.status, status));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [allContracts, allClients, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(contracts)
      .where(whereClause)
      .orderBy(desc(contracts.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(contracts).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(contracts),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || status);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.summary(totalCount, overallCount, hasFilters)}</p>

      <form action="/admin/crm/contracts" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchAriaLabel}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <select name="status" defaultValue={status} aria-label={t.statusFilterAriaLabel} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{t.allStatuses}</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          {dictionaries[locale].common.filter}
        </button>
        {hasFilters && <a href="/admin/crm/contracts" className="text-xs text-pm-gris underline">{t.reset}</a>}
      </form>

      {allContracts.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}
          </p>
          {overallCount === 0 && (
            <p className="mt-1 text-sm text-pm-gris">{t.emptyNoneDescription}</p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allContracts.map((contract) => (
              <div key={contract.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link href={`/admin/crm/clients/${contract.clientId}`} className="font-medium text-pm-noir hover:underline">
                      {contract.title}
                    </Link>
                    <p className="text-xs text-pm-gris">{clientNameById.get(contract.clientId) ?? t.noValue}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge label={contractStatusLabel[contract.status] ?? contract.status} className={CONTRACT_STATUS_CLASS[contract.status] ?? ""} />
                    {contract.status === "draft" && <EditContractForm contract={contract} locale={locale} />}
                    {contract.status === "draft" && <SendContractButton id={contract.id} locale={locale} />}
                    {contract.status === "sent" && <SimulateSignatureButton id={contract.id} locale={locale} />}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <a
                href={buildHref(params, { page: page > 1 ? String(page - 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                {dictionaries[locale].common.previous}
              </a>
              <span className="text-pm-gris">{t.pageOf(page, totalPages)}</span>
              <a
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                {dictionaries[locale].common.next}
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
