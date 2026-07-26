import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, organizations, subscriptions } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { verifyFastspringSignature } from "@/lib/billing/webhook";
import { notify } from "@/lib/notifications";

/**
 * Real FastSpring webhook receiver. No FASTSPRING_WEBHOOK_SECRET exists
 * yet, so incoming requests are accepted but flagged unverified — once the
 * secret is set in .env.local (from the FastSpring dashboard's webhook
 * config), signature verification becomes mandatory. Payload shape follows
 * FastSpring's documented `{ events: [{ type, data }] }` format — confirm
 * against their current docs when connecting a real account, since this
 * has never received a real payload.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-fs-signature");
  const secret = process.env.FASTSPRING_WEBHOOK_SECRET;

  const verified = secret ? verifyFastspringSignature(rawBody, signatureHeader, secret) : false;
  if (secret && !verified) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: { events?: { type: string; data?: Record<string, unknown> }[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  for (const event of body.events ?? []) {
    await logAudit({
      action: `fastspring.webhook.${event.type}`,
      targetType: "fastspring_event",
      metadata: { verified, data: event.data },
    });

    const subscriptionId = event.data?.subscription as string | undefined;
    if (!subscriptionId) continue;

    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.fastspringSubscriptionId, subscriptionId))
      .limit(1);
    if (!subscription) continue;

    if (event.type === "subscription.canceled" || event.type === "subscription.deactivated") {
      await db
        .update(subscriptions)
        .set({ status: "canceled", canceledAt: new Date() })
        .where(eq(subscriptions.id, subscription.id));
    } else if (event.type === "subscription.charge.completed" || event.type === "order.completed") {
      await db
        .update(subscriptions)
        .set({ status: "active" })
        .where(eq(subscriptions.id, subscription.id));
      await db.insert(invoices).values({
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        amountEuros: subscription.priceEuros,
        status: "paid",
        fastspringOrderId: (event.data?.order as string) ?? null,
      });
    } else if (event.type === "subscription.payment.failed") {
      await db.update(subscriptions).set({ status: "past_due" }).where(eq(subscriptions.id, subscription.id));
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, subscription.organizationId)).limit(1);
    if (org) {
      await notify({
        organizationId: org.id,
        type: `fastspring.${event.type}`,
        metadata: {},
        rawBody: event.type,
      });
    }
  }

  return Response.json({ received: true, verified });
}
