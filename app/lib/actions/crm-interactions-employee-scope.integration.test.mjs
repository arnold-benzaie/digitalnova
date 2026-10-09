// P0-2H — enforcement of the EMPLOYEE CRM scope on createInteraction
// (lib/actions/crm-interactions.ts). Unlike every other P0-2 pilot,
// authorization here was already gated by requireRadarAccess("RADAR_WORK")
// — a FUNCTIONAL permission ("may work the radar") that OWNER, ADMIN,
// MANAGER and EMPLOYEE all hold (lib/rbac/permissions.ts) — never a
// tenant/client isolation check. Nothing in this file previously verified
// that the caller-supplied `clientId` belonged to the EMPLOYEE's own
// assigned-client scope, so an EMPLOYEE could log an interaction against
// ANY client in the agency. The fix adds
// `await requireCrmClientAccess(clientId, ...)` right after validating
// clientId's presence — the same CREATE-pattern primitive already used by
// createProject (3e40246) and createWebsite (ea06ace) — leaving
// requireRadarAccess("RADAR_WORK") and every other business rule (type/
// direction/outcome matrix, do-not-contact) completely untouched.
//
// Same mocking convention as every other P0-2 pilot: only @/lib/session
// is faked (requireSession/getCurrentSession). The code under test runs
// for real:
//   - REAL lib/rbac/require-staff-member.ts::requireRadarAccess() (reads
//     real seeded staff_members/staff_roles rows)
//   - REAL lib/crm-client-access.ts::requireCrmClientAccess() (never
//     mocked, file not modified by this mission)
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER ici est une VRAIE ligne staff_members (rôle OWNER, ACTIVE) — à la
// différence des pilotes précédents (qui pouvaient représenter OWNER
// comme "aucune ligne staff_members" puisque resolveCrmEmployeeScope()
// traite ça comme non-restreint), requireRadarAccess("RADAR_WORK") exige
// une permission RÉELLEMENT accordée par un rôle Axis-C existant — un
// utilisateur sans aucune ligne staff_members n'a aucune permission et se
// voit redirigé par requireRadarAccess() avant même d'atteindre le
// contrôle de scope CRM. La contrainte DB "AT-MOST-ONE OWNER per
// workspace" n'empêche pas d'en créer une (zéro OWNER existant dans cette
// base de test), et cette ligne jetable est nettoyée dans after() comme
// toutes les autres.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-interactions-employee-scope.integration.test.mjs
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
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });
// External-effect boundary stubbed (not the axis under test): logCrmAudit
// inserts a row with a real FK to `users.id` — the deny-case tests target
// clients the acting fixture user is not assigned to, so this mirrors
// every prior pilot's own stubbing of this exact boundary.
mock.module("@/lib/audit", { namedExports: { logCrmAudit: async () => {} } });

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
      role: "admin", // never "client" — the REAL Axis-C role (or absence
      // of one) is independently re-derived from staff_members by
      // requireRadarAccess()/requireCrmClientAccess() below, never from
      // this field.
      previousLastLoginAt: null,
    },
  };
}
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => mockState.session,
    getCurrentSession: async () => mockState.session,
  },
});

const { db } = await import("@/db");
const { crmClients, deals, interactions, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createInteraction } = await import("./crm-interactions.ts");

