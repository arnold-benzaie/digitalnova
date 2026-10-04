// R9-D — enforcement of the EMPLOYEE CRM scope on updateInvoice
// (lib/actions/crm-invoices.ts), mirroring updateQuote's own K3 fix
// exactly. updateInvoice had NO guard at all on the UPDATE's result
// (unlike updateQuote before K3, which at least had a guard missing —
// updateInvoice was missing it too) — meaning the subsequent
// crmInvoiceItems delete+reinsert ran completely unconditionally, even
// for a denied/nonexistent target. buildCrmEmployeeScopePredicate() is
// now AND-ed into the UPDATE's own WHERE clause (atomic, single
// statement, no TOCTOU window), with `if (!invoice) throw
// invoiceNotFound` added BEFORE the crmInvoiceItems delete/reinsert
// block, so a denied EMPLOYEE's forged request never touches another
// client's invoice or its line items.
//
// crmInvoices.clientId is NULLABLE (unlike crmQuotes.clientId) — the
// "Autre client…" unsaved-manual-entry case. buildCrmEmployeeScopePredicate()'s
// correlated EXISTS can never match crmClients.id against NULL, so an
// EMPLOYEE is automatically denied on a NULL-clientId invoice with no
// special-casing anywhere; OWNER/ADMIN/MANAGER (scope === null) are
// completely unaffected regardless of clientId.
//
// This mission touches ONLY updateInvoice; createInvoice (cddec98),
// deleteInvoice (715ff6f), updateInvoiceStatus/deliverInvoiceEmail,
// resendInvoice and the invoice access link / PDF route are explicitly
// out of scope and untested here (tracked as separate R9 follow-up
// missions per the R9-A domain audit).
//
// Same mocking convention as every other P0-2K/R9 pilot: only
// @/lib/session is faked (requireSession/getCurrentSession). The code
// under test runs for real:
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
//        lib/actions/crm-invoices-update-employee-scope.integration.test.mjs
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
// assigned to, so this mirrors every prior pilot's own stubbing of this
// exact boundary.
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
const { crmClients, crmInvoices, crmInvoiceItems, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { updateInvoice } = await import("./crm-invoices.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Invoice Update Scope Test User", status: "active" })
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
    .values({ name: `CRM Invoice Update Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDraftInvoiceWithItem(clientId, title) {
  const [invoice] = await db
    .insert(crmInvoices)
    .values({ clientId, invoiceNumber: `R9D-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdInvoiceIds.add(invoice.id);
  const [item] = await db
    .insert(crmInvoiceItems)
    .values({ invoiceId: invoice.id, description: "Original line item", quantity: 1, unitPriceCents: 1000, position: 0 })
    .returning();
  return { invoice, item };
}

async function invoiceRow(id) {
  const [row] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  return row;
}

async function itemsForInvoice(invoiceId) {
  return db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, invoiceId));
}

function makeUpdateFormData({ title, items }) {
  const fd = new FormData();
  fd.set("title", title);
  fd.set("currency", "EUR");
  fd.set("items", JSON.stringify(items ?? [{ description: "Forged line item", quantity: 1, unitPriceCents: 9999 }]));
  return fd;
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
// 1 — ALLOW: EMPLOYEE updating their OWN assigned client's invoice
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> updateInvoice on A's draft invoice succeeds, title and items applied", async () => {
  const { invoice } = await makeDraftInvoiceWithItem(clientA.id, "Original title");
  actAs(employeeAUserId);
  const updated = await updateInvoice(
    invoice.id,
    makeUpdateFormData({ title: "Employee A edit", items: [{ description: "Updated line item", quantity: 2, unitPriceCents: 500 }] }),
  );
  assert.equal(updated.title, "Employee A edit");
  const after = await invoiceRow(invoice.id);
  assert.equal(after.title, "Employee A edit");
  const items = await itemsForInvoice(invoice.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].description, "Updated line item");
});

