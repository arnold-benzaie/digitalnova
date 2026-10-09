// P0-1 — authorization fix for lib/actions/crm-quotes.ts.
// createQuote(formData), updateQuote(id, formData) and deleteQuote(id) now
// each call requireStaffRole() as their first executable statement —
// previously NONE of the three had any authentication/authorization check
// at all, unlike their sibling updateQuoteStatus/convertQuoteToInvoice
// (already fixed in an earlier "Chantier 1" pass). Any Clerk account
// (including a "pending" one with no membership, or a CLIENT-role one)
// could POST any of these three actions directly and forge/delete any
// client's quote, since Server Actions are their own directly-POSTable
// entry points independent of which page's UI happened to call them (see
// node_modules/next/dist/docs/01-app/02-guides/data-security.md).
//
// Session model mirrors lib/actions/billing-auth.integration.test.mjs and
// crm-documents-auth.integration.test.mjs: only the identity source
// @/lib/session is faked. The authorization code under test runs for
// real: REAL lib/dev-role.ts::requireStaffRole().
// Local disposable Docker Postgres only (127.0.0.1:5434 /
// public_map_approval_test).
//
// Run: npx tsx --test --test-concurrency=1 --experimental-test-module-mocks \
//        lib/actions/crm-quotes-auth.integration.test.mjs
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas a la base locale jetable. Arret avant tout import applicatif.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });
// External-effect boundary stubbed (not the axis under test): logCrmAudit
// resolves the real actorUserId via getCurrentSession() and inserts a row
// with a foreign key to a real `users` row — the fabricated session ids
// above are not real seeded users, so this mirrors billing-auth.
// integration.test.mjs's own stubbing of logAudit for the same reason.
mock.module("@/lib/audit", { namedExports: { logCrmAudit: async () => {} } });

// ---- fabricated identity source (the ONLY thing faked) --------------------
const STAFF_SESSION = {
  userId: "p0-1-quote-staff", clerkUserId: "p0_1_quote_clerk_staff", email: "staff@example.test",
  fullName: "Test Staff", firstName: "Test", organizationId: randomUUID(), organizationName: "Test Org",
  role: "staff", previousLastLoginAt: null,
};
const CLIENT_SESSION = { ...STAFF_SESSION, userId: "p0-1-quote-client", email: "client-role@example.test", role: "client" };

let mockState = { kind: "staff" };
const actAsStaff = () => { mockState = { kind: "staff" }; };
const actAsClient = () => { mockState = { kind: "client" }; };
const actAsPending = () => { mockState = { kind: "pending" }; };
const actAsAnonymous = () => { mockState = { kind: "anonymous" }; };

mock.module("@/lib/session", {
  namedExports: {
    // Mirrors the real requireSession()'s observable contract for each
    // state (lib/session.ts:261-276).
    requireSession: async () => {
      if (mockState.kind === "anonymous") redirect("/sign-in");
      if (mockState.kind === "pending") redirect("/access-pending?ctx=pending");
      return mockState.kind === "client" ? CLIENT_SESSION : STAFF_SESSION;
    },
    getCurrentSession: async () => {
      if (mockState.kind === "anonymous" || mockState.kind === "pending") return null;
      return mockState.kind === "client" ? CLIENT_SESSION : STAFF_SESSION;
    },
  },
});

const { db } = await import("@/db");
const { crmClients, crmQuotes, crmQuoteItems } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { createQuote, updateQuote, deleteQuote } = await import("./crm-quotes.ts");

// ---- helpers -----------------------------------------------------------
async function expectRedirect(fn, target) {
  try {
    await fn();
    assert.fail("expected a redirect (NEXT_REDIRECT), but the call returned normally");
  } catch (err) {
    const digest = String(err?.digest ?? "");
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    if (target) assert.ok(digest.includes(target), `expected redirect to ${target}, got digest: ${digest}`);
  }
}

function makeQuoteFormData(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Test quote");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(overrides.items ?? [{ description: "Service", quantity: 1, unitPriceCents: 1000 }]));
  return fd;
}

const quoteRows = (clientId) => db.select().from(crmQuotes).where(eq(crmQuotes.clientId, clientId));

async function seedDraftQuote(clientId) {
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId, quoteNumber: `P0-1-${randomUUID().slice(0, 8)}`, title: "Seed quote", currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  return quote;
}

let client;

