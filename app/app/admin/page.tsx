import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate, formatNumber } from "@/lib/i18n/format";

export default async function AdminOverviewPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].dashboard.adminOverview;

  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      createdAt: organizations.createdAt,
      memberCount: sql<number>`count(${memberships.userId})::int`,
    })
    .from(organizations)
    .leftJoin(memberships, eq(memberships.organizationId, organizations.id))
    .groupBy(organizations.id)
    .orderBy(organizations.createdAt);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.subtitle}</p>

      {orgs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.name}</th>
                <th className="px-5 py-3">{t.columns.members}</th>
                <th className="px-5 py-3">{t.columns.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 font-medium text-pm-noir">{org.name}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatNumber(org.memberCount, locale)}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatDate(org.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
