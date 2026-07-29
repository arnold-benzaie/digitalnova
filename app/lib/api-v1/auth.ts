import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationApiKeys, integrations } from "@/db/schema";
import { verifyIntegrationApiKey } from "@/lib/integrations/crypto";
import { isKnownIntegrationScope, type IntegrationScope } from "@/lib/integrations/governance";
import { logAudit } from "@/lib/audit";
import { ApiError, type ApiErrorCode } from "@/lib/api-v1/errors";
import { resolveApiLimitsForOrg } from "@/lib/api-v1/billing-plan";
import { buildUsageHeaders, checkRateLimit, type RateLimitCheck } from "@/lib/api-v1/rate-limit";

/**
 * Authentication for the public `/api/v1/*` REST API. Deliberately a
 * SEPARATE path from the human Clerk session (lib/session.ts,
 * lib/dev-role.ts) — an API key represents an external, untrusted-by-
 * default caller (n8n, Make, Zapier, a custom client), never a signed-in
 * staff member. `proxy.ts` excludes "/api/v1" from Clerk's auth.protect()
 * for exactly this reason; every /api/v1 route MUST call
 * authenticateApiRequest() itself as its only gate.
 *
 * Key format (see lib/integrations/crypto.ts's generateIntegrationApiKey):
 *   pm_{live|test}_{lookupId:12 chars}_{secret:43 chars}
 * lookupId and secret are both base64url — that alphabet includes "_", so
 * the secret can itself contain underscores. Splitting the whole key on
 * "_" is WRONG and will misparse a real key. Every segment before the
 * secret has a fixed, known length, so parseApiKey below slices by
 * position instead of searching for a delimiter.
 *
 * Threat-model notes (see also SECURITY.md in this directory):
 * - Two different failure reasons — "no key with this lookupId" and
 *   "key found but secret doesn't match" — are collapsed into the SAME
 *   INVALID_API_KEY error, with no lookupId oracle: even on a lookup
 *   miss, a decoy HMAC comparison still runs (verifyApiKeySecret below)
 *   so response timing doesn't reveal whether a lookupId exists.
 * - Once the secret itself verifies (proof the caller holds the real
 *   key), later checks (revoked/expired/scope) get specific, distinct
 *   error codes — that's safe and useful, since only the true keyholder
 *   can ever reach that branch.
 * - Failures are logged via logAudit() with the key's prefix at most
 *   (never the secret, never the full presented key) — see
 *   logAuthFailure below.
 */

const KEY_ENVIRONMENTS = ["live", "test"] as const;
const LOOKUP_ID_LENGTH = 12;

/** A fixed, never-matching hash used only to keep verification timing
 * consistent when no row was found for the presented lookupId — see the
 * threat-model note above. Any syntactically valid hex of the right
 * shape works; it never needs to correspond to a real key. */
const DECOY_KEY_HASH = "0".repeat(64);

export type ParsedApiKey = {
  environment: "live" | "test";
  lookupId: string;
  keyPrefix: string;
};

/**
 * Fixed-position parse — NEVER use .split("_") here (see module docstring).
 * Returns null (never throws) on anything malformed; the caller turns
 * that into an INVALID_API_KEY / MALFORMED_API_KEY response.
 */
export function parseApiKey(rawKey: string): ParsedApiKey | null {
  if (typeof rawKey !== "string" || !rawKey.startsWith("pm_")) return null;

  const afterPrefix = rawKey.slice(3); // strip "pm_"
  const environment = KEY_ENVIRONMENTS.find((env) => afterPrefix.startsWith(`${env}_`));
  if (!environment) return null;

  const afterEnv = afterPrefix.slice(environment.length + 1); // strip "live_" / "test_"
  if (afterEnv.length <= LOOKUP_ID_LENGTH + 1) return null; // needs lookupId + "_" + >=1 secret char

  const lookupId = afterEnv.slice(0, LOOKUP_ID_LENGTH);
  if (afterEnv[LOOKUP_ID_LENGTH] !== "_") return null; // separator must land exactly here

  const secret = afterEnv.slice(LOOKUP_ID_LENGTH + 1);
  if (!secret) return null;

  return { environment, lookupId, keyPrefix: `pm_${environment}_${lookupId}` };
}

/** `Authorization: Bearer <key>` takes priority; `X-Api-Key: <key>` is the fallback. */
export function extractApiKeyFromRequest(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader?.trim()) return apiKeyHeader.trim();
  return null;
}

