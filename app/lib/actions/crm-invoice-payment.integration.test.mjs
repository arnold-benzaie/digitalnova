// Integration tests for Chantier 2 / Phase 3: createInvoicePaymentCheckout
// (lib/actions/crm-invoice-payment.ts) — the token-authorized, provider-mock
// checkout preparation for CRM invoices. NO real FastSpring call is ever
// made: @/lib/billing/crm-invoice-payment-provider is fully mocked here so
// every call is captured and controllable, exactly like
// crm-quotes-send.integration.test.mjs mocked @/lib/email/resend.
//
// This action performs NO database write of any kind — the tests below
// prove that financial state (status/paidAt/fastspringReference) is
// byte-for-byte identical before and after every call, success or failure.
//
// Same mocking convention as crm-quote-access.integration.test.mjs /
// crm-invoices-auth.integration.test.mjs: @/lib/session's requireSession()
// is faked with a fixed staff session (needed only for the fixtures —
// createOrGetInvoiceAccessLink and createInvoice are staff-only); next/headers
// is faked with an empty Headers (resolveInvoiceByToken's IP resolution).
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-invoice-payment.integration.test.mjs
import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
// resolveInvoiceByToken calls next/headers's headers() for rate-limit IP
// resolution — throws outside a real request scope; an empty Headers is
// enough since clientIpFromHeaders() falls back to "unknown".
mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => ({
      userId: "test-staff-user",
      clerkUserId: "test_clerk_staff",
      email: "staff@example.com",
      fullName: "Test Staff",
      firstName: "Test",
      organizationId: "test-org",
      organizationName: "Test Org",
      role: "staff",
      previousLastLoginAt: null,
    }),
    getCurrentSession: async () => null,
  },
});

/** @type {Array<Record<string, unknown>>} */
let providerCalls = [];
let providerShouldFail = false;
mock.module("@/lib/billing/crm-invoice-payment-provider", {
  namedExports: {
    getCrmInvoicePaymentProvider: () => ({
      createInvoiceCheckout: async (input) => {
        providerCalls.push(input);
        if (providerShouldFail) throw new Error("simulated provider failure");
        return { url: `/mock-crm-checkout/${input.invoiceReference}`, sessionId: `mock-session-${input.invoiceReference}` };
      },
    }),
  },
});

