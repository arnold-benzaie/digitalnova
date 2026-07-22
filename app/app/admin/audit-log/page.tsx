import { and, desc, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { auditLog, crmClients, users } from "@/db/schema";
import { AUDIT_CATEGORY_LABEL, categoryOf, clientIdOf, describeAuditEntry } from "@/lib/audit-labels";
import { requireStaffRole } from "@/lib/dev-role";

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
  const params = await searchParams;

  const q = params.q?.trim() ?? "";
  const category = params.category && params.category in AUDIT_CATEGORY_LABEL ? params.category : "";
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
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Journal d&apos;audit</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {totalCount} entrée(s){hasFilters ? ` sur ${overallCount} au total` : ""} — chaque action significative de
        l&apos;application (CRM, utilisateurs, facturation, GBP, documents...) est enregistrée ici.
      </p>

      <form action="/admin/audit-log" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="q" className="sr-only">
          Rechercher dans le journal
        </label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher par action ou cible…"
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <label htmlFor="category" className="sr-only">
          Filtrer par catégorie
        </label>
        <select
          id="category"
          name="category"
          defaultValue={category}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="">Toutes les catégories</option>
          {Object.entries(AUDIT_CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
        >
          Filtrer
        </button>
        {hasFilters && (
          <a href="/admin/audit-log" className="text-xs text-pm-gris underline">
            Réinitialiser
          </a>
        )}
      </form>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? "Aucune entrée pour le moment" : "Aucun résultat"}
          </p>
          <p className="mt-1 text-sm text-pm-gris">
            {overallCount === 0
              ? "Le journal se remplira dès que des actions réelles seront enregistrées."
              : "Essayez une autre recherche, ou réinitialisez les filtres."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">Catégorie</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Par</th>
                  <th className="px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const clientId = clientIdOf(entry);
                  return (
                    <tr key={entry.id} className="border-t border-pm-gris-2">
                      <td className="px-5 py-3">
                        <span className="inline-block rounded-full bg-pm-gris-2/60 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-pm-gris">
                          {AUDIT_CATEGORY_LABEL[categoryOf(entry.action)] ?? categoryOf(entry.action)}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-pm-noir">{describeAuditEntry(entry)}</td>
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
                        {entry.actorUserId ? (actorNameById.get(entry.actorUserId) ?? "utilisateur inconnu") : "système"}
                      </td>
                      <td className="px-5 py-3 text-pm-gris">{new Date(entry.createdAt).toLocaleString("fr-FR")}</td>
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
                Précédent
              </a>
              <span className="text-pm-gris">
                Page {page} / {totalPages}
              </span>
              <a
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${
                  page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
                }`}
              >
                Suivant
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
