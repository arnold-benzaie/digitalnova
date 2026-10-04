// P0-2B — deuxième pilote : enforcement atomique du scope EMPLOYEE sur
// updateProjectStatus (lib/actions/crm-projects.ts), exactement le même
// pattern que le pilote P0-2A validé sur updateDealStage (voir
// lib/actions/crm-deals-employee-scope.integration.test.mjs) — aucune
// autre fonction de crm-projects.ts n'est modifiée ni testée ici.
//
// Avant ce correctif, updateProjectStatus faisait
// `db.update(projects).set({ status }).where(eq(projects.id, id))` — sans
// jointure vers crm_clients.assigned_user_id : un EMPLOYEE authentifié
// pouvait modifier le statut de N'IMPORTE QUEL projet de l'agence
// (IDOR/BOLA). Le correctif intègre le scope directement dans le WHERE
// du même UPDATE (via buildCrmEmployeeScopePredicate(), un EXISTS
// corrélé) — un seul statement atomique, jamais un SELECT séparé suivi
// d'un UPDATE (pas de fenêtre TOCTOU).
//
// Même convention que lib/actions/crm-client-visibility.integration.test.mjs
// et lib/actions/crm-deals-employee-scope.integration.test.mjs : seule la
// source d'identité @/lib/session est simulée (requireSession/
// getCurrentSession). Le code sous test tourne réellement :
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::resolveCrmEmployeeScope() /
//     buildCrmEmployeeScopePredicate() (jamais mockés)
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER est représenté comme "aucune ligne staff_members" plutôt qu'une
// vraie ligne OWNER — même justification que dans le pilote précédent
// (contrainte d'unicité OWNER-par-workspace, et resolveCrmEmployeeScope()
// ne distingue de toute façon pas OWNER/ADMIN/"pas de ligne Axis-C du
// tout" : les trois résolvent à `null`).
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-projects-employee-scope.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });
// External-effect boundary stubbed (not the axis under test): logCrmAudit
// inserts a row with a real FK to `users.id`; the deny-case tests target
// projects belonging to clients assigned to OTHER fabricated users, so
// this mirrors the deals pilot's own stubbing of this exact boundary.
mock.module("@/lib/audit", { namedExports: { logCrmAudit: async () => {} } });

/** @type {{ session: object | null }} */
let mockState = { session: null };
function actAs(userId, role = "admin") {
  mockState = {
    session: {
      userId,
      clerkUserId: `clerk_${userId}`,
      email: `${userId}@example.com`,
      fullName: "Test User",
      firstName: "Test",
      organizationId: "test-org",
      organizationName: "Test Org",
      role, // never "client" except for the CLIENT-denied scenario itself —
      // the REAL Axis-C role (or absence of one) is independently re-derived
      // by resolveCrmEmployeeScope() from staff_members below, never from
      // this field.
      previousLastLoginAt: null,
    },
  };
}
function actAsAnonymous() {
  mockState = { session: null };
}
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) redirect("/sign-in");
      return mockState.session;
    },
    getCurrentSession: async () => mockState.session,
  },
});

const { db } = await import("@/db");
const { crmClients, projects, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createProject, updateProject, updateProjectStatus, deleteProject } = await import("./crm-projects.ts");

const createdClientIds = new Set();
const createdProjectIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdProjectIds.size) await db.delete(projects).where(inArray(projects.id, [...createdProjectIds]));
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

