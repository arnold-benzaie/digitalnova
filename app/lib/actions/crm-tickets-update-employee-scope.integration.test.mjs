// P0-2D — fourth pilot: atomic enforcement of the EMPLOYEE scope on
// updateTicket (lib/actions/crm-tickets.ts) — the "full edit"
// (subject/description/priority) sibling of updateTicketStatus, already
// scoped in 2d4c5b8. Same mechanism, applied to ONLY this function:
// buildCrmEmployeeScopePredicate() AND-ed into the existing UPDATE's own
// WHERE clause — a single atomic statement, never a separate
// SELECT-then-UPDATE (no TOCTOU window). createTicket, updateTicketStatus
// and deleteTicket are not touched by this mission and are not exercised
// here beyond import-time (this file never calls them).
//
// IMPORTANT BEHAVIORAL DIFFERENCE from the three prior pilots
// (updateDealStage / updateProjectStatus / updateTicketStatus): those
// three never threw on a 0-row match — `deal?.clientId` /
// `project?.clientId` / `ticket?.clientId` optional-chaining absorbed it
// silently. updateTicket is different: it already has
// `if (!ticket) throw new Error(MESSAGES[locale].ticketNotFound);`
// (pre-existing, unrelated to this mission) — so once the scope
// predicate makes the UPDATE match 0 rows for a denied EMPLOYEE, this
// pre-existing guard throws exactly as it already does for a genuinely
// nonexistent id (same anti-enumeration property, no new behavior
// introduced). The DENY tests below therefore assert a REJECTION, not a
// silent no-op — this is the correct, unchanged pre-existing contract.
//
// Same mocking convention as the prior three pilots: only @/lib/session
// is faked (requireSession/getCurrentSession). The code under test runs
// for real:
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::resolveCrmEmployeeScope() /
//     buildCrmEmployeeScopePredicate() (jamais mockés, fichier non
//     modifié par cette mission)
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER est représenté comme "aucune ligne staff_members" plutôt qu'une
// vraie ligne OWNER — même justification que les trois pilotes
// précédents (contrainte d'unicité OWNER-par-workspace, et
// resolveCrmEmployeeScope() ne distingue de toute façon pas OWNER/ADMIN/
// "pas de ligne Axis-C du tout" : les trois résolvent à `null`).
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-tickets-update-employee-scope.integration.test.mjs
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
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async () => {} } });
// External-effect boundary stubbed (not the axis under test): logCrmAudit
// inserts a row with a real FK to `users.id`; the ALLOW case targets a
// ticket successfully updated by its own assigned employee, and
// logCrmAudit still fires on that path — stub it exactly like the three
// prior pilots stub this same boundary.
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
const { crmClients, tickets, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { updateTicket } = await import("./crm-tickets.ts");

const createdClientIds = new Set();
const createdTicketIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdTicketIds.size) await db.delete(tickets).where(inArray(tickets.id, [...createdTicketIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Ticket Update Scope Test User", status: "active" })
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
    .values({ name: `CRM Ticket Update Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeTicket(clientId, subject) {
  const [ticket] = await db.insert(tickets).values({ clientId, subject, priority: "medium" }).returning();
  createdTicketIds.add(ticket.id);
  return ticket;
}

async function ticketRow(id) {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return row;
}

function makeEditFormData({ subject, description, priority }) {
  const fd = new FormData();
  fd.set("subject", subject);
  if (description !== undefined) fd.set("description", description);
  fd.set("priority", priority ?? "medium");
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
test("1 — OWNER-like (no staff row) -> updateTicket on client A's ticket succeeds", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  actAs(ownerLikeUserId);
  const updated = await updateTicket(ticket.id, makeEditFormData({ subject: "OWNER-like edit", priority: "high" }));
  assert.equal(updated.subject, "OWNER-like edit");
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "OWNER-like edit");
  assert.equal(after.priority, "high");
});

test("2 — ADMIN -> updateTicket on client B's ticket succeeds (not ADMIN's own assignment)", async () => {
  const ticket = await makeTicket(clientB.id, "Original subject");
  actAs(adminUserId);
  const updated = await updateTicket(ticket.id, makeEditFormData({ subject: "ADMIN edit", priority: "low" }));
  assert.equal(updated.subject, "ADMIN edit");
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "ADMIN edit");
  assert.equal(after.priority, "low");
});

test("3 — MANAGER -> updateTicket on client A's ticket succeeds (current global behavior preserved)", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  actAs(managerUserId);
  const updated = await updateTicket(ticket.id, makeEditFormData({ subject: "MANAGER edit", priority: "high" }));
  assert.equal(updated.subject, "MANAGER edit");
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "MANAGER edit");
});

// =====================================================================
// ALLOW — EMPLOYEE acting on their OWN assigned client's ticket — and
// confirming the full business-logic field set (subject, description,
// priority) is actually written exactly as updateTicket has always done
// (no behavioral change beyond the scope check itself).
// =====================================================================
test("4 — EMPLOYEE assigned to client A -> updateTicket on A's ticket succeeds, all fields applied", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  actAs(employeeAUserId);
  const updated = await updateTicket(
    ticket.id,
    makeEditFormData({ subject: "Employee A edit", description: "Updated description", priority: "high" }),
  );
  assert.equal(updated.subject, "Employee A edit");
  assert.equal(updated.description, "Updated description");
  assert.equal(updated.priority, "high");
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "Employee A edit");
  assert.equal(after.description, "Updated description");
  assert.equal(after.priority, "high");
});

test("4b — EMPLOYEE assigned to client A -> omitting description clears it to null (pre-existing business behavior, unchanged)", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  await db.update(tickets).set({ description: "Will be cleared" }).where(eq(tickets.id, ticket.id));
  actAs(employeeAUserId);
  await updateTicket(ticket.id, makeEditFormData({ subject: "Employee A edit 2", priority: "medium" }));
  const after = await ticketRow(ticket.id);
  assert.equal(after.description, null, "omitted description must still clear to null, exactly as before this mission");
});

// =====================================================================
// DENY — EMPLOYEE outside their scope: zero rows changed. Unlike the
// three prior pilots, updateTicket's own pre-existing
// `if (!ticket) throw ...ticketNotFound` guard now fires for the denied
// case too (0 rows matched) — so the correct assertion is a REJECTION,
// verified alongside a direct DB re-read proving zero mutation.
// =====================================================================
test("5 — EMPLOYEE assigned to B -> updateTicket on A's ticket is denied (throws ticketNotFound), A unchanged", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  actAs(employeeBUserId);
  await assert.rejects(
    () => updateTicket(ticket.id, makeEditFormData({ subject: "Forged edit", priority: "high" })),
    /introuvable/i,
  );
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "Original subject", "subject must remain untouched — the UPDATE matched zero rows");
  assert.equal(after.priority, "medium", "priority must remain untouched — the UPDATE matched zero rows");
});

test("6 — EMPLOYEE with no client assignment -> updateTicket on A's ticket is denied (throws ticketNotFound), A unchanged", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  actAs(employeeUnassignedUserId);
  await assert.rejects(
    () => updateTicket(ticket.id, makeEditFormData({ subject: "Forged edit", priority: "high" })),
    /introuvable/i,
  );
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "Original subject", "subject must remain untouched — the UPDATE matched zero rows");
  assert.equal(after.priority, "medium", "priority must remain untouched — the UPDATE matched zero rows");
});

// =====================================================================
// DENY — CLIENT (Axis-A) role: blocked upstream by requireStaffRole(),
// never even reaches the scope predicate
// =====================================================================
test("7 — CLIENT role -> updateTicket refused (redirect /dashboard), ticket untouched", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  actAs(randomUUID(), "client");
  await assert.rejects(() => updateTicket(ticket.id, makeEditFormData({ subject: "Forged edit", priority: "high" })), (err) => {
    const digest = String(err?.digest ?? "");
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    assert.ok(digest.includes("/dashboard"), `expected redirect to /dashboard, got digest: ${digest}`);
    return true;
  });
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "Original subject", "subject must remain untouched");
});

// =====================================================================
// DENY — unauthenticated: blocked upstream, never reaches the scope
// predicate either
// =====================================================================
test("8 — unauthenticated -> updateTicket redirects to /sign-in, ticket untouched", async () => {
  const ticket = await makeTicket(clientA.id, "Original subject");
  actAsAnonymous();
  await assert.rejects(() => updateTicket(ticket.id, makeEditFormData({ subject: "Forged edit", priority: "high" })), (err) => {
    const digest = String(err?.digest ?? "");
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    assert.ok(digest.includes("/sign-in"), `expected redirect to /sign-in, got digest: ${digest}`);
    return true;
  });
  const after = await ticketRow(ticket.id);
  assert.equal(after.subject, "Original subject", "subject must remain untouched");
});
