import { and, desc, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { auditLog, crmClients, users } from "@/db/schema";
import { getAuditCategoryLabel, categoryOf, clientIdOf, describeAuditEntry } from "@/lib/audit-labels";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";

const PAGE_SIZE = 30;

type Params = { q?: string; category?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/audit-log?${qs}` : "/admin/audit-log";
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].crm.auditLog;
  const categoryLabel = getAuditCategoryLabel(locale);

  const q = params.q?.trim() ?? "";
  const category = params.category && params.category in categoryLabel ? params.category : "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) {
    conditions.push(
      or(ilike(auditLog.action, `%${q}%`), ilike(auditLog.targetType, `%${q}%`), ilike(auditLog.targetId, `%${q}%`)),
    );
  }
  if (category) {
    conditions.push(ilike(auditLog.action, `${category}.%`));
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [entries, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(whereClause)
      .orderBy(desc(auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || category);

  const actorIds = [...new Set(entries.map((e) => e.actorUserId).filter((v): v is string => Boolean(v)))];
  const clientIds = [...new Set(entries.map(clientIdOf).filter((v): v is string => Boolean(v)))];
  const [actors, clients] = await Promise.all([
    actorIds.length
      ? db.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(inArray(users.id, actorIds))
      : Promise.resolve([]),
    clientIds.length
      ? db.select({ id: crmClients.id, name: crmClients.name }).from(crmClients).where(inArray(crmClients.id, clientIds))
      : Promise.resolve([]),
  ]);
  const actorNameById = new Map(actors.map((a) => [a.id, a.fullName ?? a.email]));
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.countSummary(totalCount, overallCount, hasFilters)}</p>

      <form action="/admin/audit-log" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
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
        <label htmlFor="category" className="sr-only">
          {t.categoryFilterLabel}
        </label>
        <select
          id="category"
          name="category"
          defaultValue={category}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="">{t.allCategories}</option>
          {Object.entries(categoryLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
        >
          {t.filter}
        </button>
        {hasFilters && (
          <a href="/admin/audit-log" className="text-xs text-pm-gris underline">
            {t.reset}
          </a>
        )}
      </form>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}
          </p>
          <p className="mt-1 text-sm text-pm-gris">
            {overallCount === 0 ? t.emptyNoneDescription : t.emptyFilteredDescription}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">{t.columns.category}</th>
                  <th className="px-5 py-3">{t.columns.action}</th>
                  <th className="px-5 py-3">{t.columns.client}</th>
                  <th className="px-5 py-3">{t.columns.by}</th>
                  <th className="px-5 py-3">{t.columns.date}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const clientId = clientIdOf(entry);
                  return (
                    <tr key={entry.id} className="border-t border-pm-gris-2">
                      <td className="px-5 py-3">
                        <span className="inline-block rounded-full bg-pm-gris-2/60 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-pm-gris">
                          {categoryLabel[categoryOf(entry.action)] ?? categoryOf(entry.action)}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-pm-noir">{describeAuditEntry(entry, locale)}</td>
                      <td className="px-5 py-3 text-pm-gris">
                        {clientId ? (
                          <Link href={`/admin/crm/clients/${clientId}`} className="hover:underline">
                            {clientNameById.get(clientId) ?? "—"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3 text-pm-gris">
                        {entry.actorUserId ? (actorNameById.get(entry.actorUserId) ?? t.unknownUser) : t.system}
                      </td>
                      <td className="px-5 py-3 text-pm-gris">{formatDateTime(entry.createdAt, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <a
                href={buildHref(params, { page: page > 1 ? String(page - 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${
                  page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
                }`}
              >
                {t.previous}
              </a>
              <span className="text-pm-gris">{t.pageOf(page, totalPages)}</span>
              <a
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${
                  page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
                }`}
              >
                {t.next}
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
