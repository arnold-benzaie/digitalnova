// Integration tests for lib/developer-console/queries.ts — no session
// mocking needed here (unlike actions.integration.test.mjs): every
// function takes organizationId as a plain parameter, exactly like
// lib/integrations/queries.ts's existing functions.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/developer-console/queries.integration.test.mjs
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { auditLog, integrationApiRateLimitHits, integrations, memberships, organizations, roles, subscriptions, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { getApiKeyEvents, getApiKeyUsageWindows, getIntegrationForOrg, getOrgPlanSummary, listOrgMembers } = await import("./queries.ts");
const { FREE_API_LIMITS, PLAN_API_LIMITS } = await import("@/lib/billing/api-limits");

const fixtureOrgIds = new Set();
const fixtureUserIds = new Set();
let org;

before(async () => {
  const [row] = await db.insert(organizations).values({ name: `dev-console queries test ${randomUUID()}` }).returning();
  org = row;
  fixtureOrgIds.add(org.id);
});

after(async () => {
  await db.delete(auditLog).where(eq(auditLog.organizationId, org.id));
  await db.delete(memberships).where(eq(memberships.organizationId, org.id));
  await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
  const integrationRows = await db.select({ id: integrations.id }).from(integrations).where(eq(integrations.organizationId, org.id));
  if (integrationRows.length > 0) await db.delete(integrations).where(inArray(integrations.id, integrationRows.map((r) => r.id)));
  await db.delete(subscriptions).where(eq(subscriptions.organizationId, org.id));
  await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

test("getIntegrationForOrg: returns undefined (never creates one) when the org has no integration yet", async () => {
  const result = await getIntegrationForOrg(org.id);
  assert.equal(result, undefined);

  const rows = await db.select().from(integrations).where(eq(integrations.organizationId, org.id));
  assert.equal(rows.length, 0, "a read must never have the side effect of creating an integration");
});

test("getOrgPlanSummary: no subscription row at all -> Free tier limits, plan/status null", async () => {
  const summary = await getOrgPlanSummary(org.id);
  assert.equal(summary.plan, null);
  assert.equal(summary.status, null);
  assert.deepEqual(summary.limits, FREE_API_LIMITS);
});

test("getOrgPlanSummary: active subscription on 'pro' -> pro's real limits, plan/status surfaced", async () => {
  await db.insert(subscriptions).values({ organizationId: org.id, plan: "pro", status: "active", priceEuros: 149 });
  const summary = await getOrgPlanSummary(org.id);
  assert.equal(summary.plan, "pro");
  assert.equal(summary.status, "active");
  assert.deepEqual(summary.limits, PLAN_API_LIMITS.pro);
  await db.delete(subscriptions).where(eq(subscriptions.organizationId, org.id));
});

test("getApiKeyUsageWindows: reads real fixed-window rows, matching lib/api-v1/rate-limit.ts's exact key format", async () => {
  const apiKeyId = randomUUID();
  const windowSeconds = 60;
  const windowStartMs = Math.floor(Date.now() / (windowSeconds * 1000)) * (windowSeconds * 1000);
  await db.insert(integrationApiRateLimitHits).values({
    key: `api:minute:${apiKeyId}:${windowStartMs}`,
    windowStart: new Date(windowStartMs),
    count: 12,
  });

  const windows = await getApiKeyUsageWindows(apiKeyId, org.id, { requestsPerMinute: 30, requestsPerDay: 1000 });
  assert.equal(windows.perMinute.used, 12);
  assert.equal(windows.perMinute.limit, 30);
  assert.equal(windows.perMinute.remaining, 18);
  assert.equal(windows.perDay.used, 0, "no day-window row was seeded, so usage must read as zero, not error");

  await db.delete(integrationApiRateLimitHits).where(eq(integrationApiRateLimitHits.key, `api:minute:${apiKeyId}:${windowStartMs}`));
});

test("getApiKeyEvents: only returns 'apikey.*' events for the given organization, never another org's or another namespace's", async () => {
  const [otherOrg] = await db.insert(organizations).values({ name: `dev-console other org ${randomUUID()}` }).returning();
  fixtureOrgIds.add(otherOrg.id);

  await db.insert(auditLog).values([
    { organizationId: org.id, action: "apikey.created", targetType: "integration_api_key", targetId: "k1", metadata: { keyPrefix: "pm_live_abc" } },
    { organizationId: org.id, action: "integration_api_key.created", targetType: "integration_api_key", targetId: "k2", metadata: {} },
    { organizationId: otherOrg.id, action: "apikey.created", targetType: "integration_api_key", targetId: "k3", metadata: {} },
  ]);

  const events = await getApiKeyEvents(org.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "apikey.created");
  assert.equal(events[0].targetId, "k1");

  await db.delete(auditLog).where(eq(auditLog.organizationId, otherOrg.id));
  await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
});

test("listOrgMembers: lists every membership for the organization, with role name and email", async () => {
  const [role] = await db.select().from(roles).where(eq(roles.name, "client")).limit(1);
  const [user] = await db.insert(users).values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "Roster Test" }).returning();
  fixtureUserIds.add(user.id);
  await db.insert(memberships).values({ userId: user.id, organizationId: org.id, roleId: role.id });

  const members = await listOrgMembers(org.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].email, user.email);
  assert.equal(members[0].role, "client");
  assert.equal(members[0].fullName, "Roster Test");
});
