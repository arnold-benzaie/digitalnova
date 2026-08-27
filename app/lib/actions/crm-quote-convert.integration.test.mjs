// Integration tests for Chantier 1 / Phase 5's security fix: convertQuoteToInvoice
// (lib/actions/crm-quotes.ts) now re-verifies the caller itself
// (requireStaffRole()) instead of relying solely on page-level protection —
// same pattern, same reasoning, already applied to updateQuoteStatus in
// Phase 3. Same mocking convention as crm-quotes-send.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session state
// (actAsStaff()/actAsClient()), so the REAL requireStaffRole()
// (lib/dev-role.ts, never mocked) runs against it — this is what lets the
// non-staff test below prove a genuine runtime rejection, not a textual
// check.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-quote-convert.integration.test.mjs
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

const STAFF_SESSION = {
  userId: "test-staff-user",
  clerkUserId: "test_clerk_staff",
  email: "staff@example.com",
  fullName: "Test Staff",
  firstName: "Test",
  organizationId: "test-org",
  organizationName: "Test Org",
  role: "staff",
  previousLastLoginAt: null,
};
const CLIENT_SESSION = {
  userId: "test-client-user",
  clerkUserId: "test_clerk_client",
  email: "client-role@example.com",
  fullName: "Test Client",
  firstName: "Test",
  organizationId: "test-org",
  organizationName: "Test Org",
  role: "client",
  previousLastLoginAt: null,
};

/** @type {{ session: object }} */
let mockState = { session: STAFF_SESSION };
function actAsStaff() {
  mockState = { session: STAFF_SESSION };
}
function actAsClient() {
  mockState = { session: CLIENT_SESSION };
}

// requireSession() is faked, but requireStaffRole() (lib/dev-role.ts) is
// the REAL, unmocked implementation — it calls this faked requireSession(),
// reads .role, and redirect()s when the role is "client". That real
// redirect() is what the non-staff test below observes as a rejection.
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => mockState.session,
    getCurrentSession: async () => null,
  },
});

const { db } = await import("@/db");
const { crmClients, crmInvoiceItems, crmInvoices, crmQuotes } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createQuote, convertQuoteToInvoice } = await import("./crm-quotes.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();
const createdInvoiceIds = new Set();

beforeEach(actAsStaff);

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeAcceptedQuote() {
  const [client] = await db.insert(crmClients).values({ name: `P5 Test Client ${randomUUID()}` }).returning();
  createdClientIds.add(client.id);

  const fd = new FormData();
  fd.set("clientId", client.id);
  fd.set("title", "Devis test Chantier 1 Phase 5");
  fd.set("currency", "EUR");
  fd.set("items", JSON.stringify([{ description: "Ligne test", quantity: 1, unitPriceCents: 30000 }]));
  const quote = await createQuote(fd);
  createdQuoteIds.add(quote.id);

  const [accepted] = await db.update(crmQuotes).set({ status: "accepted", respondedAt: new Date() }).where(eq(crmQuotes.id, quote.id)).returning();
  return accepted;
}

async function invoicesForQuote(quoteId) {
  return db.select().from(crmInvoices).where(eq(crmInvoices.quoteId, quoteId));
}

// ---- non-staff: direct call rejected, zero side effect ----
test("a client-role session cannot call convertQuoteToInvoice directly: requireStaffRole rejects it before any side effect", async () => {
  const quote = await makeAcceptedQuote();

  actAsClient();
  try {
    await assert.rejects(() => convertQuoteToInvoice(quote.id));
  } finally {
    actAsStaff();
  }

  const invoices = await invoicesForQuote(quote.id);
  assert.equal(invoices.length, 0, "no invoice must be created for an unauthorized caller");

  const after_ = await db.select().from(crmQuotes).where(eq(crmQuotes.id, quote.id));
  assert.equal(after_[0].status, "accepted", "the quote itself must be left untouched");
});

// ---- staff: normal conversion still works end to end ----
test("an authorized staff session can still convert an accepted quote to an invoice", async () => {
  actAsStaff();
  const quote = await makeAcceptedQuote();

  const invoice = await convertQuoteToInvoice(quote.id);
  createdInvoiceIds.add(invoice.id);

  assert.equal(invoice.quoteId, quote.id);
  assert.equal(invoice.title, quote.title);
  assert.equal(invoice.totalCents, quote.totalCents);
  assert.equal(invoice.currency, quote.currency);

  const items = await db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, invoice.id));
  assert.equal(items.length, 1);
  assert.equal(items[0].description, "Ligne test");
  assert.equal(items[0].unitPriceCents, 30000);
});
