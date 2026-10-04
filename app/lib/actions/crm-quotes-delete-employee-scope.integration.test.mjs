// P0-2K-2 — enforcement of the EMPLOYEE CRM scope on deleteQuote
// (lib/actions/crm-quotes.ts). P0-1 had already added
// `await requireStaffRole();` (authentication — "is this an
// authenticated staff member") but authentication is not the same thing
// as CRM scope ("does this staff member's EMPLOYEE assignment cover the
// targeted client"). deleteQuote already had a pre-existing SELECT for
// its "not found" / "draft-only" business checks, but the DELETE itself
// was completely unscoped AND never checked whether it actually matched
// a row — buildCrmEmployeeScopePredicate() is now AND-ed into the
// DELETE's own WHERE clause (atomic, single statement, no TOCTOU
// window), with `.returning()` + `if (!deleted) throw quoteNotFound`
// covering both "id doesn't exist" and "denied EMPLOYEE" identically
// (no existence disclosure). This mission touches ONLY deleteQuote;
// createQuote (already scoped in 0870c85), updateQuote,
// updateQuoteStatus, deliverQuoteEmail, convertQuoteToInvoice and the
// quote access links are explicitly out of scope and untested here.
//
// Same mocking convention as every other P0-2 pilot: only @/lib/session
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
// vraie ligne OWNER — resolveCrmEmployeeScope() ne distingue de toute
// façon pas OWNER/ADMIN/"pas de ligne Axis-C du tout" : les trois
// résolvent à `null`.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-quotes-delete-employee-scope.integration.test.mjs
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
// inserts a row with a real FK to `users.id` — the deny-case tests target
// quotes belonging to clients the acting fixture user is not assigned
// to, so this mirrors every prior pilot's own stubbing of this exact
// boundary.
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
      role, // never "client" except for a CLIENT-denied scenario — the
      // REAL Axis-C role (or absence of one) is independently re-derived
      // by resolveCrmEmployeeScope() from staff_members below, never
      // from this field.
      previousLastLoginAt: null,
    },
  };
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
const { crmClients, crmQuotes, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { deleteQuote } = await import("./crm-quotes.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Quote Delete Scope Test User", status: "active" })
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
    .values({ name: `CRM Quote Delete Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDraftQuote(clientId, title) {
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId, quoteNumber: `P0-2K2-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdQuoteIds.add(quote.id);
  return quote;
}

async function quoteRow(id) {
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  return row;
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
const clientUnassigned = await makeClient(null);

beforeEach(() => {
  actAs(adminUserId);
});

// =====================================================================
// ALLOW — EMPLOYEE acting on their OWN assigned client's quote
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> deleteQuote on A's draft quote succeeds", async () => {
  const quote = await makeDraftQuote(clientA.id, "Employee A delete");
  actAs(employeeAUserId);
  await deleteQuote(quote.id);
  const after = await quoteRow(quote.id);
  assert.equal(after, undefined, "quote must be actually deleted");
});

// =====================================================================
// DENY — EMPLOYEE assigned to a DIFFERENT client, or to none at all:
// deleteQuote already had `if (!deleted) throw`, so a denied EMPLOYEE
// (0 rows matched) throws quoteNotFound exactly like a genuinely
// nonexistent id.
// =====================================================================
test("2 — EMPLOYEE assigned to B -> deleteQuote on A's draft quote is denied (throws quoteNotFound), A still exists", async () => {
  const quote = await makeDraftQuote(clientA.id, "Employee B deny on A");
  actAs(employeeBUserId);
  await assert.rejects(() => deleteQuote(quote.id), /introuvable/i);
  const after = await quoteRow(quote.id);
  assert.ok(after, "quote must still exist — the DELETE matched zero rows");
  assert.equal(after.title, "Employee B deny on A");
  assert.equal(after.clientId, clientA.id);
});

test("3 — EMPLOYEE assigned to A -> deleteQuote on an unassigned client's draft quote is denied (throws quoteNotFound), quote still exists", async () => {
  const quote = await makeDraftQuote(clientUnassigned.id, "Deny unassigned client");
  actAs(employeeAUserId);
  await assert.rejects(() => deleteQuote(quote.id), /introuvable/i);
  const after = await quoteRow(quote.id);
  assert.ok(after, "quote must still exist — the DELETE matched zero rows");
  assert.equal(after.clientId, clientUnassigned.id);
});

test("3b — EMPLOYEE with no client assignment at all -> deleteQuote on A's draft quote is denied (throws quoteNotFound), A still exists", async () => {
  const quote = await makeDraftQuote(clientA.id, "Unassigned employee deny on A");
  actAs(employeeUnassignedUserId);
  await assert.rejects(() => deleteQuote(quote.id), /introuvable/i);
  const after = await quoteRow(quote.id);
  assert.ok(after, "quote must still exist — the DELETE matched zero rows");
});

// =====================================================================
// ALLOW — OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("4 — OWNER-like (no staff row) -> deleteQuote on client A's draft quote succeeds", async () => {
  const quote = await makeDraftQuote(clientA.id, "OWNER-like delete");
  actAs(ownerLikeUserId);
  await deleteQuote(quote.id);
  const after = await quoteRow(quote.id);
  assert.equal(after, undefined, "quote must be actually deleted");
});

test("5 — ADMIN -> deleteQuote on client B's draft quote succeeds (not ADMIN's own assignment)", async () => {
  const quote = await makeDraftQuote(clientB.id, "ADMIN delete");
  actAs(adminUserId);
  await deleteQuote(quote.id);
  const after = await quoteRow(quote.id);
  assert.equal(after, undefined, "quote must be actually deleted");
});

test("6 — MANAGER -> deleteQuote on client A's draft quote succeeds (current global behavior preserved)", async () => {
  const quote = await makeDraftQuote(clientA.id, "MANAGER delete");
  actAs(managerUserId);
  await deleteQuote(quote.id);
  const after = await quoteRow(quote.id);
  assert.equal(after, undefined, "quote must be actually deleted");
});
