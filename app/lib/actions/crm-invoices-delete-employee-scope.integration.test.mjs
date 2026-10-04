// R9-B — enforcement of the EMPLOYEE CRM scope on deleteInvoice
// (lib/actions/crm-invoices.ts). deleteInvoice already had a
// pre-existing SELECT for its "not found" / "draft-only" business
// checks, and ALREADY had `.returning()` + `if (!deleted) throw` (unlike
// deleteQuote before P0-2K-2) — but the DELETE itself was completely
// unscoped. buildCrmEmployeeScopePredicate() is now AND-ed into the
// DELETE's own WHERE clause (atomic, single statement, no TOCTOU
// window), reusing the exact same primitive already validated across
// the whole P0-2K Quotes series — no new helper created, lib/crm-
// client-access.ts untouched.
//
// crmInvoices.clientId is NULLABLE (unlike crmQuotes.clientId) — the
// "Autre client…" unsaved-manual-entry case. buildCrmEmployeeScopePredicate()'s
// correlated EXISTS can never match crmClients.id against NULL, so an
// EMPLOYEE is automatically denied on a NULL-clientId invoice with no
// special-casing anywhere; OWNER/ADMIN/MANAGER (scope === null) are
// completely unaffected regardless of clientId.
//
// This mission touches ONLY deleteInvoice; createInvoice, updateInvoice,
// updateInvoiceStatus/deliverInvoiceEmail, resendInvoice, and the
// invoice access link / PDF route are untouched and not exercised here
// (tracked as separate R9 follow-up missions per the R9-A domain audit).
//
// Same mocking convention as every P0-2K pilot: only @/lib/session is
// faked (requireSession/getCurrentSession). The code under test runs
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
//        lib/actions/crm-invoices-delete-employee-scope.integration.test.mjs
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
// inserts a row with a real FK to `users.id` — the deny-case tests
// target invoices belonging to clients the acting fixture user is not
// assigned to, so this mirrors every prior P0-2K pilot's own stubbing
// of this exact boundary.
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
      role, // never "client" — the REAL Axis-C role (or absence of one)
      // is independently re-derived by resolveCrmEmployeeScope() from
      // staff_members below, never from this field.
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
const { crmClients, crmInvoices, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { deleteInvoice } = await import("./crm-invoices.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Invoice Delete Scope Test User", status: "active" })
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
    .values({ name: `CRM Invoice Delete Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDraftInvoice(clientId, title) {
  const [invoice] = await db
    .insert(crmInvoices)
    .values({ clientId, invoiceNumber: `R9B-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdInvoiceIds.add(invoice.id);
  return invoice;
}

async function invoiceRow(id) {
  const [row] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  return row;
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // no staff_members row at all — see file header

const clientA = await makeClient(employeeAUserId);
const clientB = await makeClient(employeeBUserId);

beforeEach(() => {
  actAs(adminUserId);
});

// =====================================================================
// 1 — ALLOW: EMPLOYEE acting on their OWN assigned client's invoice
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> deleteInvoice on A's draft invoice succeeds", async () => {
  const invoice = await makeDraftInvoice(clientA.id, "Employee A delete");
  actAs(employeeAUserId);
  await deleteInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after, undefined, "invoice must be actually deleted");
});

// =====================================================================
// 2 / 3 — DENY: EMPLOYEE assigned to a DIFFERENT client — invoice must
// still exist after the refusal.
// =====================================================================
test("2 / 3 — EMPLOYEE assigned to B -> deleteInvoice on A's draft invoice is denied (throws invoiceNotFound), A still exists", async () => {
  const invoice = await makeDraftInvoice(clientA.id, "Employee B deny on A");
  actAs(employeeBUserId);
  await assert.rejects(() => deleteInvoice(invoice.id), /introuvable/i);
  const after = await invoiceRow(invoice.id);
  assert.ok(after, "invoice must still exist — the DELETE matched zero rows");
  assert.equal(after.title, "Employee B deny on A");
  assert.equal(after.clientId, clientA.id);
});

// =====================================================================
// 4 — DENY: EMPLOYEE on a NULL-clientId invoice ("Autre client…" case)
// — denied automatically by buildCrmEmployeeScopePredicate()'s own
// correlated EXISTS, no special-casing anywhere.
// =====================================================================
test("4 — EMPLOYEE on a NULL-clientId draft invoice is denied (throws invoiceNotFound), invoice still exists", async () => {
  const invoice = await makeDraftInvoice(null, "Autre client invoice, no CRM client");
  actAs(employeeAUserId);
  await assert.rejects(() => deleteInvoice(invoice.id), /introuvable/i);
  const after = await invoiceRow(invoice.id);
  assert.ok(after, "invoice must still exist — the DELETE matched zero rows");
  assert.equal(after.clientId, null);
});

// =====================================================================
// 5-7 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior,
// including on a NULL-clientId invoice.
// =====================================================================
test("5 — OWNER-like (no staff row) -> deleteInvoice on a NULL-clientId draft invoice succeeds", async () => {
  const invoice = await makeDraftInvoice(null, "OWNER-like delete, no CRM client");
  actAs(ownerLikeUserId);
  await deleteInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after, undefined, "invoice must be actually deleted");
});

test("6 — ADMIN -> deleteInvoice on client B's draft invoice succeeds (not ADMIN's own assignment)", async () => {
  const invoice = await makeDraftInvoice(clientB.id, "ADMIN delete");
  actAs(adminUserId);
  await deleteInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after, undefined, "invoice must be actually deleted");
});

test("7 — MANAGER -> deleteInvoice on client A's draft invoice succeeds (current global behavior preserved)", async () => {
  const invoice = await makeDraftInvoice(clientA.id, "MANAGER delete");
  actAs(managerUserId);
  await deleteInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after, undefined, "invoice must be actually deleted");
});
