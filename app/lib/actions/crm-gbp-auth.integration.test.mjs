// PHASE 2B.0 — authorization hotfix for the shared "act on a client's
// organization" chain:
//   lib/actions/crm-gbp.ts    — getOrCreateOrganizationForClient,
//                                syncGbpDataForClient, replyToReviewForClient
//   lib/actions/crm-analytics.ts        — syncAnalyticsDataForClient
//   lib/actions/crm-search-console.ts   — syncSearchConsoleDataForClient
//
// All 5 now call requireStaffRole() first (before the caller-supplied
// clientId / reviewId is ever touched or an organizations row is created).
// Real requireStaffRole() runs against a faked requireSession(). The
// downstream integration actions (@/lib/actions/gbp / analytics /
// search-console) are stubbed so a rejected call can be proven to reach
// none of them and no external network call is made. Local disposable
// Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-gbp-auth.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : base non locale.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const STAFF_SESSION = {
  userId: "test-staff-user", clerkUserId: "test_clerk_staff", email: "staff@example.com",
  fullName: "Test Staff", firstName: "Test", organizationId: "test-org", organizationName: "Test Org",
  role: "staff", previousLastLoginAt: null,
};
const CLIENT_SESSION = { ...STAFF_SESSION, userId: "test-client-user", email: "client-role@example.com", role: "client" };
let mockState = { session: STAFF_SESSION };
const actAsStaff = () => { mockState = { session: STAFF_SESSION }; };
const actAsClient = () => { mockState = { session: CLIENT_SESSION }; };
mock.module("@/lib/session", { namedExports: { requireSession: async () => mockState.session, getCurrentSession: async () => null } });

let gbpSyncCalls = [], replyCalls = [], analyticsSyncCalls = [], scSyncCalls = [];
mock.module("@/lib/actions/gbp", {
  namedExports: {
    syncGbpData: async (...a) => { gbpSyncCalls.push(a); },
    replyToReview: async (...a) => { replyCalls.push(a); },
  },
});
mock.module("@/lib/actions/analytics", { namedExports: { syncAnalyticsData: async (...a) => { analyticsSyncCalls.push(a); } } });
mock.module("@/lib/actions/search-console", { namedExports: { syncSearchConsoleData: async (...a) => { scSyncCalls.push(a); } } });

const { db } = await import("@/db");
const { crmClients, organizations } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { getOrCreateOrganizationForClient, syncGbpDataForClient, replyToReviewForClient } = await import("./crm-gbp.ts");
const { syncAnalyticsDataForClient } = await import("./crm-analytics.ts");
const { syncSearchConsoleDataForClient } = await import("./crm-search-console.ts");

const createdClientIds = new Set();
const createdOrgIds = new Set();
beforeEach(() => { actAsStaff(); gbpSyncCalls = []; replyCalls = []; analyticsSyncCalls = []; scSyncCalls = []; });
after(async () => {
  // Detach clients from orgs first so the org delete isn't blocked, then clean both.
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdOrgIds.size) await db.delete(organizations).where(inArray(organizations.id, [...createdOrgIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-gbp ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
const clientRow = async (id) => (await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1))[0];
async function trackOrgFor(clientId) {
  const c = await clientRow(clientId);
  if (c?.organizationId) createdOrgIds.add(c.organizationId);
}

// ---- getOrCreateOrganizationForClient ------------------------------------
test("getOrCreateOrganizationForClient — client rejected: no org created, client not linked, no audit", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => getOrCreateOrganizationForClient(client.id)); } finally { actAsStaff(); }
  assert.equal((await clientRow(client.id)).organizationId, null, "client must not be linked to an org");
});
test("getOrCreateOrganizationForClient — staff still works (creates + links)", async () => {
  const client = await makeClient();
  const org = await getOrCreateOrganizationForClient(client.id);
  createdOrgIds.add(org.id);
  assert.ok(org.id);
  assert.equal((await clientRow(client.id)).organizationId, org.id);
});

// ---- syncGbpDataForClient ---------------------------------------------------
test("syncGbpDataForClient — client rejected: downstream syncGbpData not called, no org created", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => syncGbpDataForClient(client.id)); } finally { actAsStaff(); }
  assert.equal(gbpSyncCalls.length, 0);
  assert.equal((await clientRow(client.id)).organizationId, null);
});
test("syncGbpDataForClient — staff still works", async () => {
  const client = await makeClient();
  await syncGbpDataForClient(client.id);
  await trackOrgFor(client.id);
  assert.equal(gbpSyncCalls.length, 1);
});

// ---- replyToReviewForClient ---------------------------------------------------
test("replyToReviewForClient — client rejected: replyToReview not called", async () => {
  actAsClient();
  try { await assert.rejects(() => replyToReviewForClient("c-x", "review-x", "forged reply")); } finally { actAsStaff(); }
  assert.equal(replyCalls.length, 0);
});
test("replyToReviewForClient — staff still works", async () => {
  await replyToReviewForClient("c-x", "review-x", "vraie réponse");
  assert.equal(replyCalls.length, 1);
  assert.deepEqual(replyCalls[0], ["review-x", "vraie réponse"]);
});

// ---- syncAnalyticsDataForClient --------------------------------------------
test("syncAnalyticsDataForClient — client rejected: no org created, syncAnalyticsData not called", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => syncAnalyticsDataForClient(client.id)); } finally { actAsStaff(); }
  assert.equal(analyticsSyncCalls.length, 0);
  assert.equal((await clientRow(client.id)).organizationId, null);
});
test("syncAnalyticsDataForClient — staff still works", async () => {
  const client = await makeClient();
  await syncAnalyticsDataForClient(client.id);
  await trackOrgFor(client.id);
  assert.equal(analyticsSyncCalls.length, 1);
});

// ---- syncSearchConsoleDataForClient --------------------------------------
test("syncSearchConsoleDataForClient — client rejected: no org created, syncSearchConsoleData not called", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => syncSearchConsoleDataForClient(client.id)); } finally { actAsStaff(); }
  assert.equal(scSyncCalls.length, 0);
  assert.equal((await clientRow(client.id)).organizationId, null);
});
test("syncSearchConsoleDataForClient — staff still works", async () => {
  const client = await makeClient();
  await syncSearchConsoleDataForClient(client.id);
  await trackOrgFor(client.id);
  assert.equal(scSyncCalls.length, 1);
});