/** Auth-specific subtype of the shared ApiError (lib/api-v1/errors.ts) —
 * same code/status mapping, kept as its own class only so callers/tests
 * can narrow on `instanceof ApiAuthError` when they specifically care
 * that a request never even reached business logic. */
export class ApiAuthError extends ApiError {}

export type ApiAuthContext = {
  apiKeyId: string;
  keyPrefix: string;
  integrationId: string;
  organizationId: string;
  scopes: string[];
  /** For the route to attach the X-RateLimit-* and X-Quota-* headers on
   * its success response — see lib/api-v1/rate-limit.ts's buildUsageHeaders. */
  rateLimit: { perMinute: RateLimitCheck; perDay: RateLimitCheck };
};

async function logAuthFailure(input: {
  code: ApiErrorCode;
  route: string;
  keyPrefix?: string;
  apiKeyId?: string;
  organizationId?: string;
}) {
  // Never the secret, never the full presented key — keyPrefix (public,
  // non-secret) at most, exactly like the rest of the integrations
  // feature only ever shows keyPrefix/lookupId/urlOrigin in UI and logs.
  await logAudit({
    organizationId: input.organizationId,
    action: "api_v1.auth_failed",
    targetType: "integration_api_key",
    targetId: input.apiKeyId,
    metadata: { code: input.code, route: input.route, keyPrefix: input.keyPrefix },
  }).catch(() => {
    // Auditing a failed auth attempt must never itself crash the request —
    // the caller still gets a clean 401/403 even if this write fails.
  });
}

/**
 * The single gate every /api/v1 route must call first. Verifies the
 * presented key, its status/expiry, the owning integration's
 * status/expiry, and (if requiredScope is given) that the key carries
 * that scope. Returns the authenticated context — apiKeyId,
 * integrationId, and organizationId (derived ONLY from the verified key
 * via a server-side join, never from any client-supplied header/query
 * param) — for the caller to use as the sole source of truth for every
 * downstream query. A route that filters its data by
 * `context.organizationId` can never leak another organization's data,
 * because that value cannot be spoofed by the request.
 *
 * Throws ApiAuthError on any failure — callers convert it via
 * lib/api-v1/response.ts's handleApiError().
 */
