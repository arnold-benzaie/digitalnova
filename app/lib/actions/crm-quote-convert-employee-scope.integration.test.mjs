// P0-2K-6 — enforcement of the EMPLOYEE CRM scope on
// convertQuoteToInvoice (lib/actions/crm-quotes.ts). Nothing previously
// verified that the quote's client belonged to the caller's own
// assigned scope at any point in the transaction — an EMPLOYEE could
// convert an ACCEPTED quote belonging to another client into a real,
// numbered invoice.
//
// The fix resolves the caller's scope once (outside the transaction —
// the caller's own identity/assignment is independent of this quote's
// row lock), then checks it INSIDE the transaction, immediately after
// the SELECT ... FOR UPDATE lock + "not found" guard, reading the
// client's assignedUserId via the SAME `tx` handle the rest of the
// transaction uses (never the outer `db`) — so the decision is made
// from the just-locked row, never from data read before the lock. A
// denied EMPLOYEE's throw inside the transaction callback rolls back
// the whole transaction: no invoice, no invoice items, no status
// mutation, exactly as if nothing had run.
//
// This mission touches ONLY convertQuoteToInvoice; createQuote
// (0870c85), deleteQuote (7ccc7c7), updateQuote (b494150),
// updateQuoteStatus/deliverQuoteEmail (4a52cf7), and
// createOrGetQuoteAccessLink (deefb14) are untouched and not exercised
// here. The pre-existing idempotency/concurrency test
// (crm-quote-convert.integration.test.mjs) is a separate file, not
// modified by this mission.
//
// Same mocking convention as every other P0-2 pilot: only @/lib/session
// is faked (requireSession/getCurrentSession). The code under test runs
// for real:
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::resolveCrmEmployeeScope() /
//     isCrmClientVisibleToScope() (jamais mockés, fichier non modifié
//     par cette mission)
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
//        lib/actions/crm-quote-convert-employee-scope.integration.test.mjs
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
const { crmClients, crmQuotes, crmQuoteItems, crmInvoices, crmInvoiceItems, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { convertQuoteToInvoice } = await import("./crm-quotes.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdQuoteIds.size) {
    const invoices = await db.select().from(crmInvoices).where(inArray(crmInvoices.quoteId, [...createdQuoteIds]));
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, invoiceIds));
    if (invoiceIds.length) await db.delete(crmInvoices).where(inArray(crmInvoices.id, invoiceIds));
    await db.delete(crmQuoteItems).where(inArray(crmQuoteItems.quoteId, [...createdQuoteIds]));
    await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  }
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Quote Convert Scope Test User", status: "active" })
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
    .values({ name: `CRM Quote Convert Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeAcceptedQuote(clientId, title) {
  const [quote] = await db
    .insert(crmQuotes)
    .values({
      clientId,
      quoteNumber: `P0-2K6-${randomUUID().slice(0, 8)}`,
      title,
      currency: "EUR",
      status: "accepted",
      subtotalCents: 1000,
      taxCents: 0,
      totalCents: 1000,
    })
    .returning();
  createdQuoteIds.add(quote.id);
  await db.insert(crmQuoteItems).values({ quoteId: quote.id, description: "Line item", quantity: 1, unitPriceCents: 1000, position: 0 });
  return quote;
}

async function quoteRow(id) {
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  return row;
}

async function invoicesForQuote(quoteId) {
  return db.select().from(crmInvoices).where(eq(crmInvoices.quoteId, quoteId));
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
// 1 — ALLOW: EMPLOYEE converting their OWN assigned client's accepted
// quote
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> convertQuoteToInvoice on A's accepted quote succeeds", async () => {
  const quote = await makeAcceptedQuote(clientA.id, "Employee A convert");
  actAs(employeeAUserId);
  const invoice = await convertQuoteToInvoice(quote.id);
  assert.equal(invoice.clientId, clientA.id);
  assert.equal(invoice.quoteId, quote.id);
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "converted");
  const invoices = await invoicesForQuote(quote.id);
  assert.equal(invoices.length, 1, "exactly one invoice must have been created");
});

// =====================================================================
// 2 / 4 — DENY: EMPLOYEE assigned to a DIFFERENT client — no invoice
// created, quote's status/conversion state untouched.
// =====================================================================
test("2 — EMPLOYEE assigned to B -> convertQuoteToInvoice on A's accepted quote is denied (throws quoteNotFound), no invoice created, A still accepted", async () => {
  const quote = await makeAcceptedQuote(clientA.id, "Employee B deny on A");
  actAs(employeeBUserId);
  await assert.rejects(() => convertQuoteToInvoice(quote.id), /introuvable/i);
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "accepted", "status must remain 'accepted' — never flipped to 'converted'");
  const invoices = await invoicesForQuote(quote.id);
  assert.equal(invoices.length, 0, "no invoice must have been created for an out-of-scope quote");
});

// =====================================================================
// 3 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("3a — OWNER-like (no staff row) -> convertQuoteToInvoice on client B's accepted quote succeeds (not OWNER's own assignment)", async () => {
  const quote = await makeAcceptedQuote(clientB.id, "OWNER-like convert");
  actAs(ownerLikeUserId);
  const invoice = await convertQuoteToInvoice(quote.id);
  assert.equal(invoice.clientId, clientB.id);
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "converted");
});

test("3b — ADMIN -> convertQuoteToInvoice on client A's accepted quote succeeds (not ADMIN's own assignment)", async () => {
  const quote = await makeAcceptedQuote(clientA.id, "ADMIN convert");
  actAs(adminUserId);
  const invoice = await convertQuoteToInvoice(quote.id);
  assert.equal(invoice.clientId, clientA.id);
});

test("3c — MANAGER -> convertQuoteToInvoice on client B's accepted quote succeeds (current global behavior preserved)", async () => {
  const quote = await makeAcceptedQuote(clientB.id, "MANAGER convert");
  actAs(managerUserId);
  const invoice = await convertQuoteToInvoice(quote.id);
  assert.equal(invoice.clientId, clientB.id);
});

// =====================================================================
// 5 — the scope check intercepts BEFORE the business-logic branches
// (idempotent "already converted" / "only accepted can convert"), i.e.
// it runs right after the lock+existence check, not after those later
// decisions — demonstrated by: a denied EMPLOYEE on an ELIGIBLE
// ("accepted") quote is still denied with quoteNotFound (not some
// business-rule error), and the quote is provably never flipped to
// "converted" even though it was fully eligible for a legitimate actor.
// =====================================================================
test("5 — denial on an eligible ('accepted') quote still throws quoteNotFound, never a business-rule error, proving the scope check runs before the status branches", async () => {
  const quote = await makeAcceptedQuote(clientA.id, "Eligible but out of scope");
  actAs(employeeBUserId);
  await assert.rejects(() => convertQuoteToInvoice(quote.id), (err) => {
    assert.match(err.message, /introuvable/i, "must be the quoteNotFound message, not onlyAcceptedCanConvert or any other business-rule message");
    return true;
  });
});
