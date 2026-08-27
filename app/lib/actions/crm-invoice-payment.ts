"use server";

import { CURRENCY_VALUES } from "@/lib/crm-billing";
import { resolveInvoiceByToken } from "@/lib/actions/crm-invoice-access";
import { getCrmInvoicePaymentProvider } from "@/lib/billing/crm-invoice-payment-provider";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";

/** Chantier 2 Phase 3: conservative on purpose — only a freshly-sent
 * invoice may start a checkout. "delivery_failed" is deliberately NOT
 * included yet (per this phase's explicit scope); revisit in a later
 * phase once the rest of the payment flow exists. */
const ELIGIBLE_STATUS = "sent";

export type InvoiceCheckoutFailureReason =
  | "not_found"
  | "locked"
  | "revoked"
  | "expired"
  | "rate_limited"
  | "not_eligible"
  | "invalid_amount"
  | "invalid_currency"
  | "checkout_rate_limited"
  | "provider_error";

export type InvoiceCheckoutResult = { ok: true; url: string; sessionId: string } | { ok: false; reason: InvoiceCheckoutFailureReason };

/**
 * Chantier 2 / Phase 3 — PUBLIC, no Clerk session, no staff role. Same
 * authorization model already validated for respondToQuoteByToken
 * (Chantier 1 Phase 4): possession of a valid, non-revoked, non-expired
 * invoice token is the entire credential. The caller supplies ONLY the
 * token — invoiceId, amount, currency, and status are never accepted from
 * the browser; every financial value used below is re-read from
 * resolveInvoiceByToken's own resolved row, never trusted from the caller.
 *
 * This function prepares a checkout — it NEVER marks anything paid,
 * writes paidAt, or writes fastspringReference (it performs no database
 * write of any kind). Those only ever happen once a real, signed
 * payment-provider webhook confirms an actual payment (a later phase) —
 * "a checkout was created" proves nothing about money having changed
 * hands.
 */
export async function createInvoicePaymentCheckout(token: string): Promise<InvoiceCheckoutResult> {
  const resolved = await resolveInvoiceByToken(token);
  if (!resolved.ok) return resolved;

  const { invoice } = resolved;

  if (invoice.status !== ELIGIBLE_STATUS) {
    return { ok: false, reason: "not_eligible" };
  }

  // Financial values come exclusively from the stored snapshot — never
  // recomputed from crmInvoiceItems, never touching Catalogue pricing.
  if (!Number.isFinite(invoice.totalCents) || invoice.totalCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  if (!CURRENCY_VALUES.includes(invoice.currency)) {
    return { ok: false, reason: "invalid_currency" };
  }

  // A dedicated, tight throttle on checkout CREATION specifically —
  // separate from resolveInvoiceByToken's own IP-based rate limit above
  // (crm_invoice_token), which already covers abuse of the token itself.
  // Keyed by the invoice's own id (not IP), same identifier-choice
  // reasoning as Chantier 1 Phase 3's crm_quote_send scope (keyed by
  // quoteId) — this tracks "how many checkout sessions has THIS invoice
  // generated recently," regardless of which network the caller is on.
  // Reuses the existing checkRateLimit helper; no new infrastructure.
  const rate = await checkRateLimit("crm_invoice_checkout", invoice.id, 3, 60);
  if (!rate.allowed) {
    return { ok: false, reason: "checkout_rate_limited" };
  }

  try {
    const provider = getCrmInvoicePaymentProvider();
    const session = await provider.createInvoiceCheckout({
      invoiceReference: invoice.id,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
    });
    return { ok: true, url: session.url, sessionId: session.sessionId };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}
