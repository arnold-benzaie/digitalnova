import { asc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, deals } from "@/db/schema";
import { DEAL_STAGE_OPTIONS } from "@/components/crm/badges";
import { CreateDealForm } from "@/components/crm/create-deal-form";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { updateDealStage } from "@/lib/actions/crm-deals";
import { requireStaffRole } from "@/lib/dev-role";

export default async function CrmPipelinePage() {
  await requireStaffRole();

  const [allDeals, allClients] = await Promise.all([
    db.select().from(deals).orderBy(asc(deals.createdAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Pipeline commercial</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {allDeals.length} opportunité(s) —{" "}
        {allDeals.reduce((sum, d) => sum + d.valueEuros, 0).toLocaleString("fr-FR")} € au total.
      </p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateDealForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {DEAL_STAGE_OPTIONS.map((stageOption) => {
          const stageDeals = allDeals.filter((d) => d.stage === stageOption.value);
          const stageValue = stageDeals.reduce((sum, d) => sum + d.valueEuros, 0);
          return (
            <div key={stageOption.value} className="flex flex-col gap-3 rounded-2xl bg-pm-gris-2/20 p-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{stageOption.label}</p>
                <p className="text-xs text-pm-gris">{stageValue.toLocaleString("fr-FR")} €</p>
              </div>
              <div className="flex flex-col gap-2">
                {stageDeals.map((deal) => (
                  <div key={deal.id} className="rounded-xl border border-pm-gris-2 bg-white p-3">
                    <Link href={`/admin/crm/clients/${deal.clientId}`} className="text-sm font-medium text-pm-noir hover:underline">
                      {deal.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-pm-gris">{clientNameById.get(deal.clientId) ?? "—"}</p>
                    <p className="mt-1 text-sm font-semibold text-pm-noir">{deal.valueEuros.toLocaleString("fr-FR")} €</p>
                    <div className="mt-2">
                      <InlineStatusSelect
                        value={deal.stage}
                        options={DEAL_STAGE_OPTIONS}
                        action={updateDealStage.bind(null, deal.id)}
                        className="w-full rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
                      />
                    </div>
                  </div>
                ))}
                {stageDeals.length === 0 && <p className="text-xs text-pm-gris">Aucune opportunité.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
