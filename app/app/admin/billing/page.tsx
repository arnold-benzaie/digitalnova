import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, subscriptions } from "@/db/schema";
import { CancelSubscriptionButton, SubscribeButton } from "@/components/billing-actions";
import { getBillingProvider } from "@/lib/billing";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireStaffRole } from "@/lib/dev-role";

const STATUS_LABEL: Record<string, string> = {
  active: "Actif",
  trialing: "Essai",
  past_due: "Paiement en retard",
  canceled: "Annulé",
};

export default async function BillingPage() {
  await requireStaffRole();

  const org = await getOrCreateDevOrganization();
  const provider = getBillingProvider();
  const plans = provider.listPlans();

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, org.id))
    .limit(1);

  const orgInvoices = await db
    .select()
    .from(invoices)
    .where(eq(invoices.organizationId, org.id))
    .orderBy(desc(invoices.issuedAt));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Facturation</h1>
      <p className="mt-2 text-sm text-pm-gris">
        Abonnements et facturation pour {org.name} — FastSpring comme merchant of record (données simulées, aucune
        credential réelle configurée — voir README).
      </p>

      {subscription && subscription.status !== "canceled" ? (
        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Abonnement actuel</p>
            <p className="mt-1 font-serif text-2xl font-bold text-pm-noir">
              {plans.find((p) => p.id === subscription.plan)?.name ?? subscription.plan}
            </p>
            <p className="mt-1 text-sm text-pm-gris">
              {subscription.priceEuros} €/mois · {STATUS_LABEL[subscription.status] ?? subscription.status}
              {subscription.currentPeriodEnd &&
                ` · renouvellement le ${new Date(subscription.currentPeriodEnd).toLocaleDateString("fr-FR")}`}
            </p>
          </div>
          <CancelSubscriptionButton />
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-6 text-center">
          <p className="text-sm text-pm-gris">Aucun abonnement actif.</p>
        </div>
      )}

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">Offres</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-col justify-between rounded-2xl border border-pm-gris-2 bg-white p-5">
            <div>
              <p className="font-serif text-lg font-semibold text-pm-noir">{plan.name}</p>
              <p className="mt-1 font-serif text-2xl font-bold text-pm-noir">
                {plan.priceEuros} € <span className="text-sm font-normal text-pm-gris">/mois</span>
              </p>
              <p className="mt-2 text-sm text-pm-gris">{plan.description}</p>
            </div>
            <div className="mt-4">
              <SubscribeButton planId={plan.id} label={subscription?.plan === plan.id ? "Offre actuelle" : "S'abonner"} />
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">Factures</h2>
      {orgInvoices.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">Aucune facture.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Montant</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Référence FastSpring</th>
              </tr>
            </thead>
            <tbody>
              {orgInvoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 text-pm-gris">{new Date(invoice.issuedAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-5 py-3 font-medium text-pm-noir">{invoice.amountEuros} €</td>
                  <td className="px-5 py-3 text-pm-gris">{invoice.status}</td>
                  <td className="px-5 py-3 text-pm-gris">{invoice.fastspringOrderId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
