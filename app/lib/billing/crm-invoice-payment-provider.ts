import "server-only";

/**
 * Chantier 2 / Phase 3 — a dedicated, minimal abstraction for CRM invoice
 * payments (an agency client paying a one-off crm_invoices row).
 * Deliberately NOT lib/billing/types.ts's BillingProvider: that interface
 * is shaped around a subscribing organization picking a catalogued plan
 * (organizationId + planId) — it has no way to express a one-off,
 * dynamic-amount invoice checkout, and reusing it would blur two
 * completely separate billing domains (platform SaaS subscriptions vs.
 * the agency's own client invoices). Nothing here is imported by, or
 * imports, lib/billing/index.ts / types.ts / mock-provider.ts.
 *
 * A real FastSpring-backed implementation can be added later behind this
 * same interface, in its own file, without touching the platform billing
 * code at all.
 */

export type InvoiceCheckoutInput = {
  /** crmInvoices.id — the future order tag sent to the payment provider.
   * Never crmInvoices.fastspringReference, which stays null until a real
   * payment is actually confirmed by a signed provider webhook (a later
   * phase) — see lib/billing/crm-invoice-webhook.ts. */
  invoiceReference: string;
  amountCents: number;
  currency: string;
};

export type InvoiceCheckoutSession = {
  url: string;
  sessionId: string;
};

export interface CrmInvoicePaymentProvider {
  createInvoiceCheckout(input: InvoiceCheckoutInput): Promise<InvoiceCheckoutSession>;
}

/**
 * No real FastSpring credentials exist for CRM invoice payments yet (this
 * domain's real provider hasn't been built at all — prepared-not-connected,
 * see lib/billing/crm-invoice-webhook.ts). Never contacts any network,
 * fully deterministic, no side effect beyond returning a mock session
 * descriptor. Never marks anything paid, never writes paidAt or
 * fastspringReference: a "checkout prepared" is not a "payment received" —
 * that distinction only exists once a real webhook confirms an actual
 * payment.
 */
export class MockCrmInvoicePaymentProvider implements CrmInvoicePaymentProvider {
  async createInvoiceCheckout(input: InvoiceCheckoutInput): Promise<InvoiceCheckoutSession> {
    return {
      url: `/mock-crm-checkout/${input.invoiceReference}?amount=${input.amountCents}&currency=${input.currency}`,
      sessionId: `mock-crm-checkout-${input.invoiceReference}-${Date.now()}`,
    };
  }
}

/** Always resolves to the mock provider for now — swap in a real
 * FastSpring-backed CrmInvoicePaymentProvider here once a real account and
 * credentials exist for this domain (see the Chantier 2 Phase 2 audit). */
export function getCrmInvoicePaymentProvider(): CrmInvoicePaymentProvider {
  return new MockCrmInvoicePaymentProvider();
}