async function makeUser() {
  const [row] = await db
    .insert(users)
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Project Scope Test User", status: "active" })
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
    .values({ name: `CRM Project Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeProject(clientId, name) {
  const [project] = await db.insert(projects).values({ clientId, name, status: "planning" }).returning();
  createdProjectIds.add(project.id);
  return project;
}

async function projectRow(id) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row;
}

function makeProjectFormData({ clientId, name, description }) {
  const fd = new FormData();
  if (clientId !== undefined) fd.set("clientId", clientId);
  fd.set("name", name);
  if (description !== undefined) fd.set("description", description);
  return fd;
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const employeeUnassignedUserId = await makeStaffMember("EMPLOYEE"); // real ACTIVE EMPLOYEE, owns no client
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // no staff_members row at all — see file header

const clientA = await makeClient(employeeAUserId);
const clientB = await makeClient(employeeBUserId);

beforeEach(() => {
  actAs(adminUserId);
});

// =====================================================================
// ALLOW — OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("1 — OWNER-like (no staff row) -> updateProjectStatus on client A's project succeeds", async () => {
  const project = await makeProject(clientA.id, "OWNER-like allow");
  actAs(ownerLikeUserId);
  await updateProjectStatus(project.id, "in_progress");
  const after = await projectRow(project.id);
  assert.equal(after.status, "in_progress");
});

test("2 — ADMIN -> updateProjectStatus on client B's project succeeds (not ADMIN's own assignment)", async () => {
  const project = await makeProject(clientB.id, "ADMIN allow");
  actAs(adminUserId);
  await updateProjectStatus(project.id, "in_progress");
  const after = await projectRow(project.id);
  assert.equal(after.status, "in_progress");
});

test("3 — MANAGER -> updateProjectStatus on client A's project succeeds (current global behavior preserved)", async () => {
  const project = await makeProject(clientA.id, "MANAGER allow");
  actAs(managerUserId);
  await updateProjectStatus(project.id, "completed");
  const after = await projectRow(project.id);
  assert.equal(after.status, "completed");
});

// =====================================================================
// ALLOW — EMPLOYEE acting on their OWN assigned client's project
// =====================================================================
test("4 — EMPLOYEE assigned to client A -> updateProjectStatus on A's project succeeds", async () => {
  const project = await makeProject(clientA.id, "Employee A allow");
  actAs(employeeAUserId);
  await updateProjectStatus(project.id, "on_hold");
  const after = await projectRow(project.id);
  assert.equal(after.status, "on_hold");
});

// =====================================================================
// DENY — EMPLOYEE outside their scope: zero rows changed, verified
// directly against the DB. updateProjectStatus does NOT throw on a 0-row
// match (same pre-existing behavior as a genuinely nonexistent id — the
// existing `project?.clientId` / `if (project && ...)` guards already
// absorb this without any further error-handling change) — so the
// assertion here is "resolves normally AND the row is provably
// untouched", not "rejects".
// =====================================================================
test("5 — EMPLOYEE assigned to B -> updateProjectStatus on A's project is silently denied, A unchanged", async () => {
  const project = await makeProject(clientA.id, "Employee B deny on A");
  actAs(employeeBUserId);
  await updateProjectStatus(project.id, "completed"); // resolves normally — 0 rows matched, same as a nonexistent id
  const after = await projectRow(project.id);
  assert.equal(after.status, "planning", "status must remain untouched — the UPDATE matched zero rows");
});

test("6 — EMPLOYEE with no client assignment -> updateProjectStatus on A's project is silently denied, A unchanged", async () => {
  const project = await makeProject(clientA.id, "Unassigned employee deny on A");
  actAs(employeeUnassignedUserId);
  await updateProjectStatus(project.id, "completed"); // resolves normally — 0 rows matched, same as a nonexistent id
  const after = await projectRow(project.id);
  assert.equal(after.status, "planning", "status must remain untouched — the UPDATE matched zero rows");
});

// =====================================================================
// DENY — CLIENT (Axis-A) role: blocked upstream by requireStaffRole(),
// never even reaches the scope predicate
// =====================================================================
test("7 — CLIENT role -> updateProjectStatus refused (redirect /dashboard), project untouched", async () => {
  const project = await makeProject(clientA.id, "Client role deny");
  actAs(randomUUID(), "client");
  await assert.rejects(() => updateProjectStatus(project.id, "completed"), (err) => {
    const digest = String(err?.digest ?? "");
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    assert.ok(digest.includes("/dashboard"), `expected redirect to /dashboard, got digest: ${digest}`);
    return true;
  });
  const after = await projectRow(project.id);
  assert.equal(after.status, "planning", "status must remain untouched");
});

// =====================================================================
// DENY — unauthenticated: blocked upstream, never reaches the scope
// predicate either
// =====================================================================
test("8 — unauthenticated -> updateProjectStatus redirects to /sign-in, project untouched", async () => {
  const project = await makeProject(clientA.id, "Anonymous deny");
  actAsAnonymous();
  await assert.rejects(() => updateProjectStatus(project.id, "completed"), (err) => {
    const digest = String(err?.digest ?? "");
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    assert.ok(digest.includes("/sign-in"), `expected redirect to /sign-in, got digest: ${digest}`);
    return true;
  });
  const after = await projectRow(project.id);
  assert.equal(after.status, "planning", "status must remain untouched");
});

// =====================================================================
// P0-2F — updateProject (full edit: name/description/dates). Unlike
// updateProjectStatus, this function already has a pre-existing
// `if (!project) throw ...projectNotFound` guard (unrelated to this
// mission) — once the scope predicate makes the UPDATE match 0 rows for
// a denied EMPLOYEE, that guard fires exactly as it already does for a
// genuinely nonexistent id. DENY assertions here are therefore
// rejections, verified alongside a direct DB re-read proving the row is
// untouched.
// =====================================================================
test("9 — OWNER-like (no staff row) -> updateProject on client A's project succeeds", async () => {
  const project = await makeProject(clientA.id, "Original name");
  actAs(ownerLikeUserId);
  const updated = await updateProject(project.id, makeProjectFormData({ name: "OWNER-like edit" }));
  assert.equal(updated.name, "OWNER-like edit");
  const after = await projectRow(project.id);
  assert.equal(after.name, "OWNER-like edit");
});

test("10 — ADMIN -> updateProject on client B's project succeeds (not ADMIN's own assignment)", async () => {
  const project = await makeProject(clientB.id, "Original name");
  actAs(adminUserId);
  const updated = await updateProject(project.id, makeProjectFormData({ name: "ADMIN edit" }));
  assert.equal(updated.name, "ADMIN edit");
  const after = await projectRow(project.id);
  assert.equal(after.name, "ADMIN edit");
});

test("11 — MANAGER -> updateProject on client A's project succeeds (current global behavior preserved)", async () => {
  const project = await makeProject(clientA.id, "Original name");
  actAs(managerUserId);
  const updated = await updateProject(project.id, makeProjectFormData({ name: "MANAGER edit" }));
  assert.equal(updated.name, "MANAGER edit");
  const after = await projectRow(project.id);
  assert.equal(after.name, "MANAGER edit");
});

test("12 — EMPLOYEE assigned to client A -> updateProject on A's project succeeds, fields applied", async () => {
  const project = await makeProject(clientA.id, "Original name");
  actAs(employeeAUserId);
  const updated = await updateProject(project.id, makeProjectFormData({ name: "Employee A edit", description: "Updated description" }));
  assert.equal(updated.name, "Employee A edit");
  assert.equal(updated.description, "Updated description");
  const after = await projectRow(project.id);
  assert.equal(after.name, "Employee A edit");
  assert.equal(after.description, "Updated description");
});

test("13 — EMPLOYEE assigned to B -> updateProject on A's project is denied (throws projectNotFound), A unchanged", async () => {
  const project = await makeProject(clientA.id, "Original name");
  actAs(employeeBUserId);
  await assert.rejects(() => updateProject(project.id, makeProjectFormData({ name: "Forged edit" })), /introuvable/i);
  const after = await projectRow(project.id);
  assert.equal(after.name, "Original name", "name must remain untouched — the UPDATE matched zero rows");
});

test("14 — EMPLOYEE with no client assignment -> updateProject on A's project is denied (throws projectNotFound), A unchanged", async () => {
  const project = await makeProject(clientA.id, "Original name");
  actAs(employeeUnassignedUserId);
  await assert.rejects(() => updateProject(project.id, makeProjectFormData({ name: "Forged edit" })), /introuvable/i);
  const after = await projectRow(project.id);
  assert.equal(after.name, "Original name", "name must remain untouched — the UPDATE matched zero rows");
});

// =====================================================================
// P0-2F — deleteProject. Same pre-existing `if (!project) throw
// ...projectNotFound` guard — DENY assertions are rejections, verified
// against a direct DB re-read proving the project still exists.
// =====================================================================
test("15 — OWNER-like (no staff row) -> deleteProject on client A's project succeeds", async () => {
  const project = await makeProject(clientA.id, "OWNER-like delete");
  actAs(ownerLikeUserId);
  await deleteProject(project.id);
  const after = await projectRow(project.id);
  assert.equal(after, undefined, "project must be actually deleted");
});

test("16 — ADMIN -> deleteProject on client B's project succeeds (not ADMIN's own assignment)", async () => {
  const project = await makeProject(clientB.id, "ADMIN delete");
  actAs(adminUserId);
  await deleteProject(project.id);
  const after = await projectRow(project.id);
  assert.equal(after, undefined, "project must be actually deleted");
});

test("17 — MANAGER -> deleteProject on client A's project succeeds (current global behavior preserved)", async () => {
  const project = await makeProject(clientA.id, "MANAGER delete");
  actAs(managerUserId);
  await deleteProject(project.id);
  const after = await projectRow(project.id);
  assert.equal(after, undefined, "project must be actually deleted");
});

test("18 — EMPLOYEE assigned to client A -> deleteProject on A's project succeeds", async () => {
  const project = await makeProject(clientA.id, "Employee A delete");
  actAs(employeeAUserId);
  await deleteProject(project.id);
  const after = await projectRow(project.id);
  assert.equal(after, undefined, "project must be actually deleted");
});

test("19 — EMPLOYEE assigned to B -> deleteProject on A's project is denied (throws projectNotFound), A still exists", async () => {
  const project = await makeProject(clientA.id, "Employee B deny on A");
  actAs(employeeBUserId);
  await assert.rejects(() => deleteProject(project.id), /introuvable/i);
  const after = await projectRow(project.id);
  assert.ok(after, "project must still exist — the DELETE matched zero rows");
  assert.equal(after.name, "Employee B deny on A");
  assert.equal(after.clientId, clientA.id);
});

test("20 — EMPLOYEE with no client assignment -> deleteProject on A's project is denied (throws projectNotFound), A still exists", async () => {
  const project = await makeProject(clientA.id, "Unassigned employee deny on A");
  actAs(employeeUnassignedUserId);
  await assert.rejects(() => deleteProject(project.id), /introuvable/i);
  const after = await projectRow(project.id);
  assert.ok(after, "project must still exist — the DELETE matched zero rows");
  assert.equal(after.name, "Unassigned employee deny on A");
  assert.equal(after.clientId, clientA.id);
});

// =====================================================================
// P0-2F — createProject. clientId is caller-supplied form input, so the
// scope check is a prior requireCrmClientAccess() call (SELECT-then-check
// — the accepted CREATE pattern, same primitive lib/actions/
// crm-clients.ts's own mutations already use) rather than an atomic
// predicate folded into a WHERE clause (there is none on an INSERT).
// =====================================================================
test("21 — OWNER-like (no staff row) -> createProject for client B succeeds (not OWNER's own assignment)", async () => {
  actAs(ownerLikeUserId);
  await createProject(makeProjectFormData({ clientId: clientB.id, name: "OWNER-like create" }));
  const rows = await db.select().from(projects).where(eq(projects.clientId, clientB.id));
  const created = rows.find((r) => r.name === "OWNER-like create");
  assert.ok(created, "project must have been created for client B");
  createdProjectIds.add(created.id);
});

test("22 — ADMIN -> createProject for client A succeeds (not ADMIN's own assignment)", async () => {
  actAs(adminUserId);
  await createProject(makeProjectFormData({ clientId: clientA.id, name: "ADMIN create" }));
  const rows = await db.select().from(projects).where(eq(projects.clientId, clientA.id));
  const created = rows.find((r) => r.name === "ADMIN create");
  assert.ok(created, "project must have been created for client A");
  createdProjectIds.add(created.id);
});

test("23 — MANAGER -> createProject for client B succeeds (current global behavior preserved)", async () => {
  actAs(managerUserId);
  await createProject(makeProjectFormData({ clientId: clientB.id, name: "MANAGER create" }));
  const rows = await db.select().from(projects).where(eq(projects.clientId, clientB.id));
  const created = rows.find((r) => r.name === "MANAGER create");
  assert.ok(created, "project must have been created for client B");
  createdProjectIds.add(created.id);
});

test("24 — EMPLOYEE assigned to client A -> createProject for A succeeds", async () => {
  actAs(employeeAUserId);
  await createProject(makeProjectFormData({ clientId: clientA.id, name: "Employee A create" }));
  const rows = await db.select().from(projects).where(eq(projects.clientId, clientA.id));
  const created = rows.find((r) => r.name === "Employee A create");
  assert.ok(created, "project must have been created for client A, the employee's own assignment");
  createdProjectIds.add(created.id);
});

test("25 — EMPLOYEE assigned to B -> createProject for client A is denied (throws clientNotFound), nothing created", async () => {
  actAs(employeeBUserId);
  await assert.rejects(() => createProject(makeProjectFormData({ clientId: clientA.id, name: "Forged create" })), /introuvable/i);
  const rows = await db.select().from(projects).where(eq(projects.clientId, clientA.id));
  assert.ok(!rows.some((r) => r.name === "Forged create"), "no project must have been created for an out-of-scope client");
});

test("26 — EMPLOYEE with no client assignment -> createProject for client A is denied (throws clientNotFound), nothing created", async () => {
  actAs(employeeUnassignedUserId);
  await assert.rejects(() => createProject(makeProjectFormData({ clientId: clientA.id, name: "Forged create 2" })), /introuvable/i);
  const rows = await db.select().from(projects).where(eq(projects.clientId, clientA.id));
  assert.ok(!rows.some((r) => r.name === "Forged create 2"), "no project must have been created for an out-of-scope client");
});
