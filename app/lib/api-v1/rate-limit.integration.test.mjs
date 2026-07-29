// Integration coverage for the /api/v1 rate-limit + quota enforcement —
// checkRateLimit() is a fixed-window counter backed by real Postgres rows
// (see lib/gbp-audit/rate-limit.test.mjs's docstring: this can't be unit
// tested without a live DB), and the RATE_LIMITED/QUOTA_EXCEEDED behavior
// wired into authenticateApiRequest() is only meaningfully provable by
// actually driving requests past the limit against the same isolated
// local Docker database as the other lib/api-v1 integration suites.
import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_API_KEY_PEPPER = "integration-test-pepper-not-a-real-secret";

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { integrationApiKeys, integrationApiRateLimitHits, integrations, organizations } = await import("@/db/schema");
const { inArray } = await import("drizzle-orm");
const { generateIntegrationApiKey } = await import("@/lib/integrations/crypto");
const { checkRateLimit } = await import("@/lib/api-v1/rate-limit");
const { FREE_API_LIMITS } = await import("@/lib/billing/api-limits");
const { GET: pingRoute } = await import("@/app/api/v1/ping/route");

const PEPPER = process.env.INTEGRATION_API_KEY_PEPPER;
const fixtureOrgIds = new Set();
const fixtureIntegrationIds = new Set();

async function createOrg() {
  const [org] = await db.insert(organizations).values({ name: `rate-limit test ${randomUUID()}` }).returning();
  fixtureOrgIds.add(org.id);
  return org;
}

async function createApiKey(organizationId) {
  const [integration] = await db
    .insert(integrations)
    .values({ organizationId, name: `api-v1 rate-limit test ${randomUUID()}`, type: "automation", status: "active" })
    .returning();
  fixtureIntegrationIds.add(integration.id);

  const generated = generateIntegrationApiKey("live", PEPPER);
  const [row] = await db
    .insert(integrationApiKeys)
    .values({
      integrationId: integration.id,
      lookupId: generated.lookupId,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      hashVersion: generated.hashVersion,
      scopes: [],
      status: "active",
    })
    .returning();
  return { plaintextKey: generated.plaintextKey, apiKeyId: row.id };
}

function pingRequest(key) {
  return new Request("https://example.com/api/v1/ping", { headers: { authorization: `Bearer ${key}` } });
}

// Mirrors the private fixed-window key construction in lib/api-v1/rate-limit.ts —
// used only to pre-seed a window at (or just under) its limit so a test can
// trigger a real 429 on the very next request, without looping the daily
// limit (1000) for real.
function windowKey(scope, identifier, windowSeconds, at = Date.now()) {
  const windowStartMs = Math.floor(at / (windowSeconds * 1000)) * (windowSeconds * 1000);
  return { key: `${scope}:${identifier}:${windowStartMs}`, windowStart: new Date(windowStartMs) };
}

