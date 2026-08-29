// PHASE 2B.0 — authorization hotfix for lib/actions/crm-projects.ts.
// createProject / updateProjectStatus / updateProject / deleteProject now
// each call requireStaffRole() first. Real requireStaffRole() runs against
// a faked requireSession(). Local disposable Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-projects-auth.integration.test.mjs
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
const { crmClients, projects } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createProject, updateProjectStatus, updateProject, deleteProject } = await import("./crm-projects.ts");

const createdClientIds = new Set();
const createdIds = new Set();
beforeEach(() => actAsStaff());
after(async () => {
  if (createdIds.size) await db.delete(projects).where(inArray(projects.id, [...createdIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-projects ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
async function makeProject(clientId, overrides = {}) {
  const [p] = await db.insert(projects).values({ clientId, name: "seed", ...overrides }).returning();
  createdIds.add(p.id);
  return p;
}
const row = async (id) => (await db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
function form(clientId, overrides = {}) {
  const fd = new FormData();
  if (clientId) fd.set("clientId", clientId);
  fd.set("name", overrides.name ?? "Projet 2B0");
  return fd;
}

test("createProject — client rejected, zero row side effect", async () => {
  const client = await makeClient();
  actAsClient();
  try { await assert.rejects(() => createProject(form(client.id))); } finally { actAsStaff(); }
  assert.equal((await db.select().from(projects).where(eq(projects.clientId, client.id))).length, 0);
});
test("createProject — staff still works", async () => {
  const client = await makeClient();
  await createProject(form(client.id, { name: "Vrai projet" }));
  const rows = await db.select().from(projects).where(eq(projects.clientId, client.id));
  rows.forEach((r) => createdIds.add(r.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Vrai projet");
});
test("updateProjectStatus — client rejected, status unchanged", async () => {
  const client = await makeClient();
  const p = await makeProject(client.id, { status: "planning" });
  actAsClient();
  try { await assert.rejects(() => updateProjectStatus(p.id, "completed")); } finally { actAsStaff(); }
  assert.equal((await row(p.id)).status, "planning");
});
test("updateProjectStatus — staff still works", async () => {
  const client = await makeClient();
  const p = await makeProject(client.id, { status: "planning" });
  await updateProjectStatus(p.id, "completed");
  assert.equal((await row(p.id)).status, "completed");
});
test("updateProject — client rejected, row unchanged", async () => {
  const client = await makeClient();
  const p = await makeProject(client.id, { name: "original" });
  actAsClient();
  try { await assert.rejects(() => updateProject(p.id, form(null, { name: "forgé" }))); } finally { actAsStaff(); }
  assert.equal((await row(p.id)).name, "original");
});
test("updateProject — staff still works", async () => {
  const client = await makeClient();
  const p = await makeProject(client.id, { name: "original" });
  const updated = await updateProject(p.id, form(null, { name: "modifié" }));
  assert.equal(updated.name, "modifié");
});
test("deleteProject — client rejected, row still exists", async () => {
  const client = await makeClient();
  const p = await makeProject(client.id);
  actAsClient();
  try { await assert.rejects(() => deleteProject(p.id)); } finally { actAsStaff(); }
  assert.ok(await row(p.id));
});
test("deleteProject — staff still works", async () => {
  const client = await makeClient();
  const p = await makeProject(client.id);
  createdIds.delete(p.id);
  await deleteProject(p.id);
  assert.equal(await row(p.id), undefined);
});
