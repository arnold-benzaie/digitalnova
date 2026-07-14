import { MockGbpProvider } from "./mock-provider";
import type { GbpProvider } from "./types";

/**
 * No real Google OAuth credentials or GBP API access exist yet (empty
 * GOOGLE_CLIENT_ID/SECRET, API access request not filed — see README
 * "Accounts you need to create"). Always resolves to the mock provider for
 * now; swap in a real Google-backed GbpProvider here once both are in place.
 */
export function getGbpProvider(): GbpProvider {
  return new MockGbpProvider();
}

export type { GbpDailyMetric, GbpLocation, GbpProvider, GbpReview } from "./types";
