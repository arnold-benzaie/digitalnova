// PHASE RADAR-CORE-3A — follow-up lifecycle authorization for
// lib/actions/crm-tasks.ts.
//
// Human task mutations moved from Axis-A requireStaffRole() to Axis-C
// requireStaffMember("RADAR_WORK") + own-vs-foreign RADAR_ASSIGN
// escalation. So the "staff" identity here must be a REAL users.id with
// a real ACTIVE staff_members row in the internal workspace; the REAL
// requireStaffMember / evaluateStaffPermission run against seeded rows.
// Same convention as radar-assignment.integration.test.mjs /
// crm-interactions.integration.test.mjs.
//
// Local disposable Docker Postgres only (127.0.0.1:5434) — NEVER
// Supabase/Neon/pooler, NEVER Production.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-tasks-auth.integration.test.mjs
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : base non locale.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const EMPLOYEE_ID = randomUUID();
const EMPLOYEE2_ID = randomUUID();
const MANAGER_ID = randomUUID();
const ADMIN_ID = randomUUID();
const OWNER_ID = randomUUID();
const SUSPENDED_ID = randomUUID();
const NON_STAFF_ID = randomUUID();

function sessionFor(userId, role = "staff") {
  return {
    userId,
    clerkUserId: `test_clerk_${userId}`,
    email: `${userId}@example.test`,
    fullName: "Test Person",
    firstName: "Test",
    organizationId: "test-org",
    organizationName: "Test Org",
    role,
    previousLastLoginAt: null,
  };
}
let mockState = { session: sessionFor(EMPLOYEE_ID) };
const actAs = (userId, role = "staff") => { mockState = { session: sessionFor(userId, role) }; };
const actAsUnauthenticated = () => { mockState = { session: null }; };

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) throw new Error("UNAUTHENTICATED — no session");
      return mockState.session;
    },
    // Null — logCrmAudit()'s actorUserId is not exercised here; the
    // product's logCrmAudit is untouched by 3A.
    getCurrentSession: async () => null,
  },
});