const createdClientIds = new Set();
const createdInteractionIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdInteractionIds.size) await db.delete(interactions).where(inArray(interactions.id, [...createdInteractionIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Interaction Scope Test User", status: "active" })
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
    .values({ name: `CRM Interaction Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

function makeInteractionFormData({ clientId, summary }) {
  const fd = new FormData();
  if (clientId !== undefined) fd.set("clientId", clientId);
  fd.set("summary", summary);
  // "note" is the simplest row of the write matrix: direction and
  // outcome must both stay null — the form's own <select> always
  // submits an explicit value, mirrored here as empty strings
  // (normalizeSelect() treats "" the same as absent).
  fd.set("type", "note");
  fd.set("direction", "");
  fd.set("outcome", "");
  return fd;
}

async function interactionsForClient(clientId) {
  return db.select().from(interactions).where(eq(interactions.clientId, clientId));
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const employeeUnassignedUserId = await makeStaffMember("EMPLOYEE"); // real ACTIVE EMPLOYEE, owns no client
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerUserId = await makeStaffMember("OWNER"); // real OWNER row — see file header

const clientA = await makeClient(employeeAUserId);
const clientB = await makeClient(employeeBUserId);

beforeEach(() => {
  actAs(adminUserId);
});

// =====================================================================
// ALLOW — EMPLOYEE assigned to the targeted client
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> createInteraction on A succeeds, row actually created", async () => {
  actAs(employeeAUserId);
  await createInteraction(makeInteractionFormData({ clientId: clientA.id, summary: "Employee A logging a note" }));
  const rows = await interactionsForClient(clientA.id);
  const created = rows.find((r) => r.summary === "Employee A logging a note");
  assert.ok(created, "interaction must have been created for client A, the employee's own assignment");
  createdInteractionIds.add(created.id);
});

// =====================================================================
// DENY — EMPLOYEE assigned to a DIFFERENT client, or to none at all
// =====================================================================
test("2 — EMPLOYEE assigned to B -> createInteraction on client A is denied (throws clientNotFound), nothing created", async () => {
  actAs(employeeBUserId);
  await assert.rejects(
    () => createInteraction(makeInteractionFormData({ clientId: clientA.id, summary: "Forged interaction" })),
    /introuvable/i,
  );
  const rows = await interactionsForClient(clientA.id);
  assert.ok(!rows.some((r) => r.summary === "Forged interaction"), "no interaction must have been created for an out-of-scope client");
});

test("3 — EMPLOYEE with no client assignment -> createInteraction on client A is denied (throws clientNotFound), nothing created", async () => {
  actAs(employeeUnassignedUserId);
  await assert.rejects(
    () => createInteraction(makeInteractionFormData({ clientId: clientA.id, summary: "Forged interaction 2" })),
    /introuvable/i,
  );
  const rows = await interactionsForClient(clientA.id);
  assert.ok(!rows.some((r) => r.summary === "Forged interaction 2"), "no interaction must have been created for an out-of-scope client");
});

// =====================================================================
// ALLOW — OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("4 — OWNER -> createInteraction on client B succeeds (not OWNER's own assignment)", async () => {
  actAs(ownerUserId);
  await createInteraction(makeInteractionFormData({ clientId: clientB.id, summary: "OWNER note" }));
  const rows = await interactionsForClient(clientB.id);
  const created = rows.find((r) => r.summary === "OWNER note");
  assert.ok(created, "interaction must have been created for client B");
  createdInteractionIds.add(created.id);
});

test("5 — ADMIN -> createInteraction on client A succeeds (not ADMIN's own assignment)", async () => {
  actAs(adminUserId);
  await createInteraction(makeInteractionFormData({ clientId: clientA.id, summary: "ADMIN note" }));
  const rows = await interactionsForClient(clientA.id);
  const created = rows.find((r) => r.summary === "ADMIN note");
  assert.ok(created, "interaction must have been created for client A");
  createdInteractionIds.add(created.id);
});

test("6 — MANAGER -> createInteraction on client B succeeds (current global behavior preserved)", async () => {
  actAs(managerUserId);
  await createInteraction(makeInteractionFormData({ clientId: clientB.id, summary: "MANAGER note" }));
  const rows = await interactionsForClient(clientB.id);
  const created = rows.find((r) => r.summary === "MANAGER note");
  assert.ok(created, "interaction must have been created for client B");
  createdInteractionIds.add(created.id);
});

// =========================================================
// 4F.8.4 — dealId and the EMPLOYEE scope: the client scope is checked
// FIRST, so an out-of-scope EMPLOYEE gets "Client introuvable." without the
// deal ever being examined; an in-scope EMPLOYEE may only link a deal of
// that same client. Deals are removed with their client by after().
// =========================================================

async function makeDeal(clientId) {
  const [deal] = await db.insert(deals).values({ clientId, title: `4F.8.4 scope deal ${randomUUID()}` }).returning();
  return deal;
}
const dealA = await makeDeal(clientA.id);
const dealB = await makeDeal(clientB.id);
function withDealId(fd, dealId) {
  fd.set("dealId", dealId);
  return fd;
}

test("4F.8.4 A — EMPLOYEE assigned to client A + deal of client A -> accepted, linked to that deal", async () => {
  actAs(employeeAUserId);
  await createInteraction(withDealId(makeInteractionFormData({ clientId: clientA.id, summary: "4F.8.4 A linked" }), dealA.id));
  const created = (await interactionsForClient(clientA.id)).find((r) => r.summary === "4F.8.4 A linked");
  assert.ok(created, "interaction must have been created for client A");
  createdInteractionIds.add(created.id);
  assert.equal(created.dealId, dealA.id);
});

test("4F.8.4 B — EMPLOYEE assigned to client A + deal of client B -> 'Deal introuvable.', nothing created", async () => {
  actAs(employeeAUserId);
  await assert.rejects(
    () => createInteraction(withDealId(makeInteractionFormData({ clientId: clientA.id, summary: "4F.8.4 B foreign deal" }), dealB.id)),
    { message: "Deal introuvable." },
  );
  assert.ok(!(await interactionsForClient(clientA.id)).some((r) => r.summary === "4F.8.4 B foreign deal"));
  assert.ok(!(await interactionsForClient(clientB.id)).some((r) => r.summary === "4F.8.4 B foreign deal"));
});

test("4F.8.4 C — EMPLOYEE NOT assigned to client A + deal of client A -> 'Client introuvable.' (the deal is never examined)", async () => {
  for (const userId of [employeeBUserId, employeeUnassignedUserId]) {
    actAs(userId);
    await assert.rejects(
      () => createInteraction(withDealId(makeInteractionFormData({ clientId: clientA.id, summary: "4F.8.4 C out of scope" }), dealA.id)),
      { message: "Client introuvable." },
    );
    // a malformed dealId would fail the deal check — still "Client introuvable.", so the scope gate ran first
    await assert.rejects(
      () => createInteraction(withDealId(makeInteractionFormData({ clientId: clientA.id, summary: "4F.8.4 C out of scope" }), "not-a-uuid")),
      { message: "Client introuvable." },
    );
  }
  assert.ok(!(await interactionsForClient(clientA.id)).some((r) => r.summary === "4F.8.4 C out of scope"));
});
