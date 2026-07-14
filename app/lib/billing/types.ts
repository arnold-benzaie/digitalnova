export type Plan = {
  id: string; // "starter" | "pro" | "agency"
  name: string;
  priceEuros: number;
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
