// PHASE 2B.0 — authorization hotfix for lib/actions/crm-deals.ts.
// createDeal / updateDealStage / updateDeal / deleteDeal now each call
// requireStaffRole() as their first executable statement instead of
// relying solely on page-level protection.
//
// Same mocking convention as crm-invoices-auth.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session state
// (actAsStaff()/actAsClient()); the REAL requireStaffRole()
// (lib/dev-role.ts) is never mocked, so a non-staff call produces a
// genuine runtime redirect() rejection, not a textual check.
// @/lib/webhooks.dispatchWebhookEvent is spied so no real outbound
// delivery is attempted and we can prove a rejected call reaches it 0
// times.
//
// Local disposable Docker Postgres only (public-map-approval-test-db,
// 127.0.0.1:5434) — NEVER Supabase/Neon/pooler, NEVER Production/Preview.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-deals-auth.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
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

mock.module("@/lib/session", {
  namedExports: { requireSession: async () => mockState.session, getCurrentSession: async () => null },
});

let webhookCalls = [];
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async (...a) => { webhookCalls.push(a); } } });

const { db } = await import("@/db");
const { crmClients, deals } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createDeal, updateDealStage, updateDeal, deleteDeal } = await import("./crm-deals.ts");

const createdClientIds = new Set();
const createdDealIds = new Set();

beforeEach(() => { actAsStaff(); webhookCalls = []; });
after(async () => {
  if (createdDealIds.size) await db.delete(deals).where(inArray(deals.id, [...createdDealIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-deals ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
async function makeDeal(clientId, overrides = {}) {
  const [d] = await db.insert(deals).values({ clientId, title: "seed", ...overrides }).returning();
  createdDealIds.add(d.id);
  return d;
}
const dealRow = async (id) => (await db.select().from(deals).where(eq(deals.id, id)).limit(1))[0];
const dealCount = async (clientId) => (await db.select().from(deals).where(eq(deals.clientId, clientId))).length;

function dealForm(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Deal 2B0");
  if (overrides.valueEuros != null) fd.set("valueEuros", String(overrides.valueEuros));
  return fd;
}

test("createDeal — client rejected, zero row / webhook side effect", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => createDeal(dealForm(client.id))); } finally { actAsStaff(); }
  assert.equal(await dealCount(client.id), 0, "no deal created for an unauthorized caller");
  assert.equal(webhookCalls.length, 0, "no webhook dispatched");
});

test("createDeal — staff still works", async () => {
  const client = await makeClient();
  await createDeal(dealForm(client.id, { title: "Vrai deal" }));
  const rows = await db.select().from(deals).where(eq(deals.clientId, client.id));
  rows.forEach((r) => createdDealIds.add(r.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Vrai deal");
});

test("updateDealStage — client rejected, stage + won/lost webhook unchanged", async () => {
  const client = await makeClient();
  const deal = await makeDeal(client.id, { stage: "new" });
  actAsClient();
  try { await assert.rejects(() => updateDealStage(deal.id, "won")); } finally { actAsStaff(); }
  assert.equal((await dealRow(deal.id)).stage, "new");
  assert.equal(webhookCalls.length, 0);
});

test("updateDealStage — staff still works (and fires the won webhook)", async () => {
  const client = await makeClient();
  const deal = await makeDeal(client.id, { stage: "proposal" });
  await updateDealStage(deal.id, "won");
  assert.equal((await dealRow(deal.id)).stage, "won");
  assert.equal(webhookCalls.length, 1);
});

test("updateDeal — client rejected, row unchanged", async () => {
  const client = await makeClient();
  const deal = await makeDeal(client.id, { title: "original" });
  actAsClient();
  try { await assert.rejects(() => updateDeal(deal.id, dealForm(client.id, { title: "forgé" }))); } finally { actAsStaff(); }
  assert.equal((await dealRow(deal.id)).title, "original");
});

test("updateDeal — staff still works", async () => {
  const client = await makeClient();
  const deal = await makeDeal(client.id, { title: "original" });
  const updated = await updateDeal(deal.id, dealForm(client.id, { title: "modifié" }));
  assert.equal(updated.title, "modifié");
});

test("deleteDeal — client rejected, row still exists", async () => {
  const client = await makeClient();
  const deal = await makeDeal(client.id);
  actAsClient();
  try { await assert.rejects(() => deleteDeal(deal.id)); } finally { actAsStaff(); }
  assert.ok(await dealRow(deal.id), "deal must survive a rejected unauthorized delete");
});

test("deleteDeal — staff still works", async () => {
  const client = await makeClient();
  const deal = await makeDeal(client.id);
  createdDealIds.delete(deal.id);
  await deleteDeal(deal.id);
  assert.equal(await dealRow(deal.id), undefined);
});