after(async () => {
  if (fixtureIntegrationIds.size > 0) await db.delete(integrations).where(inArray(integrations.id, [...fixtureIntegrationIds]));
  if (fixtureOrgIds.size > 0) await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

test("checkRateLimit: allows requests while under the limit, decrementing remaining each time", async () => {
  const identifier = randomUUID();
  const first = await checkRateLimit("test:scope", identifier, 3, 60);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 2);
  const second = await checkRateLimit("test:scope", identifier, 3, 60);
  assert.equal(second.remaining, 1);
  const third = await checkRateLimit("test:scope", identifier, 3, 60);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
});

test("checkRateLimit: rejects once the limit is exceeded, remaining floors at 0", async () => {
  const identifier = randomUUID();
  for (let i = 0; i < 2; i++) await checkRateLimit("test:scope", identifier, 2, 60);
  const overLimit = await checkRateLimit("test:scope", identifier, 2, 60);
  assert.equal(overLimit.allowed, false);
  assert.equal(overLimit.remaining, 0);
  assert.ok(overLimit.retryAfterSeconds >= 0 && overLimit.retryAfterSeconds <= 60);
  assert.ok(overLimit.resetAt.getTime() > Date.now());
});

test("checkRateLimit: different identifiers under the same scope are counted independently", async () => {
  const identifierA = randomUUID();
  const identifierB = randomUUID();
  await checkRateLimit("test:scope", identifierA, 1, 60);
  const blockedA = await checkRateLimit("test:scope", identifierA, 1, 60);
  const allowedB = await checkRateLimit("test:scope", identifierB, 1, 60);
  assert.equal(blockedA.allowed, false);
  assert.equal(allowedB.allowed, true);
});

test("RATE_LIMITED: exceeding the per-minute budget on a real route returns 429 with Retry-After and accurate X-RateLimit-* headers", async () => {
  const org = await createOrg();
  const { plaintextKey } = await createApiKey(org.id);

  let last;
  for (let i = 0; i < FREE_API_LIMITS.requestsPerMinute; i++) {
    last = await pingRoute(pingRequest(plaintextKey));
    assert.equal(last.status, 200, `request ${i + 1} should still be within the per-minute budget`);
  }
  assert.equal(last.headers.get("X-RateLimit-Remaining"), "0");

  const overLimit = await pingRoute(pingRequest(plaintextKey));
  assert.equal(overLimit.status, 429);
  const body = await overLimit.json();
  assert.equal(body.error.code, "RATE_LIMITED");
  assert.ok(overLimit.headers.get("Retry-After"));
  assert.equal(overLimit.headers.get("X-RateLimit-Remaining"), "0");
  assert.equal(overLimit.headers.get("X-RateLimit-Limit"), String(FREE_API_LIMITS.requestsPerMinute));
});

test("QUOTA_EXCEEDED: a daily quota already at its ceiling rejects the next request even with per-minute room to spare", async () => {
  const org = await createOrg();
  const { plaintextKey } = await createApiKey(org.id);

  const { key, windowStart } = windowKey("api:day", org.id, 86_400);
  await db.insert(integrationApiRateLimitHits).values({ key, windowStart, count: FREE_API_LIMITS.requestsPerDay });

  const response = await pingRoute(pingRequest(plaintextKey));
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error.code, "QUOTA_EXCEEDED");
  assert.ok(response.headers.get("Retry-After"));
  assert.equal(response.headers.get("X-Quota-Remaining"), "0");
  assert.equal(response.headers.get("X-Quota-Limit"), String(FREE_API_LIMITS.requestsPerDay));
  // The per-minute budget was untouched by the pre-seeded daily quota.
  assert.equal(response.headers.get("X-RateLimit-Remaining"), String(FREE_API_LIMITS.requestsPerMinute - 1));
});

test("isolation: two API keys in the same organization have independent per-minute budgets but share one daily quota", async () => {
  const org = await createOrg();
  const keyA = await createApiKey(org.id);
  const keyB = await createApiKey(org.id);

  const responseA = await pingRoute(pingRequest(keyA.plaintextKey));
  const responseB = await pingRoute(pingRequest(keyB.plaintextKey));

  assert.equal(responseA.status, 200);
  assert.equal(responseB.status, 200);
  // Each key gets its own full per-minute allowance.
  assert.equal(responseA.headers.get("X-RateLimit-Remaining"), String(FREE_API_LIMITS.requestsPerMinute - 1));
  assert.equal(responseB.headers.get("X-RateLimit-Remaining"), String(FREE_API_LIMITS.requestsPerMinute - 1));
  // The organization's daily quota is shared and cumulative across both keys.
  assert.equal(responseA.headers.get("X-Quota-Remaining"), String(FREE_API_LIMITS.requestsPerDay - 1));
  assert.equal(responseB.headers.get("X-Quota-Remaining"), String(FREE_API_LIMITS.requestsPerDay - 2));
});

test("isolation: two organizations never share rate-limit or quota counters", async () => {
  const orgA = await createOrg();
  const orgB = await createOrg();
  const { plaintextKey: keyA } = await createApiKey(orgA.id);
  const { plaintextKey: keyB } = await createApiKey(orgB.id);

  // Push org A's daily quota to its ceiling.
  const { key, windowStart } = windowKey("api:day", orgA.id, 86_400);
  await db.insert(integrationApiRateLimitHits).values({ key, windowStart, count: FREE_API_LIMITS.requestsPerDay - 1 });

  const responseA = await pingRoute(pingRequest(keyA));
  assert.equal(responseA.status, 200);
  assert.equal(responseA.headers.get("X-Quota-Remaining"), "0");

  const responseAOverLimit = await pingRoute(pingRequest(keyA));
  assert.equal(responseAOverLimit.status, 429);

  // Org B is completely unaffected.
  const responseB = await pingRoute(pingRequest(keyB));
  assert.equal(responseB.status, 200);
  assert.equal(responseB.headers.get("X-Quota-Remaining"), String(FREE_API_LIMITS.requestsPerDay - 1));
});
