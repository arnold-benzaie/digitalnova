// PHASE 2B.0 — authorization hotfix for lib/actions/crm-tickets.ts.
// createTicket / updateTicketStatus / updateTicket / deleteTicket now each
// call requireStaffRole() first. Real requireStaffRole() runs against a
// faked requireSession(). @/lib/webhooks and @/lib/notifications are
// spied so a rejected call can be proven to reach neither. Local
// disposable Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-tickets-auth.integration.test.mjs
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
let notifyCalls = [];
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async (...a) => { webhookCalls.push(a); } } });
mock.module("@/lib/notifications", {
  namedExports: {
    notify: async (...a) => { notifyCalls.push(a); },
    // null → createTicket skips the notify() branch entirely; the spy above
    // still catches it if the skip ever regresses.
    getInternalOrganizationId: async () => null,
  },
});

const { db } = await import("@/db");
const { crmClients, tickets } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createTicket, updateTicketStatus, updateTicket, deleteTicket } = await import("./crm-tickets.ts");

const createdClientIds = new Set();
const createdIds = new Set();
beforeEach(() => { actAsStaff(); webhookCalls = []; notifyCalls = []; });
after(async () => {
  if (createdIds.size) await db.delete(tickets).where(inArray(tickets.id, [...createdIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-tickets ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
async function makeTicket(clientId, overrides = {}) {
  const [t] = await db.insert(tickets).values({ clientId, subject: "seed", ...overrides }).returning();
  createdIds.add(t.id);
  return t;
}
const row = async (id) => (await db.select().from(tickets).where(eq(tickets.id, id)).limit(1))[0];
function form(clientId, overrides = {}) {
  const fd = new FormData();
  if (clientId) fd.set("clientId", clientId);
  fd.set("subject", overrides.subject ?? "Ticket 2B0");
  if (overrides.priority) fd.set("priority", overrides.priority);
  return fd;
}

test("createTicket — client rejected, zero row / webhook / notify side effect", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => createTicket(form(client.id))); } finally { actAsStaff(); }
  assert.equal((await db.select().from(tickets).where(eq(tickets.clientId, client.id))).length, 0);
  assert.equal(webhookCalls.length, 0);
  assert.equal(notifyCalls.length, 0);
});
test("createTicket — staff still works", async () => {
  const client = await makeClient();
  const res = await createTicket(form(client.id, { subject: "Vrai ticket" }));
  assert.equal(res, undefined, "no validation error for a valid staff call");
  const rows = await db.select().from(tickets).where(eq(tickets.clientId, client.id));
  rows.forEach((r) => createdIds.add(r.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject, "Vrai ticket");
  assert.equal(webhookCalls.length, 1);
});
test("updateTicketStatus — client rejected, status unchanged", async () => {
  const client = await makeClient();
  const t = await makeTicket(client.id, { status: "open" });
  actAsClient();
  try { await assert.rejects(() => updateTicketStatus(t.id, "closed")); } finally { actAsStaff(); }
  assert.equal((await row(t.id)).status, "open");
});
test("updateTicketStatus — staff still works", async () => {
  const client = await makeClient();
  const t = await makeTicket(client.id, { status: "open" });
  await updateTicketStatus(t.id, "resolved");
  assert.equal((await row(t.id)).status, "resolved");
});
test("updateTicket — client rejected, row unchanged", async () => {
  const client = await makeClient();
  const t = await makeTicket(client.id, { subject: "original", priority: "low" });
  actAsClient();
  try { await assert.rejects(() => updateTicket(t.id, form(null, { subject: "forgé", priority: "high" }))); } finally { actAsStaff(); }
  const r = await row(t.id);
  assert.equal(r.subject, "original");
  assert.equal(r.priority, "low");
});
test("updateTicket — staff still works", async () => {
  const client = await makeClient();
  const t = await makeTicket(client.id, { subject: "original", priority: "low" });
  const updated = await updateTicket(t.id, form(null, { subject: "modifié", priority: "high" }));
  assert.equal(updated.subject, "modifié");
  assert.equal(updated.priority, "high");
});
test("deleteTicket — client rejected, row still exists", async () => {
  const client = await makeClient();
  const t = await makeTicket(client.id);
  actAsClient();
  try { await assert.rejects(() => deleteTicket(t.id)); } finally { actAsStaff(); }
  assert.ok(await row(t.id));
});
test("deleteTicket — staff still works", async () => {
  const client = await makeClient();
  const t = await makeTicket(client.id);
  createdIds.delete(t.id);
  await deleteTicket(t.id);
  assert.equal(await row(t.id), undefined);
});
