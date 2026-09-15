import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase C-2A — the PER-ACTOR guard-rail, in
 * ADDITION to (never a replacement for) rate-limit-gate.ts's own
 * provider-level global guard. That file protects the AGGREGATE Google
 * call volume across every caller combined; this one protects fairness
 * between individual callers — without it, a single actor could
 * legitimately consume the entire shared provider-level budget alone
 * (identified as a documented, non-blocking C-1 review finding — this
 * file is the fix, scoped exactly as that review anticipated).
 *
 * REUSE, NOT DUPLICATION: the SAME lib/api-v1/rate-limit.ts::checkRateLimit()
 * primitive, a DIFFERENT scope string ("radar_discovery_actor" vs.
 * rate-limit-gate.ts's own "radar_discovery_provider") so the two windows
 * can never collide or share a counter.
 *
 * LIMIT CHOICE (documented, per mission section 5): 5 requests / 60s per
 * actor — deliberately LOWER than rate-limit-gate.ts's own
 * DISCOVERY_RATE_LIMIT_MAX_REQUESTS (10/60s). This is intentional: with a
 * per-actor cap strictly below the shared global cap, at least two
 * distinct actors can always search within the same window before the
 * global budget is exhausted by either alone — a minimal fairness
 * guarantee, not a calibrated production budget (same "placeholder
 * guard-rail" framing rate-limit-gate.ts's own constant already carries).
 *
 * FAIL-CLOSED, for the exact same reason rate-limit-gate.ts is
 * fail-closed: this is a real boundary in front of a billable external
 * call, not a soft UX nicety.
 */
import { checkRateLimit } from "@/lib/api-v1/rate-limit";
import type { DiscoveryRateLimitDecision } from "./rate-limit-gate";

const DISCOVERY_ACTOR_RATE_LIMIT_SCOPE = "radar_discovery_actor";
export const DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS = 5;
export const DISCOVERY_ACTOR_RATE_LIMIT_WINDOW_SECONDS = 60;

export type { DiscoveryRateLimitDecision };

/**
 * `userId` MUST be the server-resolved session identity
 * (requireSession().userId) — never a caller-supplied value. This
 * function has no way to verify that on its own; the calling action is
 * responsible for never passing anything else.
 */
export async function checkDiscoveryActorRateLimit(userId: string): Promise<DiscoveryRateLimitDecision> {
  try {
    const result = await checkRateLimit(DISCOVERY_ACTOR_RATE_LIMIT_SCOPE, userId, DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS, DISCOVERY_ACTOR_RATE_LIMIT_WINDOW_SECONDS);
    if (!result.allowed) return { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
    return { allowed: true };
  } catch {
    // Fail-closed — see this file's own header.
    return { allowed: false, retryAfterSeconds: DISCOVERY_ACTOR_RATE_LIMIT_WINDOW_SECONDS };
  }
}
