import { asc, desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { contracts, crmClients } from "@/db/schema";
import { Badge, CONTRACT_STATUS_CLASS, CONTRACT_STATUS_LABEL } from "@/components/crm/badges";
import { SendContractButton, SimulateSignatureButton } from "@/components/crm/contract-actions";
import { requireStaffRole } from "@/lib/dev-role";

export default async function CrmContractsPage() {
  await requireStaffRole();

  const [allContracts, allClients] = await Promise.all([
    db.select().from(contracts).orderBy(desc(contracts.createdAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Contrats &amp; devis</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {allContracts.length} contrat(s) — signature électronique simulée (aucun fournisseur réel configuré, voir
        README).
      </p>

      {allContracts.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun contrat</p>
          <p className="mt-1 text-sm text-pm-gris">
            Créez un contrat depuis la fiche d&apos;un client.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {allContracts.map((contract) => (
            <div key={contract.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href={`/admin/crm/clients/${contract.clientId}`} className="font-medium text-pm-noir hover:underline">
                    {contract.title}
                  </Link>
                  <p className="text-xs text-pm-gris">{clientNameById.get(contract.clientId) ?? "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge label={CONTRACT_STATUS_LABEL[contract.status] ?? contract.status} className={CONTRACT_STATUS_CLASS[contract.status] ?? ""} />
                  {contract.status === "draft" && <SendContractButton id={contract.id} />}
                  {contract.status === "sent" && <SimulateSignatureButton id={contract.id} />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
