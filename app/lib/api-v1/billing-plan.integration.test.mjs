// Integration coverage for resolveApiLimitsForOrg — needs a real `subscriptions`
// row (or the deliberate absence of one), so this runs against the same
// isolated local Docker database as the other lib/api-v1 integration suites.
import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { organizations, subscriptions } = await import("@/db/schema");
const { inArray } = await import("drizzle-orm");
const { resolveApiLimitsForOrg } = await import("@/lib/api-v1/billing-plan");
const { FREE_API_LIMITS, PLAN_API_LIMITS } = await import("@/lib/billing/api-limits");

const fixtureOrgIds = new Set();

async function createOrg() {
  const [org] = await db.insert(organizations).values({ name: `billing-plan test ${randomUUID()}` }).returning();
  fixtureOrgIds.add(org.id);
  return org;
}

async function createSubscription(organizationId, { plan, status }) {
  await db.insert(subscriptions).values({ organizationId, plan, status, priceEuros: 0 });
}

after(async () => {
  if (fixtureOrgIds.size > 0) await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

test("resolveApiLimitsForOrg: an organization with no subscription row at all gets the implicit Free tier", async () => {
  const org = await createOrg();
  assert.deepEqual(await resolveApiLimitsForOrg(org.id), FREE_API_LIMITS);
});

test("resolveApiLimitsForOrg: status=active on the 'pro' plan gets the pro plan's real limits", async () => {
  const org = await createOrg();
  await createSubscription(org.id, { plan: "pro", status: "active" });
  assert.deepEqual(await resolveApiLimitsForOrg(org.id), PLAN_API_LIMITS.pro);
});

test("resolveApiLimitsForOrg: status=trialing on the 'agency' plan gets the agency plan's real limits", async () => {
  const org = await createOrg();
  await createSubscription(org.id, { plan: "agency", status: "trialing" });
  assert.deepEqual(await resolveApiLimitsForOrg(org.id), PLAN_API_LIMITS.agency);
});

test("resolveApiLimitsForOrg: status=past_due falls back to the Free tier, even though a paid plan is on file", async () => {
  const org = await createOrg();
  await createSubscription(org.id, { plan: "starter", status: "past_due" });
  assert.deepEqual(await resolveApiLimitsForOrg(org.id), FREE_API_LIMITS);
});

test("resolveApiLimitsForOrg: status=canceled falls back to the Free tier", async () => {
  const org = await createOrg();
  await createSubscription(org.id, { plan: "agency", status: "canceled" });
  assert.deepEqual(await resolveApiLimitsForOrg(org.id), FREE_API_LIMITS);
});

test("resolveApiLimitsForOrg: an unrecognized plan value on an active subscription falls back to the Free tier rather than throwing", async () => {
  const org = await createOrg();
  await createSubscription(org.id, { plan: "some-future-plan", status: "active" });
  assert.deepEqual(await resolveApiLimitsForOrg(org.id), FREE_API_LIMITS);
});
