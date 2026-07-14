import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";

export default async function AuditLogPage() {
  await requireStaffRole();

  const entries = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Journal d&apos;audit</h1>
      <p className="mt-2 text-sm text-pm-gris">
        Les 50 dernières actions enregistrées via logAudit().
      </p>

      {entries.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            Aucune entrée pour le moment
          </p>
          <p className="mt-1 text-sm text-pm-gris">
            Le journal se remplira dès que des actions réelles (connexion,
            modifications) seront enregistrées.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Cible</th>
                <th className="px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 font-medium text-pm-noir">{entry.action}</td>
                  <td className="px-5 py-3 text-pm-gris">
                    {entry.targetType ?? "—"}
                    {entry.targetId ? ` · ${entry.targetId}` : ""}
                  </td>
                  <td className="px-5 py-3 text-pm-gris">
                    {new Date(entry.createdAt).toLocaleString("fr-FR")}
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
