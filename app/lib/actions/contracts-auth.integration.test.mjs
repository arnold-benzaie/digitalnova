// PHASE 2B.0 — authorization hotfix for lib/actions/contracts.ts.
// createContract / updateContract / sendContractForSignature /
// simulateContractSignature now each call requireStaffRole() first. Real
// requireStaffRole() runs against a faked requireSession(). The e-sign
// provider (@/lib/esign) and @/lib/webhooks are stubbed so a rejected
// call can be proven to reach neither and no external send is made.
// Local disposable Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/contracts-auth.integration.test.mjs
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

let webhookCalls = [];
let esignCalls = [];
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async (...a) => { webhookCalls.push(a); } } });
mock.module("@/lib/esign", {
  namedExports: {
    getESignProvider: () => ({
      sendForSignature: async (input) => { esignCalls.push(input); return { providerRequestId: "stub-req-2b0" }; },
    }),
  },
});

const { db } = await import("@/db");
const { crmClients, contracts } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createContract, updateContract, sendContractForSignature, simulateContractSignature } = await import("./contracts.ts");

const createdClientIds = new Set();
const createdIds = new Set();
beforeEach(() => { actAsStaff(); webhookCalls = []; esignCalls = []; });
after(async () => {
  if (createdIds.size) await db.delete(contracts).where(inArray(contracts.id, [...createdIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-contracts ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
async function makeContract(clientId, overrides = {}) {
  const [k] = await db.insert(contracts).values({ clientId, title: "seed", content: "seed body", ...overrides }).returning();
  createdIds.add(k.id);
  return k;
}
const row = async (id) => (await db.select().from(contracts).where(eq(contracts.id, id)).limit(1))[0];
function form(clientId, overrides = {}) {
  const fd = new FormData();
  if (clientId) fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Contrat 2B0");
  fd.set("content", overrides.content ?? "Corps du contrat 2B0");
  if (overrides.signerName) fd.set("signerName", overrides.signerName);
  if (overrides.signerEmail) fd.set("signerEmail", overrides.signerEmail);
  return fd;
}

test("createContract — client rejected, zero row / webhook side effect", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => createContract(form(client.id))); } finally { actAsStaff(); }
  assert.equal((await db.select().from(contracts).where(eq(contracts.clientId, client.id))).length, 0);
  assert.equal(webhookCalls.length, 0);
});
test("createContract — staff still works", async () => {
  const client = await makeClient();
  await createContract(form(client.id, { title: "Vrai contrat" }));
  const rows = await db.select().from(contracts).where(eq(contracts.clientId, client.id));
  rows.forEach((r) => createdIds.add(r.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Vrai contrat");
});
test("updateContract — client rejected, draft unchanged", async () => {
  const client = await makeClient();
  const k = await makeContract(client.id, { title: "original", status: "draft" });
  actAsClient();
  try { await assert.rejects(() => updateContract(k.id, form(null, { title: "forgé" }))); } finally { actAsStaff(); }
  assert.equal((await row(k.id)).title, "original");
});
test("updateContract — staff still works", async () => {
  const client = await makeClient();
  const k = await makeContract(client.id, { title: "original", status: "draft" });
  const updated = await updateContract(k.id, form(null, { title: "modifié" }));
  assert.equal(updated.title, "modifié");
});
test("sendContractForSignature — client rejected, no e-sign send / no status change", async () => {
  const client = await makeClient();
  const k = await makeContract(client.id, { status: "draft", signerName: "S", signerEmail: "s@example.test" });
  actAsClient();
  try { await assert.rejects(() => sendContractForSignature(k.id)); } finally { actAsStaff(); }
  assert.equal(esignCalls.length, 0, "requireStaffRole must reject before any e-sign call");
  assert.equal(webhookCalls.length, 0);
  assert.equal((await row(k.id)).status, "draft");
});
test("sendContractForSignature — staff still works", async () => {
  const client = await makeClient();
  const k = await makeContract(client.id, { status: "draft", signerName: "S", signerEmail: "s@example.test" });
  await sendContractForSignature(k.id);
  assert.equal(esignCalls.length, 1);
  assert.equal((await row(k.id)).status, "sent");
});
test("simulateContractSignature — client rejected, status unchanged", async () => {
  const client = await makeClient();
  const k = await makeContract(client.id, { status: "sent" });
  actAsClient();
  try { await assert.rejects(() => simulateContractSignature(k.id)); } finally { actAsStaff(); }
  assert.equal((await row(k.id)).status, "sent");
  assert.equal(webhookCalls.length, 0);
});
test("simulateContractSignature — staff still works", async () => {
  const client = await makeClient();
  const k = await makeContract(client.id, { status: "sent" });
  await simulateContractSignature(k.id);
  assert.equal((await row(k.id)).status, "signed");
});
