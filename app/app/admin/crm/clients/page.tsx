import { desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients } from "@/db/schema";
import { Badge, CLIENT_STAGE_CLASS, CLIENT_STAGE_OPTIONS } from "@/components/crm/badges";
import { CreateClientForm } from "@/components/crm/create-client-form";
import { SeedCrmButton } from "@/components/crm/seed-button";
import { requireStaffRole } from "@/lib/dev-role";

const STAGE_LABEL = Object.fromEntries(CLIENT_STAGE_OPTIONS.map((o) => [o.value, o.label]));

export default async function CrmClientsPage() {
  await requireStaffRole();

  const clients = await db.select().from(crmClients).orderBy(desc(crmClients.createdAt));

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">Clients</h1>
          <p className="mt-1 text-sm text-pm-gris">{clients.length} client(s) — leads, prospects et clients actifs.</p>
        </div>
        {clients.length === 0 && <SeedCrmButton />}
      </div>

      <div className="mt-6">
        <CreateClientForm />
      </div>

      {clients.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun client pour le moment</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Nom</th>
                <th className="px-5 py-3">Contact</th>
                <th className="px-5 py-3">Étape</th>
                <th className="px-5 py-3">Conseiller</th>
                <th className="px-5 py-3">Créé le</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 font-medium text-pm-noir">
                    <Link href={`/admin/crm/clients/${client.id}`} className="hover:underline">
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-pm-gris">
                    {client.contactName ?? "—"}
                    {client.email && <div className="text-xs">{client.email}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <Badge label={STAGE_LABEL[client.stage] ?? client.stage} className={CLIENT_STAGE_CLASS[client.stage] ?? ""} />
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{client.ownerName ?? "—"}</td>
                  <td className="px-5 py-3 text-pm-gris">{new Date(client.createdAt).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
