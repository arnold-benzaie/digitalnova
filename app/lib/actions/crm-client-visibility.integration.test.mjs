// MISSION PHASE 3 — CRM CLIENT VISIBILITY BY ASSIGNMENT — integration
// tests for lib/crm-client-access.ts (the shared authorization primitive)
// and its wiring into every id-scoped mutation in lib/actions/crm-clients.ts.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview. Same mocking convention as
// crm-clients-radar-foundation.integration.test.mjs: @/lib/session's
// requireSession() is faked with a mutable session state so the REAL
// requireStaffRole() (lib/dev-role.ts) and the REAL
// resolveCrmEmployeeScope() (lib/crm-client-access.ts, never mocked) run
// against it — every ALLOW/DENY below is a genuine runtime decision
// against real staff_members/crm_clients rows, never a textual check.
//
// OWNER is deliberately represented as "no staff_members row at all"
// rather than a real OWNER row: resolveCrmEmployeeScope() cannot
// distinguish OWNER from ADMIN from "no Axis-C row at all" (all three
// resolve to `null` / unrestricted by this function's own design — see
// its doc comment), and staff_members has a DB-enforced AT-MOST-ONE-
// OWNER-per-workspace partial unique index that a disposable per-run
// test fixture must not risk colliding with real/other-suite seed data.
// MANAGER and ADMIN get real, disposable staff_members rows, tracked and
// deleted in after() — never left as debris for a future run.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-client-visibility.integration.test.mjs
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
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async () => {} } });

/** @type {{ session: object | null }} */
let mockState = { session: null };
function actAs(userId) {
  mockState = {
    session: {
      userId,
      clerkUserId: `clerk_${userId}`,
      email: `${userId}@example.com`,
      fullName: "Test User",
      firstName: "Test",
      organizationId: "test-org",
      organizationName: "Test Org",
      role: "admin", // never "client" — requireStaffRole()'s own gate; the
      // REAL Axis-C role (or absence of one) is what resolveCrmEmployeeScope()
      // independently re-derives from staff_members below, never from this field.
      previousLastLoginAt: null,
    },
  };
}
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) throw new Error("UNAUTHENTICATED — no session");
      return mockState.session;
    },
    getCurrentSession: async () => mockState.session,
  },
});

const { db } = await import("@/db");
const { crmClients, organizations, staffMembers, staffRoles, auditLog, users } = await import("@/db/schema");
const { and, eq, inArray } = await import("drizzle-orm");
const { resolveCrmEmployeeScope, resolveCrmEmployeeScopeForUser, isCrmClientVisibleToScope, requireCrmClientAccess } = await import(
  "../crm-client-access.ts"
);
const {
  updateClientStage,
  updateClientMarket,
  updateClient,
  updateClientDoNotContact,
  archiveClient,
  unarchiveClient,
  deleteClient,
} = await import("./crm-clients.ts");

const createdClientIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdClientIds.size) await db.delete(auditLog).where(inArray(auditLog.targetId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function internalOrgId() {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  if (!org) throw new Error("Aucune organisation interne (isInternal=true) trouvée dans la base de test locale.");
  return org.id;
}

async function staffRoleId(name) {
  const [row] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
  if (!row) throw new Error(`Rôle Workforce "${name}" introuvable.`);
  return row.id;
}

/** A real `users` row — required by both staff_members.user_id's and
 * crm_clients.assigned_user_id's FK constraints (both reference users.id). */
async function makeUser() {
  const [row] = await db
    .insert(users)
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Visibility Test User", status: "active" })
    .returning();
  createdUserIds.add(row.id);
  return row.id;
}

async function makeStaffMember(roleName) {
  const userId = await makeUser();
  const workspaceOrgId = await internalOrgId();
  const [row] = await db
    .insert(staffMembers)
    .values({ userId, workspaceOrgId, roleId: await staffRoleId(roleName), status: "ACTIVE" })
    .returning();
  createdStaffMemberIds.add(row.id);
  return userId;
}

async function makeClient(assignedUserId) {
  const [client] = await db
    .insert(crmClients)
    .values({ name: `CRM Visibility Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function clientRow(id) {
  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1);
  return row;
}

// Fixtures shared across the whole file: created once, reused by every
// test (real DB rows, matching this mission's "prefer real DB tests over
// mocks" instruction).
const employee1UserId = await makeStaffMember("EMPLOYEE");
const employee2UserId = await makeStaffMember("EMPLOYEE");
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // real users row, but deliberately NO staff_members row — see file header

const clientA = await makeClient(employee1UserId);
const clientB = await makeClient(employee2UserId);
const clientC = await makeClient(null); // unassigned

// ---- 1. resolveCrmEmployeeScope() / resolveCrmEmployeeScopeForUser() ----

test("EMPLOYEE resolves to a real, own-userId scope", async () => {
  actAs(employee1UserId);
  const scope = await resolveCrmEmployeeScope();
  assert.deepEqual(scope, { userId: employee1UserId });
});

test("MANAGER resolves to null (unrestricted) — current global behavior preserved, not touched", async () => {
  actAs(managerUserId);
  const scope = await resolveCrmEmployeeScope();
  assert.equal(scope, null);
});

test("ADMIN resolves to null (unrestricted)", async () => {
  actAs(adminUserId);
  const scope = await resolveCrmEmployeeScope();
  assert.equal(scope, null);
});

test("OWNER-like (no staff_members row at all) resolves to null (unrestricted)", async () => {
  actAs(ownerLikeUserId);
  const scope = await resolveCrmEmployeeScope();
  assert.equal(scope, null);
});

test("resolveCrmEmployeeScopeForUser() is the same primitive resolveCrmEmployeeScope() builds on", async () => {
  assert.deepEqual(await resolveCrmEmployeeScopeForUser(employee1UserId), { userId: employee1UserId });
  assert.equal(await resolveCrmEmployeeScopeForUser(managerUserId), null);
});

// ---- 2. isCrmClientVisibleToScope() — pure decision function -----------

test("isCrmClientVisibleToScope: unrestricted (null) scope sees everything, including unassigned", () => {
  assert.equal(isCrmClientVisibleToScope(null, employee1UserId), true);
  assert.equal(isCrmClientVisibleToScope(null, employee2UserId), true);
  assert.equal(isCrmClientVisibleToScope(null, null), true);
});

test("isCrmClientVisibleToScope: EMPLOYEE scope sees only their own assignedUserId, never null, never someone else's", () => {
  const scope = { userId: employee1UserId };
  assert.equal(isCrmClientVisibleToScope(scope, employee1UserId), true);
  assert.equal(isCrmClientVisibleToScope(scope, employee2UserId), false);
  assert.equal(isCrmClientVisibleToScope(scope, null), false);
});

// ---- 3. List/search/pagination query shape — items 1-9, 16 -------------
//
// app/admin/crm/clients/page.tsx builds its WHERE clause by pushing
// `eq(crmClients.assignedUserId, scope.userId)` onto the SAME conditions
// array as every other filter, exactly reproduced here — this proves the
// underlying data layer never leaks a row or a count outside scope; the
// page itself (a Server Component) is additionally proven end-to-end by
// the E2E spec.

async function listClientIdsForScope(scope) {
  const condition = scope ? eq(crmClients.assignedUserId, scope.userId) : undefined;
  const rows = await db
    .select({ id: crmClients.id })
    .from(crmClients)
    .where(condition ? and(condition, inArray(crmClients.id, [clientA.id, clientB.id, clientC.id])) : inArray(crmClients.id, [clientA.id, clientB.id, clientC.id]));
  return rows.map((r) => r.id).sort();
}

test("OWNER (no staff row) sees client A and client B", async () => {
  const ids = await listClientIdsForScope(null);
  assert.ok(ids.includes(clientA.id) && ids.includes(clientB.id));
});

test("ADMIN sees both A and B", async () => {
  const scope = await (async () => {
    actAs(adminUserId);
    return resolveCrmEmployeeScope();
  })();
  const ids = await listClientIdsForScope(scope);
  assert.ok(ids.includes(clientA.id) && ids.includes(clientB.id));
});

test("MANAGER retains current global visibility (sees A and B)", async () => {
  actAs(managerUserId);
  const scope = await resolveCrmEmployeeScope();
  const ids = await listClientIdsForScope(scope);
  assert.ok(ids.includes(clientA.id) && ids.includes(clientB.id));
});

test("EMPLOYEE 1 sees ONLY client A — not B, not unassigned C", async () => {
  actAs(employee1UserId);
  const scope = await resolveCrmEmployeeScope();
  const ids = await listClientIdsForScope(scope);
  assert.deepEqual(ids, [clientA.id]);
});

test("EMPLOYEE 2 sees ONLY client B — not A, not unassigned C", async () => {
  actAs(employee2UserId);
  const scope = await resolveCrmEmployeeScope();
  const ids = await listClientIdsForScope(scope);
  assert.deepEqual(ids, [clientB.id]);
});

test("no count leakage: EMPLOYEE 1's scoped count is 1, never the agency-wide total", async () => {
  actAs(employee1UserId);
  const scope = await resolveCrmEmployeeScope();
  const condition = and(eq(crmClients.assignedUserId, scope.userId), inArray(crmClients.id, [clientA.id, clientB.id, clientC.id]));
  const rows = await db.select({ id: crmClients.id }).from(crmClients).where(condition);
  assert.equal(rows.length, 1, "an EMPLOYEE's own scoped count must never include B or the unassigned C");
});

// ---- 4. Detail access — items 10, 11 ------------------------------------

test("EMPLOYEE direct access to B (assigned to someone else) is denied", async () => {
  actAs(employee1UserId);
  const scope = await resolveCrmEmployeeScope();
  assert.equal(isCrmClientVisibleToScope(scope, clientB.assignedUserId), false);
});

test("EMPLOYEE direct access to unassigned C is denied", async () => {
  actAs(employee1UserId);
  const scope = await resolveCrmEmployeeScope();
  assert.equal(isCrmClientVisibleToScope(scope, clientC.assignedUserId), false);
});

test("EMPLOYEE direct access to their OWN client A is allowed", async () => {
  actAs(employee1UserId);
  const scope = await resolveCrmEmployeeScope();
  assert.equal(isCrmClientVisibleToScope(scope, clientA.assignedUserId), true);
});

// ---- 5. requireCrmClientAccess() — the mutation gate --------------------

test("requireCrmClientAccess(): EMPLOYEE targeting their own client resolves without throwing", async () => {
  actAs(employee1UserId);
  await requireCrmClientAccess(clientA.id, new Error("should not throw"));
});

test("requireCrmClientAccess(): EMPLOYEE targeting someone else's client throws", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => requireCrmClientAccess(clientB.id, new Error("not-yours")), /not-yours/);
});

test("requireCrmClientAccess(): EMPLOYEE targeting an unassigned client throws", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => requireCrmClientAccess(clientC.id, new Error("not-yours")), /not-yours/);
});

test("requireCrmClientAccess(): EMPLOYEE targeting a nonexistent id throws the SAME error as 'not yours' (no existence disclosure)", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => requireCrmClientAccess(randomUUID(), new Error("not-yours")), /not-yours/);
});

test("requireCrmClientAccess(): unrestricted scope (ADMIN) never throws, for any real id", async () => {
  actAs(adminUserId);
  await requireCrmClientAccess(clientA.id, new Error("should not throw"));
  await requireCrmClientAccess(clientB.id, new Error("should not throw"));
  await requireCrmClientAccess(clientC.id, new Error("should not throw"));
});

// ---- 6. Real mutations end to end — items 12, 13, 14, 15 ----------------

beforeEach(() => {
  actAs(adminUserId);
});

test("EMPLOYEE 1 forged mutation (updateClientStage) against B is denied, B unchanged", async () => {
  const before = await clientRow(clientB.id);
  actAs(employee1UserId);
  await assert.rejects(() => updateClientStage(clientB.id, "prospect"));
  const after = await clientRow(clientB.id);
  assert.equal(after.stage, before.stage);
});

test("EMPLOYEE 1 forged mutation (archiveClient) against B is denied, B not archived", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => archiveClient(clientB.id));
  const after = await clientRow(clientB.id);
  assert.equal(after.archivedAt, null);
});

test("EMPLOYEE 1 forged mutation (deleteClient) against B is denied, B still exists", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => deleteClient(clientB.id));
  const after = await clientRow(clientB.id);
  assert.ok(after, "B must still exist — deleteClient must not have run");
});

test("EMPLOYEE 1 forged mutation (updateClientDoNotContact) against B is denied", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => updateClientDoNotContact(clientB.id, true, "forged"));
  const after = await clientRow(clientB.id);
  assert.equal(after.doNotContact, false);
});

test("EMPLOYEE 1 forged mutation (updateClientStage) against unassigned C is denied", async () => {
  const before = await clientRow(clientC.id);
  actAs(employee1UserId);
  await assert.rejects(() => updateClientStage(clientC.id, "prospect"));
  const after = await clientRow(clientC.id);
  assert.equal(after.stage, before.stage);
});

test("EMPLOYEE 1 forged mutation (archiveClient) against unassigned C is denied", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => archiveClient(clientC.id));
  const after = await clientRow(clientC.id);
  assert.equal(after.archivedAt, null);
});

test("valid EMPLOYEE 1 mutation (updateClientStage) against THEIR OWN client A works", async () => {
  actAs(employee1UserId);
  await updateClientStage(clientA.id, "prospect");
  const after = await clientRow(clientA.id);
  assert.equal(after.stage, "prospect");
});

test("valid EMPLOYEE 1 mutation (updateClientDoNotContact) against THEIR OWN client A works", async () => {
  actAs(employee1UserId);
  await updateClientDoNotContact(clientA.id, true, "client requested");
  const after = await clientRow(clientA.id);
  assert.equal(after.doNotContact, true);
  // Restore for later tests in this file that assume a clean A.
  await updateClientDoNotContact(clientA.id, false, "");
});

test("valid EMPLOYEE 1 mutation (unarchiveClient) against THEIR OWN client A works (no-op archive/unarchive round trip)", async () => {
  actAs(employee1UserId);
  await archiveClient(clientA.id);
  assert.ok((await clientRow(clientA.id)).archivedAt, "A must be archived by its own assigned employee");
  await unarchiveClient(clientA.id);
  assert.equal((await clientRow(clientA.id)).archivedAt, null);
});

test("OWNER/ADMIN existing mutations remain fully functional against a client NOT their own (unrestricted, unchanged)", async () => {
  actAs(adminUserId); // ADMIN, real staff_members row, targeting B (assigned to employee2)
  await updateClientStage(clientB.id, "churned");
  const after = await clientRow(clientB.id);
  assert.equal(after.stage, "churned");
  await updateClientStage(clientB.id, "prospect"); // restore
});

test("OWNER-like (no staff row) mutations remain fully functional against any client (unrestricted, unchanged)", async () => {
  actAs(ownerLikeUserId);
  await updateClientStage(clientC.id, "prospect");
  const after = await clientRow(clientC.id);
  assert.equal(after.stage, "prospect");
  await updateClientStage(clientC.id, "lead"); // restore
});

test("MANAGER mutations remain fully functional against a client not their own (current global behavior preserved)", async () => {
  actAs(managerUserId);
  await updateClient(clientA.id, (() => {
    const fd = new FormData();
    fd.set("name", clientA.name);
    return fd;
  })());
  const after = await clientRow(clientA.id);
  assert.equal(after.name, clientA.name);
});

test("updateClientMarket honors the same EMPLOYEE ownership gate (forged against B denied, own A allowed)", async () => {
  actAs(employee1UserId);
  await assert.rejects(() => updateClientMarket(clientB.id, "EUROPE"));
  await updateClientMarket(clientA.id, "EUROPE");
});