const { db } = await import("@/db");
const { crmClients, organizations, staffMembers, staffRoles, tasks, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const {
  createTask,
  updateTaskStatus,
  updateTask,
  deleteTask,
  claimFollowUp,
  assignFollowUp,
  releaseFollowUp,
  completeFollowUp,
  cancelFollowUp,
  reopenFollowUp,
  rescheduleFollowUp,
} = await import("./crm-tasks.ts");

const createdClientIds = new Set();
const createdTaskIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();
let INTERNAL_ORG_ID;

async function roleId(name) {
  const [r] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
  return r?.id ?? null;
}
async function seedUser(userId) {
  await db
    .insert(users)
    .values({ id: userId, clerkUserId: `test_clerk_${userId}`, email: `${userId}@example.test`, fullName: "Test Person", status: "active" })
    .onConflictDoNothing();
  createdUserIds.add(userId);
}
async function seedStaffMember(userId, roleName, status) {
  const [row] = await db
    .insert(staffMembers)
    .values({ userId, workspaceOrgId: INTERNAL_ORG_ID, roleId: await roleId(roleName), status })
    .returning();
  createdStaffMemberIds.add(row.id);
}

before(async () => {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  INTERNAL_ORG_ID = org?.id ?? null;
  assert.ok(INTERNAL_ORG_ID, "local test DB must have an internal organization");
  for (const id of [EMPLOYEE_ID, EMPLOYEE2_ID, MANAGER_ID, ADMIN_ID, OWNER_ID, SUSPENDED_ID, NON_STAFF_ID]) await seedUser(id);
  await seedStaffMember(EMPLOYEE_ID, "EMPLOYEE", "ACTIVE");
  await seedStaffMember(EMPLOYEE2_ID, "EMPLOYEE", "ACTIVE");
  await seedStaffMember(MANAGER_ID, "MANAGER", "ACTIVE");
  await seedStaffMember(ADMIN_ID, "ADMIN", "ACTIVE");
  await seedStaffMember(OWNER_ID, "OWNER", "ACTIVE");
  await seedStaffMember(SUSPENDED_ID, "EMPLOYEE", "SUSPENDED");
  // NON_STAFF_ID: user row, no staff_members row.
});

beforeEach(() => actAs(EMPLOYEE_ID));

after(async () => {
  if (createdTaskIds.size) await db.delete(tasks).where(inArray(tasks.id, [...createdTaskIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function makeClient() {
  const [c] = await db.insert(crmClients).values({ name: `3A-tasks ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  return c;
}
async function makeTask(clientId, overrides = {}) {
  const [t] = await db.insert(tasks).values({ title: "seed", clientId, dueDate: new Date(), ...overrides }).returning();
  createdTaskIds.add(t.id);
  return t;
}
const taskRow = async (id) => (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
function createForm(overrides = {}) {
  const fd = new FormData();
  fd.set("title", overrides.title ?? "Follow up");
  if (overrides.clientId) fd.set("clientId", overrides.clientId);
  if (overrides.dueDate !== undefined) fd.set("dueDate", overrides.dueDate);
  // caller-supplied authorship — ALL must be ignored
  if (overrides.assignee !== undefined) fd.set("assignee", overrides.assignee);
  if (overrides.assignedUserId !== undefined) fd.set("assignedUserId", overrides.assignedUserId);
  if (overrides.createdByUserId !== undefined) fd.set("createdByUserId", overrides.createdByUserId);
  if (overrides.actorUserId !== undefined) fd.set("actorUserId", overrides.actorUserId);
  return fd;
}
async function onlyTaskFor(clientId) {
  const rows = await db.select().from(tasks).where(eq(tasks.clientId, clientId));
  rows.forEach((r) => createdTaskIds.add(r.id));
  return rows;
}

// ============================ CREATE: spoofing + gate ============================

test("3A-1. submitted `assignee` FormData is IGNORED — new human task.assignee is NULL", async () => {
  const client = await makeClient();
  await createTask(createForm({ clientId: client.id, assignee: "Fake Owner" }));
  const [row] = await onlyTaskFor(client.id);
  assert.equal(row.assignee, null);
  assert.equal(row.assignedUserId, null, "no ambient assignment from a create");
  assert.equal(row.createdByUserId, EMPLOYEE_ID);
});

test("3A-2. submitted `assignedUserId` on create cannot become task ownership", async () => {
  const client = await makeClient();
  await createTask(createForm({ clientId: client.id, assignedUserId: MANAGER_ID }));
  const [row] = await onlyTaskFor(client.id);
  assert.equal(row.assignedUserId, null);
});

test("3A-3/4. submitted createdByUserId / actorUserId are IGNORED — creator is session.userId", async () => {
  const client = await makeClient();
  actAs(MANAGER_ID);
  await createTask(createForm({ clientId: client.id, createdByUserId: EMPLOYEE_ID, actorUserId: NON_STAFF_ID }));
  const [row] = await onlyTaskFor(client.id);
  assert.equal(row.createdByUserId, MANAGER_ID);
});

test("3A-5. ACTIVE EMPLOYEE may create", async () => {
  const client = await makeClient();
  await createTask(createForm({ clientId: client.id }));
  assert.equal((await onlyTaskFor(client.id)).length, 1);
});

test("3A-6. ACTIVE MANAGER may create", async () => {
  const client = await makeClient();
  actAs(MANAGER_ID);
  await createTask(createForm({ clientId: client.id }));
  assert.equal((await onlyTaskFor(client.id)).length, 1);
});

test("3A-7. SUSPENDED member is DENIED — no row", async () => {
  const client = await makeClient();
  actAs(SUSPENDED_ID);
  await assert.rejects(() => createTask(createForm({ clientId: client.id })));
  assert.equal((await db.select().from(tasks).where(eq(tasks.clientId, client.id))).length, 0);
});

test("3A-8. user with NO staff_members row is DENIED — no row", async () => {
  const client = await makeClient();
  actAs(NON_STAFF_ID);
  await assert.rejects(() => createTask(createForm({ clientId: client.id })));
  assert.equal((await db.select().from(tasks).where(eq(tasks.clientId, client.id))).length, 0);
});

test("3A-UNAUTH. unauthenticated createTask rejected", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => createTask(createForm({ clientId: client.id })));
});

test("3A-23. createTask with a non-existent client_id is rejected", async () => {
  await assert.rejects(() => createTask(createForm({ clientId: randomUUID() })));
});

test("3A-INVALID-DUE. createTask with an unparseable dueDate is rejected", async () => {
  const client = await makeClient();
  await assert.rejects(() => createTask(createForm({ clientId: client.id, dueDate: "not-a-date" })));
});

// ============================ OWNER / eligibility ============================

test("3A-9. OWNER cannot claim to self -> ASSIGNEE_NOT_ELIGIBLE", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  actAs(OWNER_ID);
  assert.deepEqual(await claimFollowUp(t.id), { error: "ASSIGNEE_NOT_ELIGIBLE" });
  assert.equal((await taskRow(t.id)).assignedUserId, null);
});

test("3A-10. OWNER cannot be selected as assignee (by a MANAGER) -> ASSIGNEE_NOT_ELIGIBLE", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  actAs(MANAGER_ID);
  assert.deepEqual(await assignFollowUp(t.id, OWNER_ID), { error: "ASSIGNEE_NOT_ELIGIBLE" });
});

test("3A-ELIG. suspended / non-staff cannot be selected as assignee -> ASSIGNEE_NOT_ELIGIBLE", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  actAs(MANAGER_ID);
  assert.deepEqual(await assignFollowUp(t.id, SUSPENDED_ID), { error: "ASSIGNEE_NOT_ELIGIBLE" });
  assert.deepEqual(await assignFollowUp(t.id, NON_STAFF_ID), { error: "ASSIGNEE_NOT_ELIGIBLE" });
});

// ============================ EMPLOYEE own vs foreign ============================

test("3A-11a. EMPLOYEE cannot assign an unassigned task to ANOTHER user -> NOT_ALLOWED", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  assert.deepEqual(await assignFollowUp(t.id, EMPLOYEE2_ID), { error: "NOT_ALLOWED" });
  assert.equal((await taskRow(t.id)).assignedUserId, null);
});

test("3A-11b. EMPLOYEE cannot reassign a MANAGER-assigned follow-up -> NOT_ALLOWED", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: MANAGER_ID });
  assert.deepEqual(await assignFollowUp(t.id, EMPLOYEE_ID), { error: "NOT_ALLOWED" });
  assert.equal((await taskRow(t.id)).assignedUserId, MANAGER_ID);
});

test("3A-12. EMPLOYEE cannot complete/cancel/reschedule/edit a foreign-assigned follow-up", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: MANAGER_ID, title: "manager task", status: "todo" });
  assert.deepEqual(await completeFollowUp(t.id), { error: "NOT_ALLOWED" });
  assert.deepEqual(await cancelFollowUp(t.id), { error: "NOT_ALLOWED" });
  assert.deepEqual(await rescheduleFollowUp(t.id, new Date(Date.now() + 86400000).toISOString()), { error: "NOT_ALLOWED" });
  await assert.rejects(() => updateTask(t.id, createForm({ title: "forged" })), /autoris|allowed/i);
  await assert.rejects(() => updateTaskStatus(t.id, "done"), /autoris|allowed/i);
  const after = await taskRow(t.id);
  assert.equal(after.title, "manager task");
  assert.equal(after.status, "todo");
  assert.equal(after.assignedUserId, MANAGER_ID);
});

// ============================ MANAGER / ADMIN foreign powers ============================

test("3A-13. MANAGER can assign + complete a foreign (EMPLOYEE-assigned) follow-up", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "todo" });
  actAs(MANAGER_ID);
  assert.equal(await assignFollowUp(t.id, EMPLOYEE2_ID), undefined);
  assert.equal((await taskRow(t.id)).assignedUserId, EMPLOYEE2_ID);
  assert.equal(await completeFollowUp(t.id), undefined);
  assert.equal((await taskRow(t.id)).status, "done");
});

test("3A-14. ADMIN can perform allowed foreign operations", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "todo" });
  actAs(ADMIN_ID);
  assert.equal(await cancelFollowUp(t.id), undefined);
  assert.equal((await taskRow(t.id)).status, "cancelled");
});

// ============================ unassigned own-style ============================

test("3A-15. unassigned task: EMPLOYEE may claim, then complete + edit its own", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { status: "todo" });
  assert.equal(await claimFollowUp(t.id), undefined);
  assert.equal((await taskRow(t.id)).assignedUserId, EMPLOYEE_ID);
  await updateTask(t.id, createForm({ title: "renamed by owner" }));
  assert.equal((await taskRow(t.id)).title, "renamed by owner");
  assert.equal(await completeFollowUp(t.id), undefined);
  assert.equal((await taskRow(t.id)).status, "done");
});

test("3A-RELEASE. EMPLOYEE may release its OWN follow-up; a foreign release is NOT_ALLOWED", async () => {
  const client = await makeClient();
  const own = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "todo" });
  assert.equal(await releaseFollowUp(own.id), undefined);
  assert.equal((await taskRow(own.id)).assignedUserId, null);
  const foreign = await makeTask(client.id, { assignedUserId: MANAGER_ID, status: "todo" });
  assert.deepEqual(await releaseFollowUp(foreign.id), { error: "NOT_ALLOWED" });
  assert.equal((await taskRow(foreign.id)).assignedUserId, MANAGER_ID);
});

test("3A-15b. unassigned task: EMPLOYEE may edit/reschedule without claiming (own-style)", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { status: "todo" });
  await updateTask(t.id, createForm({ title: "edited unassigned" }));
  assert.equal((await taskRow(t.id)).title, "edited unassigned");
  const due = new Date(Date.now() + 2 * 86400000);
  assert.equal(await rescheduleFollowUp(t.id, due.toISOString()), undefined);
});

// ============================ concurrency ============================

test("3A-16. claiming a follow-up already held by someone else -> FOLLOWUP_CHANGED_RETRY (the concurrency loser's outcome)", async () => {
  // The FOR UPDATE lock serialises concurrent claims; the loser's locked
  // view shows the row already assigned to another worker, which is
  // exactly this deterministic case.
  const client = await makeClient();
  const t = await makeTask(client.id, { status: "todo", assignedUserId: EMPLOYEE2_ID });
  actAs(EMPLOYEE_ID);
  assert.deepEqual(await claimFollowUp(t.id), { error: "FOLLOWUP_CHANGED_RETRY" });
  assert.equal((await taskRow(t.id)).assignedUserId, EMPLOYEE2_ID, "the existing owner is untouched");
});

test("3A-16b. two parallel claims by the same actor on an unassigned follow-up settle safely -> assigned to that actor", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { status: "todo" });
  actAs(EMPLOYEE_ID);
  const results = await Promise.all([claimFollowUp(t.id), claimFollowUp(t.id)]);
  for (const r of results) assert.ok(r === undefined || r.error === "FOLLOWUP_CHANGED_RETRY", `unexpected ${JSON.stringify(r)}`);
  assert.equal((await taskRow(t.id)).assignedUserId, EMPLOYEE_ID);
});

test("3A-17. complete-vs-reschedule race: the stale writer is rejected, no silent last-write-win", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "todo" });
  const due = new Date(Date.now() + 3 * 86400000);
  const [a, b] = await Promise.all([completeFollowUp(t.id), rescheduleFollowUp(t.id, due.toISOString())]);
  const results = [a, b];
  const ok = results.filter((r) => r === undefined);
  const rejected = results.filter((r) => r && (r.error === "FOLLOWUP_CHANGED_RETRY" || r.error === "ALREADY_TERMINAL"));
  assert.equal(ok.length + rejected.length, 2);
  assert.equal(ok.length, 1, "one wins");
  assert.equal(rejected.length, 1, "the other is safely rejected");
});

// ============================ terminal + reopen ============================

test("3A-18. done follow-up: claim/complete/reschedule -> ALREADY_TERMINAL", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "done" });
  assert.deepEqual(await claimFollowUp(t.id), { error: "ALREADY_TERMINAL" });
  assert.deepEqual(await completeFollowUp(t.id), { error: "ALREADY_TERMINAL" });
  assert.deepEqual(await cancelFollowUp(t.id), { error: "ALREADY_TERMINAL" });
  assert.deepEqual(await rescheduleFollowUp(t.id, new Date().toISOString()), { error: "ALREADY_TERMINAL" });
});

test("3A-19. cancelled follow-up: complete/reschedule -> ALREADY_TERMINAL", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "cancelled" });
  assert.deepEqual(await completeFollowUp(t.id), { error: "ALREADY_TERMINAL" });
  assert.deepEqual(await rescheduleFollowUp(t.id, new Date().toISOString()), { error: "ALREADY_TERMINAL" });
});

test("3A-20/21. reopen done/cancelled -> todo (own, guarded)", async () => {
  const client = await makeClient();
  const t1 = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "done" });
  assert.equal(await reopenFollowUp(t1.id), undefined);
  assert.equal((await taskRow(t1.id)).status, "todo");
  const t2 = await makeTask(client.id, { assignedUserId: EMPLOYEE_ID, status: "cancelled" });
  assert.equal(await reopenFollowUp(t2.id), undefined);
  assert.equal((await taskRow(t2.id)).status, "todo");
});

test("3A-REOPEN-FOREIGN. EMPLOYEE cannot reopen a foreign done follow-up -> NOT_ALLOWED", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignedUserId: MANAGER_ID, status: "done" });
  assert.deepEqual(await reopenFollowUp(t.id), { error: "NOT_ALLOWED" });
});

// ============================ legacy / not-found ============================

test("3A-22. a legacy row (assignee free text, structured FKs NULL) is read back verbatim", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id, { assignee: "Legacy Person", assignedUserId: null, createdByUserId: null });
  const row = await taskRow(t.id);
  assert.equal(row.assignee, "Legacy Person");
  assert.equal(row.assignedUserId, null);
  assert.equal(row.createdByUserId, null);
});

test("3A-NF. verbs on a non-existent / invalid task id -> FOLLOWUP_NOT_FOUND", async () => {
  assert.deepEqual(await claimFollowUp(randomUUID()), { error: "FOLLOWUP_NOT_FOUND" });
  assert.deepEqual(await completeFollowUp("not-a-uuid"), { error: "FOLLOWUP_NOT_FOUND" });
});

// ============================ delete policy ============================

test("3A-26. client-linked hard-delete: EMPLOYEE denied, row survives", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  await assert.rejects(() => deleteTask(t.id), /autoris|allowed/i);
  assert.ok(await taskRow(t.id));
});

test("3A-27. client-linked hard-delete: MANAGER (RADAR_ASSIGN) allowed", async () => {
  const client = await makeClient();
  const t = await makeTask(client.id);
  createdTaskIds.delete(t.id);
  actAs(MANAGER_ID);
  await deleteTask(t.id);
  assert.equal(await taskRow(t.id), undefined);
});

test("3A-28. clientless internal task delete: ACTIVE EMPLOYEE (RADAR_WORK) allowed", async () => {
  const [t] = await db.insert(tasks).values({ title: "internal", clientId: null }).returning();
  createdTaskIds.add(t.id);
  await deleteTask(t.id);
  createdTaskIds.delete(t.id);
  assert.equal(await taskRow(t.id), undefined);
});

// ============================ structural ============================

test("3A-29. source structural: RADAR_WORK/RADAR_ASSIGN gates, session creator, no free-text/actor spoof reads", () => {
  const src = readFileSync(fileURLToPath(new URL("./crm-tasks.ts", import.meta.url)), "utf8");
  assert.ok(src.includes('requireStaffMember("RADAR_WORK")'), "human gate is RADAR_WORK");
  assert.ok(src.includes('permission: "RADAR_ASSIGN"'), "foreign escalation uses RADAR_ASSIGN");
  assert.ok(src.includes("await requireSession()"), "creator/actor from session");
  assert.ok(src.includes("createdByUserId: actorUserId"), "structured session creator");
  assert.ok(!/formData\.get\(["']assignee["']\)/.test(src), "never reads a caller free-text assignee");
  assert.ok(!/formData\.get\(["'](assignedUserId|actorUserId|createdByUserId|creatorUserId)["']\)/.test(src), "never reads a caller actor/creator id");
  assert.ok(!src.includes("requireStaffRole"), "Axis-A gate fully replaced");
  assert.ok(src.includes('.for("update")'), "decision verbs lock the row");
  assert.ok(/is not distinct from \$\{currentStatus\}/.test(src) || src.includes("is not distinct from"), "previous-value guarded update");
});

test("3A-UI. create-task-form.tsx and task-actions.tsx no longer submit a free-text assignee", () => {
  const form = readFileSync(fileURLToPath(new URL("../../components/crm/create-task-form.tsx", import.meta.url)), "utf8");
  const actions = readFileSync(fileURLToPath(new URL("../../components/crm/task-actions.tsx", import.meta.url)), "utf8");
  assert.ok(!/name=["']assignee["']/.test(form), "create form has no assignee input");
  assert.ok(!/name=["']assignee["']/.test(actions), "edit form has no assignee input");
  assert.ok(!/name=["'](assignedUserId|createdByUserId)["']/.test(form + actions), "no hidden structured-id input");
});
