// P0-2K-3 — enforcement of the EMPLOYEE CRM scope on updateQuote
// (lib/actions/crm-quotes.ts). updateQuote already had a pre-existing
// SELECT for its "not found" / "draft-only" business checks, but the
// UPDATE itself was completely unscoped AND had no guard on its result —
// meaning the subsequent quote_items delete+reinsert ran unconditionally,
// even for a denied/nonexistent target. buildCrmEmployeeScopePredicate()
// is now AND-ed into the UPDATE's own WHERE clause (atomic, no TOCTOU
// window), with `if (!quote) throw quoteNotFound` added BEFORE the
// quote_items delete/reinsert block, so a denied EMPLOYEE's forged
// request never touches another client's line items. This mission
// touches ONLY updateQuote; createQuote (0870c85), deleteQuote
// (7ccc7c7), updateQuoteStatus, deliverQuoteEmail, convertQuoteToInvoice
// and the quote access links are explicitly out of scope and untested
// here.
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
//        lib/actions/crm-quotes-update-employee-scope.integration.test.mjs
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
// target quotes belonging to clients the acting fixture user is not
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
const { crmClients, crmQuotes, crmQuoteItems, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { updateQuote } = await import("./crm-quotes.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdQuoteIds.size) await db.delete(crmQuoteItems).where(inArray(crmQuoteItems.quoteId, [...createdQuoteIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Quote Update Scope Test User", status: "active" })
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
    .values({ name: `CRM Quote Update Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDraftQuoteWithItem(clientId, title) {
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId, quoteNumber: `P0-2K3-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdQuoteIds.add(quote.id);
  const [item] = await db
    .insert(crmQuoteItems)
    .values({ quoteId: quote.id, description: "Original line item", quantity: 1, unitPriceCents: 1000, position: 0 })
    .returning();
  return { quote, item };
}

async function quoteRow(id) {
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  return row;
}

async function itemsForQuote(quoteId) {
  return db.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quoteId));
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
// 1 — ALLOW: EMPLOYEE updating their OWN assigned client's quote
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> updateQuote on A's draft quote succeeds, title and items applied", async () => {
  const { quote } = await makeDraftQuoteWithItem(clientA.id, "Original title");
  actAs(employeeAUserId);
  const updated = await updateQuote(quote.id, makeUpdateFormData({ title: "Employee A edit", items: [{ description: "Updated line item", quantity: 2, unitPriceCents: 500 }] }));
  assert.equal(updated.title, "Employee A edit");
  const after = await quoteRow(quote.id);
  assert.equal(after.title, "Employee A edit");
  const items = await itemsForQuote(quote.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].description, "Updated line item");
});

// =====================================================================
// 2 — DENY: EMPLOYEE assigned to a DIFFERENT client — the quote, its
// title, AND its line items must all remain completely untouched.
// =====================================================================
test("2 — EMPLOYEE assigned to B -> updateQuote on A's draft quote is denied (throws quoteNotFound), A and its items unchanged", async () => {
  const { quote, item } = await makeDraftQuoteWithItem(clientA.id, "Original title");
  actAs(employeeBUserId);
  await assert.rejects(
    () => updateQuote(quote.id, makeUpdateFormData({ title: "Forged edit", items: [{ description: "Forged line item", quantity: 1, unitPriceCents: 9999 }] })),
    /introuvable/i,
  );
  const after = await quoteRow(quote.id);
  assert.equal(after.title, "Original title", "title must remain untouched — the UPDATE matched zero rows");
  const items = await itemsForQuote(quote.id);
  assert.equal(items.length, 1, "the original line item must not have been deleted");
  assert.equal(items[0].id, item.id, "the SAME original item row must still exist, never deleted/reinserted");
  assert.equal(items[0].description, "Original line item", "the original item's content must be untouched");
});

// =====================================================================
// 3 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("3a — OWNER-like (no staff row) -> updateQuote on client B's draft quote succeeds (not OWNER's own assignment)", async () => {
  const { quote } = await makeDraftQuoteWithItem(clientB.id, "Original title");
  actAs(ownerLikeUserId);
  const updated = await updateQuote(quote.id, makeUpdateFormData({ title: "OWNER-like edit" }));
  assert.equal(updated.title, "OWNER-like edit");
});

test("3b — ADMIN -> updateQuote on client A's draft quote succeeds (not ADMIN's own assignment)", async () => {
  const { quote } = await makeDraftQuoteWithItem(clientA.id, "Original title");
  actAs(adminUserId);
  const updated = await updateQuote(quote.id, makeUpdateFormData({ title: "ADMIN edit" }));
  assert.equal(updated.title, "ADMIN edit");
});

test("3c — MANAGER -> updateQuote on client B's draft quote succeeds (current global behavior preserved)", async () => {
  const { quote } = await makeDraftQuoteWithItem(clientB.id, "Original title");
  actAs(managerUserId);
  const updated = await updateQuote(quote.id, makeUpdateFormData({ title: "MANAGER edit" }));
  assert.equal(updated.title, "MANAGER edit");
});
