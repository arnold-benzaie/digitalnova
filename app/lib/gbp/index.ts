import { RealGbpProvider } from "./real-provider";
import type { GbpProvider } from "./types";

/**
 * Mock mode has been permanently removed for GBP (per explicit request,
 * once real Google Cloud credentials/scopes were confirmed configured) —
 * this always resolves to the real Google-backed provider now. If the
 * organization hasn't connected a Google account yet, or the business.manage
 * scope wasn't actually granted, the real provider's calls fail with a
 * clear, sanitized error (see lib/gbp/real-provider.ts and
 * lib/actions/gbp.ts) instead of silently substituting demo data.
 */
export async function getGbpProvider(organizationId: string): Promise<GbpProvider> {
  return new RealGbpProvider(organizationId);
}

export type { GbpDailyMetric, GbpLocation, GbpProvider, GbpReview } from "./types";
