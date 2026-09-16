import "server-only";

/**
 * MISSION C-2D-0-FIX — a genuine, FUNCTIONING, in-memory rate-limit check
 * for the Google Places provider, for callers that must never transitively
 * require a database connection (currently: the guarded live-smoke script
 * — scripts/radar-discovery-google-places-live-smoke.mjs).
 *
 * NOT a replacement for rate-limit-gate.ts's own DB-backed
 * checkDiscoveryProviderRateLimit() — that remains the SOLE rate limiter
 * for the real, multi-instance production path (searchRadarDiscovery(),
 * any real Vercel deployment), completely UNCHANGED by this file. This
 * file exists ONLY because createGooglePlacesProvider()
 * (google-places-provider.ts) already accepted an OPTIONAL `checkRateLimit`
 * override for exactly this purpose, but no caller ever supplied one.
 *
 * WHY IN-MEMORY IS CORRECT HERE (not a weakened protection): the DB-backed
 * limiter exists to coordinate a SHARED counter across many concurrent
 * Vercel instances serving real traffic. A one-shot local CLI script has
 * no other concurrent instance to coordinate with in the first place —
 * DB persistence was never architecturally necessary for guarding THIS
 * caller's own request volume. The guard below is real and functioning
 * (fixed-window, denies once the budget is exceeded), not a bypass.
 *
 * DELIBERATELY imports NOTHING — not even a constant — from
 * rate-limit-gate.ts: any import from that module, even a bare numeric
 * constant, re-triggers the exact `@/lib/api-v1/rate-limit` -> `@/db` ->
 * `DATABASE_URL` chain this file exists to avoid (an ES module's
 * top-level code runs in full the moment anything is imported from it,
 * regardless of which binding is actually used). The numeric budget below
 * is a deliberate, documented duplication of rate-limit-gate.ts's own
 * DISCOVERY_RATE_LIMIT_MAX_REQUESTS / DISCOVERY_RATE_LIMIT_WINDOW_SECONDS
 * values, kept in sync by convention (both guard the exact same
 * "radar_discovery_provider" concern), not by a shared import.
 *
 * Fixed-window, single-process, non-persistent: state resets on every
 * process restart — correct for a script that runs once and exits, wrong
 * for anything meant to survive across invocations or coordinate across
 * instances. Never use this for the real application path.
 */
import type { DiscoveryRateLimitDecision } from "./rate-limit-gate";

/** Mirrors rate-limit-gate.ts's own constants — see this file's own
 * header on why these are duplicated rather than imported. */
export const IN_MEMORY_DISCOVERY_RATE_LIMIT_MAX_REQUESTS = 10;
export const IN_MEMORY_DISCOVERY_RATE_LIMIT_WINDOW_SECONDS = 60;

type WindowState = { windowStartMs: number; count: number };

export type InMemoryDiscoveryRateLimitOptions = {
  maxRequests?: number;
  windowSeconds?: number;
  /** ms epoch — injectable for deterministic tests. */
  clock?: () => number;
};

/**
 * Builds a fresh, isolated in-memory limiter — a NEW Map per call, so
 * independent invocations (and tests) never share state. Matches
 * checkDiscoveryProviderRateLimit()'s own
 * `(providerId: string) => Promise<DiscoveryRateLimitDecision>` shape
 * exactly, so it is a drop-in `checkRateLimit` override for
 * createGooglePlacesProvider() / createConfiguredGooglePlacesProvider().
 */
export function createInMemoryDiscoveryRateLimit(options: InMemoryDiscoveryRateLimitOptions = {}): (providerId: string) => Promise<DiscoveryRateLimitDecision> {
  const maxRequests = options.maxRequests ?? IN_MEMORY_DISCOVERY_RATE_LIMIT_MAX_REQUESTS;
  const windowSeconds = options.windowSeconds ?? IN_MEMORY_DISCOVERY_RATE_LIMIT_WINDOW_SECONDS;
  const clock = options.clock ?? (() => Date.now());
  const windows = new Map<string, WindowState>();

  return async function checkInMemoryDiscoveryRateLimit(providerId: string): Promise<DiscoveryRateLimitDecision> {
    const now = clock();
    const windowMs = windowSeconds * 1000;
    const windowStartMs = Math.floor(now / windowMs) * windowMs;

    const existing = windows.get(providerId);
    const count = existing && existing.windowStartMs === windowStartMs ? existing.count + 1 : 1;
    windows.set(providerId, { windowStartMs, count });

    if (count <= maxRequests) {
      return { allowed: true };
    }
    const retryAfterSeconds = Math.max(0, Math.ceil((windowStartMs + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  };
}
