import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmInvoices } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { CURRENCY_VALUES } from "@/lib/crm-billing";

/**
 * Chantier 2 / Phase 4 — the CRM invoice payment business logic, kept
 * strictly separate from FastSpring itself. This function does NOT verify
 * network authenticity (no signature, no secret, no HTTP) — that is a
 * future route layer's job, exactly like every other webhook-adjacent
 * business-logic function in this codebase is decoupled from its
 * transport. The caller of this function is responsible for having
 * already verified the event came from a legitimate, signed provider
 * payload before ever constructing this input.
 *
 * PREPARED, NOT WIRED TO ANY ROUTE — see app/api/webhooks/fastspring/route.ts,
 * which still handles only the platform's own subscription billing and does
 * not call this function. Connecting a real route is out of this phase's
 * scope.
 */

export type CrmInvoicePaymentEvent = {
  /** Gated below against SUPPORTED_EVENT_TYPES — fail-closed: an
   * unrecognized type never marks anything paid. Kept deliberately narrow
   * to only "order.completed" (a real, documented FastSpring order event —
   * see the Chantier 2 Phase 3 authorization's confirmed documentation
   * reference), not "subscription.charge.completed" (the platform's own
   * subscription-billing vocabulary, out of place for a one-off CRM
   * invoice). A future route layer decides which raw provider events even
   * get translated into a call here at all; this is a second, independent
   * gate against a malformed or unexpected internal event shape. */
  eventType: string;
  /** crmInvoices.id — the same UUID minted as the checkout's
   * invoiceReference in Phase 3 (lib/actions/crm-invoice-payment.ts).
   * NEVER crmInvoices.fastspringReference — that column is written BY
   * this function, on confirmed payment, never read as a lookup key. */
  crmInvoiceId: string;
  /** The provider's own transaction/order identifier — recorded into
   * crmInvoices.fastspringReference only on a real transition, never
   * overwritten once set to a different value. */
  providerReference: string;
  amountCents: number;
  currency: string;
};

const SUPPORTED_EVENT_TYPES = ["order.completed"];

export type CrmInvoicePaymentFailureReason =
  | "unsupported_event_type"
  | "invoice_not_found"
  | "invalid_reference"
  | "invalid_amount"
  | "invalid_currency"
  | "amount_mismatch"
  | "currency_mismatch"
  | "reference_conflict"
  | "not_eligible";

export type CrmInvoicePaymentResult = { ok: true; alreadyPaid: boolean } | { ok: false; reason: CrmInvoicePaymentFailureReason };

/** Chantier 2 Phase 4: conservative on purpose — only a freshly-sent
 * invoice may be confirmed paid this way. "delivery_failed" is
 * deliberately NOT included yet, same reasoning as Phase 3's checkout
 * eligibility. */
const ELIGIBLE_STATUS = "sent";

/**
 * Marks a CRM invoice paid from an already-verified payment event —
 * strictly conditional, atomic, and idempotent.
 *
 * Identification is exclusively by crmInvoices.id (event.crmInvoiceId),
 * never by fastspringReference, which this function only ever WRITES,
 * once, on a genuine transition. Amount and currency must match the
 * invoice's own stored snapshot exactly — no tolerance, no reconstruction
 * from crmInvoiceItems or Catalogue pricing. The sent -> paid transition
 * itself happens in a single conditional UPDATE (WHERE status = 'sent'),
 * so two concurrent/duplicate events for the same invoice can only ever
 * produce one real transition and one audit entry — the loser simply
 * observes the winner's already-applied state and returns an idempotent
 * no-op.
 */
export async function markCrmInvoicePaidFromPaymentEvent(event: CrmInvoicePaymentEvent): Promise<CrmInvoicePaymentResult> {
  if (!SUPPORTED_EVENT_TYPES.includes(event.eventType)) {
    return { ok: false, reason: "unsupported_event_type" };
  }

  const [invoice] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, event.crmInvoiceId)).limit(1);
  if (!invoice) return { ok: false, reason: "invoice_not_found" };

  if (!event.providerReference || !event.providerReference.trim()) {
    return { ok: false, reason: "invalid_reference" };
  }
  if (!Number.isFinite(event.amountCents) || event.amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  if (!CURRENCY_VALUES.includes(event.currency)) {
    return { ok: false, reason: "invalid_currency" };
  }

  // Amount/currency are checked against the invoice's own immutable
  // snapshot BEFORE the reference is ever consulted — deliberately, so
  // that a replay carrying the right providerReference but a tampered or
  // wrong amount/currency is never classified as a harmless idempotent
  // no-op. Only an event that matches on amount AND currency can ever be
  // recognized as "the same payment happening again."
  if (event.amountCents !== invoice.totalCents) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (event.currency !== invoice.currency) {
    return { ok: false, reason: "currency_mismatch" };
  }

  // A non-null fastspringReference means a payment was already recorded
  // for this invoice at some point — the only writer of this column is
  // this function's own atomic transition below, so a different value
  // here is a genuine conflict (never silently overwritten), while the
  // exact same value — now that amount and currency are already confirmed
  // matching above — is a genuine replay of an event already fully
  // processed.
  if (invoice.fastspringReference) {
    if (invoice.fastspringReference !== event.providerReference) {
      return { ok: false, reason: "reference_conflict" };
    }
    return { ok: true, alreadyPaid: true };
  }

  const [updated] = await db
    .update(crmInvoices)
    .set({ status: "paid", paidAt: new Date(), fastspringReference: event.providerReference })
    .where(and(eq(crmInvoices.id, invoice.id), eq(crmInvoices.status, ELIGIBLE_STATUS)))
    .returning();

  if (updated) {
    await logCrmAudit({
      action: "crm.invoice_status_changed",
      targetType: "crm_invoice",
      targetId: updated.id,
      clientId: updated.clientId ?? undefined,
      metadata: { status: "paid", invoiceNumber: updated.invoiceNumber, source: "payment_webhook" },
    });
    return { ok: true, alreadyPaid: false };
  }

  // The conditional UPDATE matched zero rows — either a concurrent event
  // for this exact same payment already won the race (re-check below), or
  // the invoice was never eligible in the first place (draft/canceled/
  // refunded/delivery_failed, or already paid via a path this function
  // didn't take).
  const [current] = await db.select({ status: crmInvoices.status, fastspringReference: crmInvoices.fastspringReference }).from(crmInvoices).where(eq(crmInvoices.id, invoice.id)).limit(1);

  if (current?.status === "paid" && current.fastspringReference === event.providerReference) {
    return { ok: true, alreadyPaid: true };
  }
  return { ok: false, reason: "not_eligible" };
}
