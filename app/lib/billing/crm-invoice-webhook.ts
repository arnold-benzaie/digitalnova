import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmInvoices } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";

/**
 * PREPARED, NOT CONNECTED. Nothing in app/api/webhooks/fastspring/route.ts
 * calls this yet, and it must not be wired in until a real FastSpring
 * account exists — see AGENTS.md/audit history for why that route is
 * currently unverified-by-default (no FASTSPRING_WEBHOOK_SECRET set).
 *
 * That route already handles FastSpring's *subscription* billing (the
 * platform's own `subscriptions`/`invoices` tables, keyed by
 * `fastspringSubscriptionId`). CRM invoices are a separate, one-off
 * "agency bills a client" flow — this is the matching handler for that
 * flow, kept isolated so connecting it later is a single added call in
 * that route's event loop, not a rewrite.
 *
 * Intended wiring once ready: when a real FastSpring checkout is created
 * for a crm_invoices row, pass that row's `id` as a FastSpring order tag
 * (FastSpring round-trips custom tags onto the resulting webhook event's
 * `data.tags` — confirm the exact field name against FastSpring's current
 * docs when connecting, this has never received a real payload). This
 * function then resolves the invoice via `fastspringReference` and marks
 * it paid.
 */
export async function markCrmInvoicePaidFromFastSpringEvent(event: {
  type: string;
  data?: Record<string, unknown>;
}) {
  if (event.type !== "order.completed" && event.type !== "subscription.charge.completed") {
    return null;
  }

  const tags = event.data?.tags as Record<string, unknown> | undefined;
  const reference = typeof tags?.crmInvoiceId === "string" ? tags.crmInvoiceId : undefined;
  if (!reference) return null;

  const [invoice] = await db
    .select()
    .from(crmInvoices)
    .where(eq(crmInvoices.fastspringReference, reference))
    .limit(1);
  if (!invoice || invoice.status === "paid") return null;

  const [updated] = await db
    .update(crmInvoices)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(crmInvoices.id, invoice.id))
    .returning();

  await logCrmAudit({
    action: "crm.invoice_status_changed",
    targetType: "crm_invoice",
    targetId: invoice.id,
    clientId: invoice.clientId ?? undefined,
    metadata: { status: "paid", invoiceNumber: invoice.invoiceNumber, source: "fastspring_webhook_prepared" },
  });

  return updated;
}
