export type Plan = {
  id: string; // "starter" | "pro" | "agency"
  name: string;
  priceEuros: number;
  // Canadian-dollar price for the same plan — nullable because no real CAD
  // amount has been confirmed yet (see lib/market/pricing.ts's own
  // comment). Structure only: never populated with an invented value.
  priceCad: number | null;
  billingInterval: "monthly" | "yearly";
  description: string;
};

export type CheckoutSession = {
  url: string;
  sessionId: string;
};

export interface BillingProvider {
  listPlans(): Plan[];
  createCheckoutSession(input: { organizationId: string; planId: string }): Promise<CheckoutSession>;
  cancelSubscription(fastspringSubscriptionId: string): Promise<void>;
}