// =====================================================================
// 2 / 3 / 4 — DENY: EMPLOYEE assigned to a DIFFERENT client — the
// invoice, its title, AND its line items must all remain completely
// untouched.
// =====================================================================
test("2/3/4 — EMPLOYEE assigned to B -> updateInvoice on A's draft invoice is denied (throws invoiceNotFound); invoice AND its items unchanged", async () => {
  const { invoice, item } = await makeDraftInvoiceWithItem(clientA.id, "Original title");
  actAs(employeeBUserId);
  await assert.rejects(
    () => updateInvoice(invoice.id, makeUpdateFormData({ title: "Forged edit", items: [{ description: "Forged line item", quantity: 1, unitPriceCents: 9999 }] })),
    /introuvable/i,
  );
  // 3 — invoice itself unchanged
  const after = await invoiceRow(invoice.id);
  assert.equal(after.title, "Original title", "title must remain untouched — the UPDATE matched zero rows");
  assert.equal(after.clientId, clientA.id);
  // 4 — crmInvoiceItems unchanged (the delete+reinsert must never run)
  const items = await itemsForInvoice(invoice.id);
  assert.equal(items.length, 1, "the original line item must not have been deleted");
  assert.equal(items[0].id, item.id, "the SAME original item row must still exist, never deleted/reinserted");
  assert.equal(items[0].description, "Original line item", "the original item's content must be untouched");
});

// =====================================================================
// 5 — DENY: EMPLOYEE on a NULL-clientId invoice ("Autre client…" case)
// — denied automatically by buildCrmEmployeeScopePredicate()'s own
// correlated EXISTS, no special-casing anywhere. Items must also stay
// untouched.
// =====================================================================
test("5 — EMPLOYEE on a NULL-clientId draft invoice is denied (throws invoiceNotFound), invoice and items unchanged", async () => {
  const { invoice, item } = await makeDraftInvoiceWithItem(null, "Autre client invoice, no CRM client");
  actAs(employeeAUserId);
  await assert.rejects(
    () => updateInvoice(invoice.id, makeUpdateFormData({ title: "Forged edit on NULL client" })),
    /introuvable/i,
  );
  const after = await invoiceRow(invoice.id);
  assert.equal(after.title, "Autre client invoice, no CRM client", "title must remain untouched");
  assert.equal(after.clientId, null);
  const items = await itemsForInvoice(invoice.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, item.id);
});

// =====================================================================
// 6 / 7 / 8 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted
// behavior, including on a real client's invoice not assigned to them.
// =====================================================================
test("6 — OWNER-like (no staff row) -> updateInvoice on client B's draft invoice succeeds (not OWNER's own assignment)", async () => {
  const { invoice } = await makeDraftInvoiceWithItem(clientB.id, "Original title");
  actAs(ownerLikeUserId);
  const updated = await updateInvoice(invoice.id, makeUpdateFormData({ title: "OWNER-like edit" }));
  assert.equal(updated.title, "OWNER-like edit");
});

test("7 — ADMIN -> updateInvoice on client A's draft invoice succeeds (not ADMIN's own assignment)", async () => {
  const { invoice } = await makeDraftInvoiceWithItem(clientA.id, "Original title");
  actAs(adminUserId);
  const updated = await updateInvoice(invoice.id, makeUpdateFormData({ title: "ADMIN edit" }));
  assert.equal(updated.title, "ADMIN edit");
});

test("8 — MANAGER -> updateInvoice on client B's draft invoice succeeds (current global behavior preserved)", async () => {
  const { invoice } = await makeDraftInvoiceWithItem(clientB.id, "Original title");
  actAs(managerUserId);
  const updated = await updateInvoice(invoice.id, makeUpdateFormData({ title: "MANAGER edit" }));
  assert.equal(updated.title, "MANAGER edit");
});

// =====================================================================
// 9 — ALLOW: OWNER/ADMIN/MANAGER + clientId = NULL — existing global
// behavior on the "Autre client…" manual-entry case is fully preserved.
// =====================================================================
test("9 — OWNER/ADMIN/MANAGER -> updateInvoice on a NULL-clientId draft invoice succeeds for each role", async () => {
  for (const [label, userId] of [
    ["OWNER-like", ownerLikeUserId],
    ["ADMIN", adminUserId],
    ["MANAGER", managerUserId],
  ]) {
    const { invoice } = await makeDraftInvoiceWithItem(null, `Autre client invoice for ${label}`);
    actAs(userId);
    const updated = await updateInvoice(invoice.id, makeUpdateFormData({ title: `${label} edit on NULL client` }));
    assert.equal(updated.title, `${label} edit on NULL client`, `${label} must retain unrestricted access to NULL-clientId invoices`);
    assert.equal(updated.clientId, null);
  }
});
