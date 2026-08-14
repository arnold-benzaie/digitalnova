import type { BillingProvider, CheckoutSession, Plan } from "./types";

// priceCad is null on all 3 plans — no real Canadian-dollar price has been
// confirmed yet (see lib/market/pricing.ts). Never invent one here.
const PLANS: Plan[] = [
  { id: "starter", name: "Starter", priceEuros: 49, priceCad: null, billingInterval: "monthly", description: "1 établissement, audit mensuel." },
  { id: "pro", name: "Pro", priceEuros: 149, priceCad: null, billingInterval: "monthly", description: "Jusqu'à 5 établissements, audits illimités, rapports automatiques." },
  { id: "agency", name: "Agence", priceEuros: 399, priceCad: null, billingInterval: "monthly", description: "Établissements illimités, accès CRM complet, support prioritaire." },
];

/**
 * Stands in for FastSpring (merchant of record — no Stripe). No real
 * FASTSPRING_API_USERNAME/PASSWORD exist yet, so this simulates an
 * instant-complete checkout instead of redirecting to a real hosted
 * storefront. Swap in a real FastSpring-backed BillingProvider in
 * lib/billing/index.ts once credentials + a storefront are configured.
 */
export class MockBillingProvider implements BillingProvider {
  listPlans(): Plan[] {
    return PLANS;
  }

  async createCheckoutSession(input: { organizationId: string; planId: string }): Promise<CheckoutSession> {
    return {
      url: `/admin/billing?mock_checkout=${input.planId}`,
      sessionId: `mock_${Date.now()}`,
    };
  }

  async cancelSubscription(): Promise<void> {
    // Real FastSpring: POST to the subscriptions API to cancel. No-op here
    // — the caller updates our own `subscriptions` row directly.
  }
}
