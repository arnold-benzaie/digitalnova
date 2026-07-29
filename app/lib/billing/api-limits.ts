/**
 * `/api/v1` request limits per subscription plan — deliberately code
 * constants here in `lib/billing/`, next to `mock-provider.ts`'s `PLANS`
 * array, rather than a new DB table: plan-tier facts are already
 * hardcoded (no live FastSpring storefront yet — see mock-provider.ts's
 * own docstring), and these limits are global configuration, not
 * per-organization state (the per-organization state — how many requests
 * an org has actually made — lives in the DB, see
 * lib/api-v1/rate-limit.ts). Keeping both kinds of plan facts in the
 * same place avoids a second, DB-backed source of truth for something
 * that isn't per-row data.
 *
 * These are a first, clearly-adjustable draft — not derived from any
 * existing number in the codebase (none existed before this stage).
 *
 * Distinct from `integrations.dailyEventQuota`/`quotaEnforcedAt`
 * (db/schema.ts) — those are a different, still-dormant concept for
 * OUTBOUND webhook delivery volume, not INBOUND /api/v1 request volume.
 * This module is not touching that field.
 */

export type ApiPlanLimits = {
  requestsPerMinute: number;
  requestsPerDay: number;
};

/** Applied when an organization has no subscription row at all, or its
 * subscription status is "past_due"/"canceled" — enough to evaluate the
 * API, not enough to run real production traffic on. */
export const FREE_API_LIMITS: ApiPlanLimits = { requestsPerMinute: 30, requestsPerDay: 1_000 };

/** Keyed by `subscriptions.plan` (db/schema.ts) — matches
 * lib/billing/mock-provider.ts's PLANS ids exactly ("starter" | "pro" | "agency"). */
export const PLAN_API_LIMITS: Record<string, ApiPlanLimits> = {
  starter: { requestsPerMinute: 60, requestsPerDay: 5_000 },
  pro: { requestsPerMinute: 120, requestsPerDay: 20_000 },
  agency: { requestsPerMinute: 300, requestsPerDay: 100_000 },
};