export async function authenticateApiRequest(
  request: Request,
  options: { requiredScope?: IntegrationScope } = {},
): Promise<ApiAuthContext> {
  const route = new URL(request.url).pathname;

  const rawKey = extractApiKeyFromRequest(request);
  if (!rawKey) {
    await logAuthFailure({ code: "MISSING_API_KEY", route });
    throw new ApiAuthError("MISSING_API_KEY", "No API key provided. Send it as \"Authorization: Bearer <key>\" or \"X-Api-Key: <key>\".");
  }

  const parsed = parseApiKey(rawKey);
  if (!parsed) {
    await logAuthFailure({ code: "MALFORMED_API_KEY", route });
    throw new ApiAuthError("MALFORMED_API_KEY", "The provided API key is not in a recognized format.");
  }

  if (!process.env.INTEGRATION_API_KEY_PEPPER) {
    throw new ApiAuthError("SERVICE_NOT_CONFIGURED", "The API is not configured on this environment.");
  }

  const [row] = await db
    .select({
      id: integrationApiKeys.id,
      keyHash: integrationApiKeys.keyHash,
      status: integrationApiKeys.status,
      expiresAt: integrationApiKeys.expiresAt,
      scopes: integrationApiKeys.scopes,
      integrationId: integrationApiKeys.integrationId,
    })
    .from(integrationApiKeys)
    .where(eq(integrationApiKeys.lookupId, parsed.lookupId))
    .limit(1);

  // Decoy comparison on a lookup miss keeps response timing indistinguishable
  // from a real "wrong secret" rejection — see the module docstring.
  // verifyIntegrationApiKey() re-hashes rawKey internally either way, so
  // this branch runs the same HMAC + compare cost as a real check.
  const verified = verifyIntegrationApiKey(rawKey, row ? row.keyHash : DECOY_KEY_HASH);

  if (!row || !verified) {
    await logAuthFailure({ code: "INVALID_API_KEY", route, keyPrefix: parsed.keyPrefix });
    throw new ApiAuthError("INVALID_API_KEY", "Invalid API key.");
  }

  if (row.status !== "active") {
    const code: ApiErrorCode = row.status === "revoked" ? "API_KEY_REVOKED" : "API_KEY_EXPIRED";
    await logAuthFailure({ code, route, keyPrefix: parsed.keyPrefix, apiKeyId: row.id });
    throw new ApiAuthError(code, row.status === "revoked" ? "This API key has been revoked." : "This API key is no longer active.");
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    await logAuthFailure({ code: "API_KEY_EXPIRED", route, keyPrefix: parsed.keyPrefix, apiKeyId: row.id });
    throw new ApiAuthError("API_KEY_EXPIRED", "This API key has expired.");
  }

  const [integration] = await db
    .select({
      id: integrations.id,
      organizationId: integrations.organizationId,
      status: integrations.status,
      expiresAt: integrations.expiresAt,
    })
    .from(integrations)
    .where(eq(integrations.id, row.integrationId))
    .limit(1);

  if (!integration || !integration.organizationId || integration.status !== "active") {
    await logAuthFailure({ code: "INTEGRATION_INACTIVE", route, keyPrefix: parsed.keyPrefix, apiKeyId: row.id });
    throw new ApiAuthError("INTEGRATION_INACTIVE", "The integration owning this API key is not active.");
  }

  if (integration.expiresAt && integration.expiresAt.getTime() <= Date.now()) {
    await logAuthFailure({
      code: "INTEGRATION_EXPIRED",
      route,
      keyPrefix: parsed.keyPrefix,
      apiKeyId: row.id,
      organizationId: integration.organizationId,
    });
    throw new ApiAuthError("INTEGRATION_EXPIRED", "The integration owning this API key has expired.");
  }

  if (options.requiredScope && !row.scopes.includes(options.requiredScope)) {
    await logAuthFailure({
      code: "FORBIDDEN_SCOPE",
      route,
      keyPrefix: parsed.keyPrefix,
      apiKeyId: row.id,
      organizationId: integration.organizationId,
    });
    throw new ApiAuthError("FORBIDDEN_SCOPE", `This API key does not have the required "${options.requiredScope}" scope.`);
  }

  // Rate limit (per API key, protects against one misbehaving/scraping
  // key — one combined budget across every route, NOT a separate budget
  // per route) and quota (per organization, aggregated across all its
  // keys — that's the dimension a subscription plan actually governs) —
  // see lib/api-v1/rate-limit.ts and lib/billing/api-limits.ts. Both are
  // always computed together (never short-circuited) so the response
  // headers are accurate regardless of which one — if either — failed.
  // Checked only once the request has cleared every other gate, so a
  // request that would have failed for an unrelated reason (wrong scope,
  // expired key) never consumes quota.
  const limits = await resolveApiLimitsForOrg(integration.organizationId);
  const perMinute = await checkRateLimit("api:minute", row.id, limits.requestsPerMinute, 60);
  const perDay = await checkRateLimit("api:day", integration.organizationId, limits.requestsPerDay, 86_400);
  const usageHeaders = buildUsageHeaders(perMinute, perDay);

  if (!perMinute.allowed || !perDay.allowed) {
    const code: ApiErrorCode = !perMinute.allowed ? "RATE_LIMITED" : "QUOTA_EXCEEDED";
    const retryAfterSeconds = !perMinute.allowed ? perMinute.retryAfterSeconds : perDay.retryAfterSeconds;
    await logAuthFailure({
      code,
      route,
      keyPrefix: parsed.keyPrefix,
      apiKeyId: row.id,
      organizationId: integration.organizationId,
    });
    throw new ApiAuthError(
      code,
      code === "RATE_LIMITED"
        ? "Too many requests. Slow down and retry after the indicated delay."
        : "Daily API quota exceeded for your organization's plan.",
      { ...usageHeaders, "Retry-After": String(retryAfterSeconds) },
    );
  }

  // Only ever updated on this, the success path — never on a rejected attempt.
  await db.update(integrationApiKeys).set({ lastUsedAt: new Date() }).where(eq(integrationApiKeys.id, row.id));

  return {
    apiKeyId: row.id,
    keyPrefix: parsed.keyPrefix,
    integrationId: row.integrationId,
    organizationId: integration.organizationId,
    scopes: row.scopes,
    rateLimit: { perMinute, perDay },
  };
}

/** Re-exported for callers that need to validate a scope string outside
 * of authenticateApiRequest (e.g. constructing test fixtures). */
export { isKnownIntegrationScope };
export type { IntegrationScope };

export function generateApiRequestId(): string {
  return randomUUID();
}
