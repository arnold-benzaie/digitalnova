// PHASE 2B.0 — authorization hotfix for lib/actions/crm-tasks.ts.
// createTask / updateTaskStatus / updateTask / deleteTask now each call
// requireStaffRole() first. Same mocking convention as
// crm-invoices-auth.integration.test.mjs — real requireStaffRole() runs
// against a faked requireSession(). Local disposable Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-tasks-auth.integration.test.mjs
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
const { crmClients, tasks } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createTask, updateTaskStatus, updateTask, deleteTask } = await import("./crm-tasks.ts");

const createdClientIds = new Set();
const createdTaskIds = new Set();
beforeEach(() => actAsStaff());
after(async () => {
  if (createdTaskIds.size) await db.delete(tasks).where(inArray(tasks.id, [...createdTaskIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-tasks ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
async function makeTask(clientId, overrides = {}) {
  const [t] = await db.insert(tasks).values({ title: "seed", clientId, ...overrides }).returning();
  createdTaskIds.add(t.id);
  return t;
}
const taskRow = async (id) => (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
function taskForm(overrides = {}) {
  const fd = new FormData();
  fd.set("title", overrides.title ?? "Task 2B0");
  if (overrides.clientId) fd.set("clientId", overrides.clientId);
  return fd;
}

test("createTask — client rejected, zero row side effect", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => createTask(taskForm({ clientId: client.id }))); } finally { actAsStaff(); }
  assert.equal((await db.select().from(tasks).where(eq(tasks.clientId, client.id))).length, 0);
});
test("createTask — staff still works", async () => {
  const client = await makeClient();
  await createTask(taskForm({ clientId: client.id, title: "Vraie tâche" }));
  const rows = await db.select().from(tasks).where(eq(tasks.clientId, client.id));
  rows.forEach((r) => createdTaskIds.add(r.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Vraie tâche");
});
test("updateTaskStatus — client rejected, status unchanged", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { status: "todo" });
  actAsClient();
  try { await assert.rejects(() => updateTaskStatus(t.id, "done")); } finally { actAsStaff(); }
  assert.equal((await taskRow(t.id)).status, "todo");
});
test("updateTaskStatus — staff still works", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { status: "todo" });
  await updateTaskStatus(t.id, "done");
  assert.equal((await taskRow(t.id)).status, "done");
});
test("updateTask — client rejected, row unchanged", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { title: "original" });
  actAsClient();
  try { await assert.rejects(() => updateTask(t.id, taskForm({ title: "forgé" }))); } finally { actAsStaff(); }
  assert.equal((await taskRow(t.id)).title, "original");
});
test("updateTask — staff still works", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { title: "original" });
  const updated = await updateTask(t.id, taskForm({ title: "modifié" }));
  assert.equal(updated.title, "modifié");
});
test("deleteTask — client rejected, row still exists", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  actAsClient();
  try { await assert.rejects(() => deleteTask(t.id)); } finally { actAsStaff(); }
  assert.ok(await taskRow(t.id));
});
test("deleteTask — staff still works", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  createdTaskIds.delete(t.id);
  await deleteTask(t.id);
  assert.equal(await taskRow(t.id), undefined);
});
