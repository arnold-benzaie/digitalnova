import { MockBillingProvider } from "./mock-provider";
import type { BillingProvider } from "./types";

/**
 * No real FastSpring credentials exist yet (FASTSPRING_API_USERNAME/
 * PASSWORD unset — see README). Always resolves to the mock provider for
 * now; swap in a real FastSpring-backed BillingProvider here once the
 * account + storefront are set up.
 */
export function getBillingProvider(): BillingProvider {
  return new MockBillingProvider();
}

export type { BillingProvider, CheckoutSession, Plan } from "./types";
