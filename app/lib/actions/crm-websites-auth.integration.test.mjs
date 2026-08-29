// PHASE 2B.0 — authorization hotfix for lib/actions/crm-websites.ts.
// createWebsite / updateWebsite / deleteWebsite now each call
// requireStaffRole() first. Real requireStaffRole() runs against a faked
// requireSession(). Local disposable Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-websites-auth.integration.test.mjs
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

const { db } = await import("@/db");
const { crmClients, crmWebsites } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createWebsite, updateWebsite, deleteWebsite } = await import("./crm-websites.ts");

const createdClientIds = new Set();
const createdIds = new Set();
beforeEach(() => actAsStaff());
after(async () => {
  if (createdIds.size) await db.delete(crmWebsites).where(inArray(crmWebsites.id, [...createdIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-web ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
async function makeWebsite(clientId, overrides = {}) {
  const [w] = await db.insert(crmWebsites).values({ clientId, url: "https://seed.example/", ...overrides }).returning();
  createdIds.add(w.id);
  return w;
}
const row = async (id) => (await db.select().from(crmWebsites).where(eq(crmWebsites.id, id)).limit(1))[0];
function form(clientId, overrides = {}) {
  const fd = new FormData();
  if (clientId) fd.set("clientId", clientId);
  fd.set("url", overrides.url ?? "https://example-2b0.test/");
  return fd;
}

test("createWebsite — client rejected, zero row side effect", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => createWebsite(form(client.id))); } finally { actAsStaff(); }
  assert.equal((await db.select().from(crmWebsites).where(eq(crmWebsites.clientId, client.id))).length, 0);
});
test("createWebsite — staff still works", async () => {
  const client = await makeClient();
  const w = await createWebsite(form(client.id, { url: "https://vrai-2b0.test/" }));
  createdIds.add(w.id);
  assert.equal(w.clientId, client.id);
});
test("updateWebsite — client rejected, row unchanged", async () => {
  const client = await makeClient();
  const w = await makeWebsite(client.id, { url: "https://original.example/" });
  actAsClient();
  try { await assert.rejects(() => updateWebsite(w.id, form(null, { url: "https://forge.example/" }))); } finally { actAsStaff(); }
  assert.equal((await row(w.id)).url, "https://original.example/");
});
test("updateWebsite — staff still works", async () => {
  const client = await makeClient();
  const w = await makeWebsite(client.id, { url: "https://original.example/" });
  const updated = await updateWebsite(w.id, form(null, { url: "https://modifie.example/" }));
  assert.equal(updated.url, "https://modifie.example/");
});
test("deleteWebsite — client rejected, row still exists", async () => {
  const client = await makeClient();
  const w = await makeWebsite(client.id);
  actAsClient();
  try { await assert.rejects(() => deleteWebsite(w.id)); } finally { actAsStaff(); }
  assert.ok(await row(w.id));
});
test("deleteWebsite — staff still works", async () => {
  const client = await makeClient();
  const w = await makeWebsite(client.id);
  createdIds.delete(w.id);
  await deleteWebsite(w.id);
  assert.equal(await row(w.id), undefined);
});
