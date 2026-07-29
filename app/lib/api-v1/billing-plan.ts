import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { FREE_API_LIMITS, PLAN_API_LIMITS, type ApiPlanLimits } from "@/lib/billing/api-limits";

/**
 * Resolves the /api/v1 rate/quota limits for an organization from its
 * real subscription (db/schema.ts's `subscriptions` — one row per
 * organization at most, via a unique index; an organization can have
 * ZERO rows if it never subscribed). No shared "get subscription for
 * org" helper existed before this — the same query was duplicated
 * ad hoc in lib/actions/billing.ts, app/admin/billing/page.tsx, and
 * app/dashboard/settings/page.tsx; this is that helper, scoped to what
 * this module needs (not a refactor of those three call sites).
 *
 * Rule, confirmed with the user: `active` or `trialing` -> the plan's
 * real limits; no subscription at all, `past_due`, or `canceled` -> the
 * implicit Free tier (FREE_API_LIMITS) — the API stays usable enough to
 * evaluate, never fully blocked, consistent with the rest of the app
 * (subscription status has never gated feature access anywhere else).
 */
export async function resolveApiLimitsForOrg(organizationId: string): Promise<ApiPlanLimits> {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);

  if (!subscription) return FREE_API_LIMITS;
  if (subscription.status !== "active" && subscription.status !== "trialing") return FREE_API_LIMITS;

  return PLAN_API_LIMITS[subscription.plan] ?? FREE_API_LIMITS;
}
