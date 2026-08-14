import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, subscriptions } from "@/db/schema";
import { CancelSubscriptionButton, SubscribeButton } from "@/components/billing-actions";
import { getBillingProvider } from "@/lib/billing";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireStaffRole } from "@/lib/dev-role";
import { isMarket } from "@/lib/market/context";
import { resolvePlanPrice } from "@/lib/market/pricing";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { AdminPageHero, panelClass, panelTitleClass, tableWrapperClass } from "@/components/admin/page-hero";

export default async function BillingPage() {
  await requireStaffRole();

  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].settings;
  const tb = t.billing;
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
      <AdminPageHero title={tb.title} subtitle={tb.lead(org.name)} />

      {subscription && subscription.status !== "canceled" ? (
        <div className={`mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between ${panelClass}`}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{tb.currentPlan}</p>
            <p className="mt-1 font-serif text-2xl font-bold text-pm-noir">
              {plans.find((p) => p.id === subscription.plan)?.name ?? subscription.plan}
            </p>
            <p className="mt-1 text-sm text-pm-gris">
              {t.subscription.perMonth(subscription.priceEuros)} · {t.status[subscription.status as keyof typeof t.status] ?? subscription.status}
              {subscription.currentPeriodEnd && tb.renewsOn(formatDate(subscription.currentPeriodEnd, locale))}
            </p>
          </div>
          <CancelSubscriptionButton locale={locale} />
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-6 text-center">
          <p className="text-sm text-pm-gris">{tb.noSubscription}</p>
        </div>
      )}

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{tb.offersTitle}</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {plans.map((plan) => {
          const price = resolvePlanPrice(plan, isMarket(org.market) ? org.market : null);
          return (
          <div key={plan.id} className={`flex flex-col justify-between ${panelClass}`}>
            <div>
              <p className={panelTitleClass}>{plan.name}</p>
              <p className="mt-1 font-serif text-2xl font-bold text-pm-noir">
                {price.pending ? (
                  <span className="text-lg font-normal text-pm-gris">{tb.priceUnavailable}</span>
                ) : (
                  <>
                    {price.amount} {price.currency === "EUR" ? "€" : "$ CAD"} <span className="text-sm font-normal text-pm-gris">{tb.perMonth}</span>
                  </>
                )}
              </p>
              <p className="mt-2 text-sm text-pm-gris">{plan.description}</p>
            </div>
            <div className="mt-4">
              <SubscribeButton
                planId={plan.id}
                label={subscription?.plan === plan.id ? tb.currentOffer : tb.subscribe}
                locale={locale}
              />
            </div>
          </div>
          );
        })}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{tb.invoicesTitle}</h2>
      {orgInvoices.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{tb.noInvoices}</p>
      ) : (
        <div className={`mt-3 overflow-hidden ${tableWrapperClass}`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{tb.columns.date}</th>
                <th className="px-5 py-3">{tb.columns.amount}</th>
                <th className="px-5 py-3">{tb.columns.status}</th>
                <th className="px-5 py-3">{tb.columns.fastspringRef}</th>
              </tr>
            </thead>
            <tbody>
              {orgInvoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 text-pm-gris">{formatDate(invoice.issuedAt, locale)}</td>
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
