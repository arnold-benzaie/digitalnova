"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invoices, subscriptions } from "@/db/schema";
import { getBillingProvider } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notify } from "@/lib/notifications";
import { dispatchWebhookEvent } from "@/lib/webhooks";

/**
 * Real FastSpring checkout redirects the user to a hosted storefront that
 * later fires a webhook (see app/api/webhooks/fastspring/route.ts) to
 * confirm payment. There is no live storefront yet, so this simulates an
 * instant-complete checkout: it both "starts" and "confirms" the
 * subscription in one step, exactly the way the webhook handler would.
 */
export async function subscribeToPlan(planId: string) {
  const provider = getBillingProvider();
  const plan = provider.listPlans().find((p) => p.id === planId);
  if (!plan) throw new Error("Offre inconnue.");

  const org = await getOrCreateDevOrganization();
  await provider.createCheckoutSession({ organizationId: org.id, planId });

  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const [subscription] = await db
    .insert(subscriptions)
    .values({
      organizationId: org.id,
      plan: plan.id,
      status: "active",
      billingInterval: plan.billingInterval,
      priceEuros: plan.priceEuros,
      fastspringSubscriptionId: `mock-sub-${Date.now()}`,
      currentPeriodEnd: periodEnd,
    })
    .onConflictDoUpdate({
      target: subscriptions.organizationId,
      set: {
        plan: plan.id,
        status: "active",
        billingInterval: plan.billingInterval,
        priceEuros: plan.priceEuros,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      },
    })
    .returning();

  await db.insert(invoices).values({
    organizationId: org.id,
    subscriptionId: subscription.id,
    amountEuros: plan.priceEuros,
    status: "paid",
    fastspringOrderId: `mock-order-${Date.now()}`,
  });

  await logAudit({
    organizationId: org.id,
    action: "billing.subscribed",
    targetType: "subscription",
    targetId: subscription.id,
    metadata: { plan: plan.id, priceEuros: plan.priceEuros },
  });

  await notify({
    organizationId: org.id,
    type: "billing.subscribed",
    title: `Abonnement ${plan.name} activé`,
    body: `${plan.priceEuros} €/mois`,
  });

  await dispatchWebhookEvent("subscription.created", {
    organizationId: org.id,
    plan: plan.id,
    priceEuros: plan.priceEuros,
  });

  revalidatePath("/admin/billing");
  revalidatePath("/dashboard/settings");
}

export async function cancelSubscription() {
  const org = await getOrCreateDevOrganization();
  const provider = getBillingProvider();

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, org.id))
    .limit(1);
  if (!subscription) throw new Error("Aucun abonnement actif.");

  if (subscription.fastspringSubscriptionId) {
    await provider.cancelSubscription(subscription.fastspringSubscriptionId);
  }

  await db
    .update(subscriptions)
    .set({ status: "canceled", canceledAt: new Date() })
    .where(eq(subscriptions.id, subscription.id));

  await logAudit({
    organizationId: org.id,
    action: "billing.canceled",
    targetType: "subscription",
    targetId: subscription.id,
  });

  await notify({
    organizationId: org.id,
    type: "billing.canceled",
    title: "Abonnement annulé",
  });

  await dispatchWebhookEvent("subscription.canceled", { organizationId: org.id });

  revalidatePath("/admin/billing");
  revalidatePath("/dashboard/settings");
}
