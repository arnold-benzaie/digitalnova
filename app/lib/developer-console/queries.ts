import "server-only";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, integrationApiRateLimitHits, integrations, memberships, roles, subscriptions, users } from "@/db/schema";
import { resolveApiLimitsForOrg } from "@/lib/api-v1/billing-plan";
import type { ApiPlanLimits } from "@/lib/billing/api-limits";

export {
  listApiKeysForOrg,
  getApiKeyForOrg,
  listWebhookEndpointsForOrg,
  getWebhookEndpointForOrg,
  listWebhookEndpointSubscriptions,
  listRecentDeliveriesForEndpoint,
  listTestRunsForOrg,
} from "@/lib/integrations/queries";

/**
 * Read queries backing /developers/console — the self-service
 * counterpart to lib/integrations/queries.ts (which stays admin-only;
 * its listApiKeysForOrg is re-exported above, reused as-is, since a read
 * already correctly scoped by organizationId is equally safe for a
 * member reading their own org's data).
 */

/** The org's default integration (see lib/integrations/default-integration.ts) —
 * read-only, deliberately does NOT create one if missing (a page view must
 * never have a side effect); the Console shows an empty state instead and
 * only calls getOrCreateDefaultIntegration indirectly, via createDeveloperApiKey,
 * the first time a member actually creates a key. */
export async function getIntegrationForOrg(organizationId: string) {
  const [row] = await db
    .select({
      id: integrations.id,
      name: integrations.name,
      status: integrations.status,
      createdAt: integrations.createdAt,
    })
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.status, "active")))
    .orderBy(integrations.createdAt)
    .limit(1);
  return row;
}

export type OrgPlanSummary = {
  plan: string | null;
  status: string | null;
  limits: ApiPlanLimits;
};

/** Plan name/status is read directly here (same small query already
 * duplicated in lib/actions/billing.ts / app/admin/billing/page.tsx /
 * app/dashboard/settings/page.tsx, per resolveApiLimitsForOrg's own
 * docstring) — the actual LIMIT NUMBERS still come from
 * resolveApiLimitsForOrg() itself, never re-derived here, so the
 * Free/past_due/canceled fallback rule stays defined in exactly one
 * place. */
export async function getOrgPlanSummary(organizationId: string): Promise<OrgPlanSummary> {
  const [subscription] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  const limits = await resolveApiLimitsForOrg(organizationId);
  return { plan: subscription?.plan ?? null, status: subscription?.status ?? null, limits };
}

export type ApiKeyUsageWindow = { limit: number; used: number; remaining: number };

/**
 * Current-window request counts for one key/organization — reads the
 * SAME fixed-window rows lib/api-v1/rate-limit.ts's checkRateLimit()
 * writes on every /api/v1 request (integration_api_rate_limit_hits),
 * replicating its exact key format (scope:identifier:windowStartMs) to
 * look them up. Read-only: never increments anything, so viewing the
 * Console can never itself consume a request's worth of quota.
 *
 * This is "requests used in the current window," not a historical
 * time series — a real usage dashboard with retention/latency/error
 * breakdowns needs new per-request instrumentation not built in this
 * stage (see the architecture plan's Stage 4).
 */
export async function getApiKeyUsageWindows(
  apiKeyId: string,
  organizationId: string,
  limits: ApiPlanLimits,
): Promise<{ perMinute: ApiKeyUsageWindow; perDay: ApiKeyUsageWindow }> {
  const now = Date.now();

  async function currentCount(scope: string, identifier: string, windowSeconds: number): Promise<number> {
    const windowStartMs = Math.floor(now / (windowSeconds * 1000)) * (windowSeconds * 1000);
    const key = `${scope}:${identifier}:${windowStartMs}`;
    const [row] = await db.select({ count: integrationApiRateLimitHits.count }).from(integrationApiRateLimitHits).where(eq(integrationApiRateLimitHits.key, key)).limit(1);
    return row?.count ?? 0;
  }

  const [minuteUsed, dayUsed] = await Promise.all([
    currentCount("api:minute", apiKeyId, 60),
    currentCount("api:day", organizationId, 86_400),
  ]);

  return {
    perMinute: { limit: limits.requestsPerMinute, used: minuteUsed, remaining: Math.max(0, limits.requestsPerMinute - minuteUsed) },
    perDay: { limit: limits.requestsPerDay, used: dayUsed, remaining: Math.max(0, limits.requestsPerDay - dayUsed) },
  };
}

export type ApiKeyEvent = {
  id: string;
  action: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
};

/** The self-service "apikey.*" audit trail (see lib/developer-console/actions.ts) —
 * distinct from the admin path's "integration_api_key.*" namespace on the
 * same audit_log table, so this never shows staff-originated events (or
 * vice versa) as if a Console member had performed them. */
export async function getApiKeyEvents(
  organizationId: string,
  options: { limit?: number; apiKeyId?: string } = {},
): Promise<ApiKeyEvent[]> {
  const limit = options.limit ?? 50;
  const conditions = [eq(auditLog.organizationId, organizationId), like(auditLog.action, "apikey.%")];
  if (options.apiKeyId) conditions.push(eq(auditLog.targetId, options.apiKeyId));
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorName: users.fullName,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows;
}

export type OrgMember = {
  userId: string;
  fullName: string | null;
  email: string;
  role: string;
  memberSince: Date;
};

/** Who can reach this Console for this organization — access is granted
 * to ANY active membership (see lib/session.ts's requireSession(), which
 * this Console gates on), not restricted to a further role tier; this
 * roster exists to make that fact visible, not to enforce a finer-grained
 * permission system that doesn't exist yet in db/schema.ts's roles table
 * (a flat admin/staff/agent/supervisor/client set — see the Stage 3
 * report for why a real per-member permission model wasn't invented here). */
export async function listOrgMembers(organizationId: string): Promise<OrgMember[]> {
  return db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      role: roles.name,
      memberSince: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(memberships.createdAt);
}
