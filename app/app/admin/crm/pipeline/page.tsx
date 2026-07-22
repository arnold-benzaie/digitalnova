import { asc } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, deals } from "@/db/schema";
import { CreateDealForm } from "@/components/crm/create-deal-form";
import { PipelineBoard } from "@/components/crm/pipeline-board";
import { requireStaffRole } from "@/lib/dev-role";

export default async function CrmPipelinePage() {
  await requireStaffRole();

  const [allDeals, allClients] = await Promise.all([
    db.select().from(deals).orderBy(asc(deals.createdAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = Object.fromEntries(allClients.map((c) => [c.id, c.name]));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Pipeline commercial</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {allDeals.length} opportunité(s) —{" "}
        {allDeals.reduce((sum, d) => sum + d.valueEuros, 0).toLocaleString("fr-FR")} € au total. Glissez une carte
        vers une autre colonne pour changer son étape.
      </p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateDealForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      <PipelineBoard
        deals={allDeals.map((d) => ({ ...d, expectedCloseDate: d.expectedCloseDate?.toISOString() ?? null }))}
        clientNameById={clientNameById}
      />
    </>
  );
}