const { db } = await import("@/db");
const { crmClients, crmInvoiceAccessLinks, crmInvoiceItems, crmInvoices, integrationApiRateLimitHits } = await import("@/db/schema");
const { eq, inArray, like } = await import("drizzle-orm");
const { createInvoice } = await import("./crm-invoices.ts");
const { createOrGetInvoiceAccessLink } = await import("./crm-invoice-access.ts");
const { createInvoicePaymentCheckout } = await import("./crm-invoice-payment.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();

async function clearCheckoutRateLimitHits() {
  await db.delete(integrationApiRateLimitHits).where(like(integrationApiRateLimitHits.key, "crm_invoice_checkout:%"));
  await db.delete(integrationApiRateLimitHits).where(like(integrationApiRateLimitHits.key, "crm_invoice_token:%"));
}

before(clearCheckoutRateLimitHits);
beforeEach(() => {
  providerCalls = [];
  providerShouldFail = false;
});
after(async () => {
  await clearCheckoutRateLimitHits();
  if (createdInvoiceIds.size) await db.delete(crmInvoiceAccessLinks).where(inArray(crmInvoiceAccessLinks.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const [client] = await db.insert(crmClients).values({ name: `P3-C2 Test Client ${randomUUID()}`, email: "invoice-payment-test@example.test", ...overrides }).returning();
  createdClientIds.add(client.id);
  return client;
}

function invoiceFormData(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Facture test Chantier 2 Phase 3");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(overrides.items ?? [{ description: "Ligne test", quantity: 1, unitPriceCents: 75000 }]));
  return fd;
}

/** Creates a draft invoice, then directly sets it to the desired status
 * (bypassing updateInvoiceStatus's own business rules on purpose — this is
 * fixture setup, not a test of that function) and returns a fresh public
 * access token for it. */
async function makeInvoiceWithToken(status, overrides = {}) {
  const client = await makeClient();
  const invoice = await createInvoice(invoiceFormData(client.id, overrides));
  createdInvoiceIds.add(invoice.id);
  if (status !== "draft") {
    await db.update(crmInvoices).set({ status }).where(eq(crmInvoices.id, invoice.id));
  }
  const link = await createOrGetInvoiceAccessLink(invoice.id);
  return { client, invoice: { ...invoice, status }, link };
}

async function invoiceRow(id) {
  const [row] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  return row;
}

// ---- A. valid token + sent invoice -> provider called correctly ----
test("A — a valid token for a sent invoice calls the provider exactly once with the DB snapshot", async () => {
  const { invoice, link } = await makeInvoiceWithToken("sent");

  const result = await createInvoicePaymentCheckout(link.token);

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].invoiceReference, invoice.id);
  assert.equal(providerCalls[0].amountCents, invoice.totalCents);
  assert.equal(providerCalls[0].currency, invoice.currency);
  assert.deepEqual(result, { ok: true, url: `/mock-crm-checkout/${invoice.id}`, sessionId: `mock-session-${invoice.id}` });
});

// ---- B/C/D. the action's own signature never accepts amount/currency/invoiceId from the browser ----
test("B/C/D — createInvoicePaymentCheckout accepts only a token, never amount/currency/invoiceId", async () => {
  const source = readFileSync(new URL("./crm-invoice-payment.ts", import.meta.url), "utf8");
  const signature = source.match(/export async function createInvoicePaymentCheckout\(([^)]*)\)/)?.[1] ?? "";
  assert.match(signature, /^token: string$/, "the public signature must be exactly (token: string)");
  assert.doesNotMatch(signature, /amount|currency|invoiceId|clientId|status/i);
});

// ---- E. invalid token -> provider never called ----
test("E — an unknown token never reaches the provider", async () => {
  const result = await createInvoicePaymentCheckout("this-token-does-not-exist-anywhere-000000");
  assert.deepEqual(result, { ok: false, reason: "not_found" });
  assert.equal(providerCalls.length, 0);
});

// ---- F. expired token -> provider never called ----
test("F — an expired token never reaches the provider", async () => {
  const { link } = await makeInvoiceWithToken("sent");
  await db.update(crmInvoiceAccessLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(crmInvoiceAccessLinks.id, link.id));

  const result = await createInvoicePaymentCheckout(link.token);
  assert.deepEqual(result, { ok: false, reason: "expired" });
  assert.equal(providerCalls.length, 0);
});

// ---- G. revoked token -> provider never called ----
test("G — a revoked token never reaches the provider", async () => {
  const { link } = await makeInvoiceWithToken("sent");
  await db.update(crmInvoiceAccessLinks).set({ revokedAt: new Date() }).where(eq(crmInvoiceAccessLinks.id, link.id));

  const result = await createInvoicePaymentCheckout(link.token);
  assert.deepEqual(result, { ok: false, reason: "revoked" });
  assert.equal(providerCalls.length, 0);
});

// ---- H/I/J/K. non-eligible statuses -> provider never called ----
for (const status of ["draft", "paid", "canceled", "refunded"]) {
  test(`H/I/J/K — an invoice with status "${status}" never reaches the provider`, async () => {
    const { link } = await makeInvoiceWithToken(status);

    const result = await createInvoicePaymentCheckout(link.token);
    assert.deepEqual(result, { ok: false, reason: "not_eligible" });
    assert.equal(providerCalls.length, 0);
  });
}

// ---- L. amount <= 0 -> provider never called ----
test("L — an invoice with a zero/invalid total never reaches the provider", async () => {
  const { invoice, link } = await makeInvoiceWithToken("sent");
  await db.update(crmInvoices).set({ totalCents: 0 }).where(eq(crmInvoices.id, invoice.id));

  const result = await createInvoicePaymentCheckout(link.token);
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });
  assert.equal(providerCalls.length, 0);
});

// ---- M. unsupported currency -> provider never called ----
test("M — an invoice with an unsupported currency never reaches the provider", async () => {
  const { invoice, link } = await makeInvoiceWithToken("sent");
  await db.update(crmInvoices).set({ currency: "USD" }).where(eq(crmInvoices.id, invoice.id));

  const result = await createInvoicePaymentCheckout(link.token);
  assert.deepEqual(result, { ok: false, reason: "invalid_currency" });
  assert.equal(providerCalls.length, 0);
});

// ---- N. success -> no financial mutation whatsoever ----
test("N — a successful checkout leaves status/paidAt/fastspringReference completely untouched", async () => {
  const { invoice, link } = await makeInvoiceWithToken("sent");
  const before_ = await invoiceRow(invoice.id);

  const result = await createInvoicePaymentCheckout(link.token);
  assert.equal(result.ok, true);

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
  assert.equal(after_.fastspringReference, null);
  assert.deepEqual(after_, before_, "the row must be byte-for-byte identical before and after checkout creation");
});

// ---- O. provider failure -> no financial mutation ----
test("O — a provider failure leaves the invoice completely untouched", async () => {
  const { invoice, link } = await makeInvoiceWithToken("sent");
  const before_ = await invoiceRow(invoice.id);
  providerShouldFail = true;

  const result = await createInvoicePaymentCheckout(link.token);
  assert.deepEqual(result, { ok: false, reason: "provider_error" });

  const after_ = await invoiceRow(invoice.id);
  assert.deepEqual(after_, before_);
});

// ---- P. rate limit -> excess calls blocked, no financial mutation ----
test("P — repeated checkout creation for the same invoice is rate-limited, with no financial mutation", async () => {
  const { invoice, link } = await makeInvoiceWithToken("sent");

  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(await createInvoicePaymentCheckout(link.token));
  }

  const blocked = results.filter((r) => !r.ok && r.reason === "checkout_rate_limited");
  assert.ok(blocked.length >= 1, "at least the 4th attempt within the window must be rate-limited");
  assert.equal(providerCalls.length, 3, "the provider must never be reached beyond the configured limit");

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
  assert.equal(after_.fastspringReference, null);
});