before(async () => {
  [client] = await db.insert(crmClients).values({ name: `P0-1 Quote Test Client ${randomUUID()}` }).returning();
});
beforeEach(() => {
  actAsStaff();
});
after(async () => {
  const rows = await quoteRows(client.id);
  for (const q of rows) await db.delete(crmQuoteItems).where(eq(crmQuoteItems.quoteId, q.id));
  await db.delete(crmQuotes).where(eq(crmQuotes.clientId, client.id));
  await db.delete(crmClients).where(eq(crmClients.id, client.id));
  await db.$client.end();
});

// =====================================================================
// createQuote — DENY cases, zero side effect
// =====================================================================
test("A — unauthenticated -> createQuote redirects to /sign-in, no quote created", async () => {
  actAsAnonymous();
  await expectRedirect(() => createQuote(makeQuoteFormData(client.id)), "/sign-in");
  assert.equal((await quoteRows(client.id)).length, 0, "no quote row created");
});

test("B — pending session -> createQuote redirects to /access-pending, no quote created", async () => {
  actAsPending();
  await expectRedirect(() => createQuote(makeQuoteFormData(client.id)), "/access-pending");
  assert.equal((await quoteRows(client.id)).length, 0, "no quote row created");
});

test("C — client role -> createQuote refused (redirect /dashboard), no quote created", async () => {
  actAsClient();
  await expectRedirect(() => createQuote(makeQuoteFormData(client.id)), "/dashboard");
  assert.equal((await quoteRows(client.id)).length, 0, "no quote row created");
});

// =====================================================================
// createQuote — ALLOW case, staff keeps working
// =====================================================================
test("D — staff -> createQuote succeeds: exactly one quote row created", async () => {
  actAsStaff();
  const quote = await createQuote(makeQuoteFormData(client.id, { title: "Real quote" }));
  const rows = await quoteRows(client.id);
  assert.equal(rows.length, 1, "exactly one quote row");
  assert.equal(rows[0].title, "Real quote");
  assert.equal(quote.id, rows[0].id);
});

// =====================================================================
// updateQuote — DENY cases, zero side effect
// =====================================================================
test("E — unauthenticated -> updateQuote redirects to /sign-in, quote untouched", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsAnonymous();
  await expectRedirect(() => updateQuote(seeded.id, makeQuoteFormData(client.id, { title: "Hacked title" })), "/sign-in");
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.equal(row.title, "Seed quote", "title unchanged");
});

test("F — pending session -> updateQuote redirects to /access-pending, quote untouched", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsPending();
  await expectRedirect(() => updateQuote(seeded.id, makeQuoteFormData(client.id, { title: "Hacked title" })), "/access-pending");
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.equal(row.title, "Seed quote", "title unchanged");
});

test("G — client role -> updateQuote refused (redirect /dashboard), quote untouched", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsClient();
  await expectRedirect(() => updateQuote(seeded.id, makeQuoteFormData(client.id, { title: "Hacked title" })), "/dashboard");
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.equal(row.title, "Seed quote", "title unchanged");
});

// =====================================================================
// updateQuote — ALLOW case, staff keeps working
// =====================================================================
test("H — staff -> updateQuote succeeds: title actually changed", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsStaff();
  await updateQuote(seeded.id, makeQuoteFormData(client.id, { title: "Legitimately updated" }));
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.equal(row.title, "Legitimately updated");
});

// =====================================================================
// deleteQuote — DENY cases, zero side effect
// =====================================================================
test("I — unauthenticated -> deleteQuote redirects to /sign-in, quote untouched", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsAnonymous();
  await expectRedirect(() => deleteQuote(seeded.id), "/sign-in");
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.ok(row, "quote still exists");
});

test("J — pending session -> deleteQuote redirects to /access-pending, quote untouched", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsPending();
  await expectRedirect(() => deleteQuote(seeded.id), "/access-pending");
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.ok(row, "quote still exists");
});

test("K — client role -> deleteQuote refused (redirect /dashboard), quote untouched", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsClient();
  await expectRedirect(() => deleteQuote(seeded.id), "/dashboard");
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.ok(row, "quote still exists");
});

// =====================================================================
// deleteQuote — ALLOW case, staff keeps working
// =====================================================================
test("L — staff -> deleteQuote succeeds: quote actually removed", async () => {
  const seeded = await seedDraftQuote(client.id);
  actAsStaff();
  await deleteQuote(seeded.id);
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, seeded.id)).limit(1);
  assert.equal(row, undefined, "quote actually deleted");
});
