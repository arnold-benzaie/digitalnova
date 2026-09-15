import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase C-1 — the minimal guard-rail against an
 * accidental explosion of provider calls (mission section 9: "aucune
 * facturation complexe... uniquement le garde-fou nécessaire à C-1").
 *
 * REUSE, NOT DUPLICATION: this is a thin wrapper around
 * lib/api-v1/rate-limit.ts::checkRateLimit() — the SAME atomic,
 * DB-backed, fixed-window primitive already reused by
 * crm-quote-access.ts, crm-invoice-access.ts, crm-invoice-payment.ts,
 * crm-quotes.ts, app/api/chat/route.ts, and (Phase G4D) the RADAR
 * advisory cooldown. No second rate-limit table, no second algorithm.
 *
 * SCOPE: a fixed, GLOBAL identifier ("global") per provider id — there is
 * no per-user caller identity available at this layer yet (C-1 builds no
 * server action / UI; mission section 16/17). Mirrors
 * quota-counter-store.ts's own "global:<date>"-style scoping precedent
 * for the same reason: an aggregate call-volume guard, not a per-user
 * throttle (that would need a real caller identity, which does not exist
 * in this phase).
 *
 * FAIL-CLOSED (mission section 9's "fail-closed si le mécanisme l'exige"
 * — deliberately the OPPOSITE fail-direction from G4D's own advisory
 * cooldown, which fails OPEN): unlike G4D's cooldown, which is backstopped
 * by an unrelated, still-fail-closed AI quota gate, THIS check is the
 * ONLY guard between a caller and a real, billable external API call —
 * there is no other boundary behind it in C-1. If checkRateLimit() itself
 * throws (a transient store outage), this gate denies the call rather
 * than risk an unbounded, unguarded burst of real Google requests.
 */
import { checkRateLimit } from "@/lib/api-v1/rate-limit";

const DISCOVERY_RATE_LIMIT_SCOPE = "radar_discovery_provider";
/** Conservative placeholder guard-rail, NOT a calibrated production
 * budget (mission section 9 explicitly forbids building real billing in
 * C-1) — sized only to stop an accidental runaway loop, easily revisited
 * once real usage data exists. */
export const DISCOVERY_RATE_LIMIT_MAX_REQUESTS = 10;
export const DISCOVERY_RATE_LIMIT_WINDOW_SECONDS = 60;

export type DiscoveryRateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * `providerId` keys the window so one provider's volume never starves
 * another future provider's own budget. Never throws — a genuine store
 * failure is caught here and turned into a deny (fail-closed), logged by
 * the caller via observability.ts, never swallowed silently.
 */
export async function checkDiscoveryProviderRateLimit(providerId: string): Promise<DiscoveryRateLimitDecision> {
  try {
    const result = await checkRateLimit(DISCOVERY_RATE_LIMIT_SCOPE, `${providerId}:global`, DISCOVERY_RATE_LIMIT_MAX_REQUESTS, DISCOVERY_RATE_LIMIT_WINDOW_SECONDS);
    if (!result.allowed) return { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
    return { allowed: true };
  } catch {
    // Fail-closed — see this file's own header for why this is the
    // opposite direction from G4D's advisory cooldown.
    return { allowed: false, retryAfterSeconds: DISCOVERY_RATE_LIMIT_WINDOW_SECONDS };
  }
}
