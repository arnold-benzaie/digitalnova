import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";

export default async function AdminOverviewPage() {
  await requireStaffRole();

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
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Organisations</h1>
      <p className="mt-2 text-sm text-pm-gris">
        Vue d&apos;ensemble des organisations clientes gérées par l&apos;agence.
      </p>

      {orgs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            Aucune organisation pour le moment
          </p>
          <p className="mt-1 text-sm text-pm-gris">
            Les organisations apparaîtront ici une fois le flux d&apos;inscription
            client en place (Phase 1).
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Nom</th>
                <th className="px-5 py-3">Membres</th>
                <th className="px-5 py-3">Créée le</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 font-medium text-pm-noir">{org.name}</td>
                  <td className="px-5 py-3 text-pm-gris">{org.memberCount}</td>
                  <td className="px-5 py-3 text-pm-gris">
                    {new Date(org.createdAt).toLocaleDateString("fr-FR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
