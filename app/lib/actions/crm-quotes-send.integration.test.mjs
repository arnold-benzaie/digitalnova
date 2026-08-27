// Integration tests for Chantier 1 / Phase 3: sending a quote by email
// (updateQuoteStatus's "sent" interception in lib/actions/crm-quotes.ts,
// lib/email/quote.ts). No real email provider is ever contacted —
// @/lib/email/resend's sendEmail is fully mocked, so RESEND_API_KEY is
// never read and no network call happens.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview. Same mocking convention as
// notification-visibility.integration.test.mjs: @/lib/session's
// requireSession() is faked with a mutable session state (actAsStaff() /
// actAsClient()), so the REAL requireStaffRole() (lib/dev-role.ts, never
// mocked) runs against it — this is what lets the unauthorized-call test
// below prove a genuine runtime rejection instead of a textual check.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-quotes-send.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
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

// requireSession() itself is faked, but requireStaffRole() (lib/dev-role.ts)
// is the REAL, unmocked implementation — it calls this faked
// requireSession(), reads .role, and redirect()s when the role is
// "client". That real redirect() is what the unauthorized-call test below
// observes as a rejection: genuine proof updateQuoteStatus's own
// requireStaffRole() call rejects a non-staff caller, not a textual check.
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => mockState.session,
    getCurrentSession: async () => null,
  },
});

/** @type {{ sent: true; id: string } | { sent: false; reason: string }} */
let sendEmailResult = { sent: true, id: "test-email-id" };
/** @type {Array<Record<string, unknown>>} */
let sendEmailCalls = [];
mock.module("@/lib/email/resend", {
  namedExports: {
    sendEmail: async (input) => {
      sendEmailCalls.push(input);
      return sendEmailResult;
    },
  },
});

const { db } = await import("@/db");
const { crmClients, crmQuoteAccessLinks, crmQuotes, integrationApiRateLimitHits } = await import("@/db/schema");
const { eq, inArray, like } = await import("drizzle-orm");
const { createQuote, updateQuoteStatus } = await import("./crm-quotes.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();

async function clearQuoteSendRateLimitHits() {
  await db.delete(integrationApiRateLimitHits).where(like(integrationApiRateLimitHits.key, "crm_quote_send:%"));
}

async function makeClient(overrides = {}) {
  const [client] = await db.insert(crmClients).values({ name: `P3 Test Client ${randomUUID()}`, ...overrides }).returning();
  createdClientIds.add(client.id);
  return client;
}

function quoteFormData(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Devis test Chantier 1 Phase 3");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(overrides.items ?? [{ description: "Ligne test", quantity: 1, unitPriceCents: 30000 }]));
  if (overrides.validUntil) fd.set("validUntil", overrides.validUntil);
  return fd;
}

async function makeQuote(clientId, overrides = {}) {
  const quote = await createQuote(quoteFormData(clientId, overrides));
  createdQuoteIds.add(quote.id);
  return quote;
}

async function quoteRow(id) {
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  return row;
}

beforeEach(async () => {
  sendEmailResult = { sent: true, id: "test-email-id" };
  sendEmailCalls = [];
  actAsStaff();
  await clearQuoteSendRateLimitHits();
});

after(async () => {
  await clearQuoteSendRateLimitHits();
  if (createdQuoteIds.size) await db.delete(crmQuoteAccessLinks).where(inArray(crmQuoteAccessLinks.quoteId, [...createdQuoteIds]));
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

// ---- A/B/C. valid email -> email prepared correctly, correct public URL, Phase 1 link reused ----
test("A/B/C — sending a quote with a valid client email prepares the correct email and public URL", async () => {
  const client = await makeClient({ email: "client-a@example.test", name: "Société A" });
  const quote = await makeQuote(client.id);

  await updateQuoteStatus(quote.id, "sent");

  assert.equal(sendEmailCalls.length, 1);
  const call = sendEmailCalls[0];
  assert.equal(call.to, "client-a@example.test");
  assert.match(call.subject, new RegExp(quote.quoteNumber));

  const [link] = await db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.quoteId, quote.id));
  assert.ok(link, "Phase 1's access link must have been created/reused");
  assert.match(call.html, new RegExp(`/quote-verification/${link.token}`));
});

// ---- D. client without email -> no mutation ----
test("D — a client with no email on file is rejected before any mutation", async () => {
  const client = await makeClient({ email: null });
  const quote = await makeQuote(client.id);

  await assert.rejects(() => updateQuoteStatus(quote.id, "sent"));

  assert.equal(sendEmailCalls.length, 0, "no email attempt should have been made");
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "draft");
  assert.equal(after_.sentAt, null);
  const [link] = await db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.quoteId, quote.id));
  assert.equal(link, undefined, "no access link should be minted for a client with no email");
});

// ---- E. nonexistent quote -> rejected ----
test("E — a nonexistent quote id is rejected", async () => {
  await assert.rejects(() => updateQuoteStatus(randomUUID(), "sent"));
  assert.equal(sendEmailCalls.length, 0);
});

// ---- F0. deliverQuoteEmail stays a private, non-exported function (structural invariant, not the auth proof) ----
test("F0 — deliverQuoteEmail is never exported as its own callable entry point", async () => {
  const actionsSource = readFileSync(new URL("./crm-quotes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(actionsSource, /export\s+(async\s+)?function\s+deliverQuoteEmail/, "deliverQuoteEmail must stay a private, non-exported function");
});

// ---- F1. real runtime proof: a non-staff session calling updateQuoteStatus directly is rejected before any side effect ----
test("F1 — a client-role session cannot call updateQuoteStatus directly: requireStaffRole rejects it before any side effect", async () => {
  const client = await makeClient({ email: "client-unauth@example.test" });
  const quote = await makeQuote(client.id);
  const before_ = await quoteRow(quote.id);

  actAsClient();
  try {
    await assert.rejects(() => updateQuoteStatus(quote.id, "sent"));
  } finally {
    actAsStaff();
  }

  assert.equal(sendEmailCalls.length, 0, "requireStaffRole must reject before deliverQuoteEmail ever runs");
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, before_.status);
  assert.equal(after_.status, "draft");
  assert.equal(after_.sentAt, null);
  const [link] = await db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.quoteId, quote.id));
  assert.equal(link, undefined, "no access link must be minted for an unauthorized caller");
});

// ---- F2. authorized staff session: the normal send flow still works end to end ----
test("F2 — an authorized staff session can still send a quote: email sent, status becomes sent, sentAt is populated", async () => {
  actAsStaff();
  const client = await makeClient({ email: "client-staff-ok@example.test" });
  const quote = await makeQuote(client.id);

  await updateQuoteStatus(quote.id, "sent");

  assert.equal(sendEmailCalls.length, 1);
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "sent");
  assert.ok(after_.sentAt instanceof Date);
});

// ---- G/H. provider failure -> previous status kept, sentAt untouched ----
test("G/H — a provider failure leaves status and sentAt exactly as they were", async () => {
  sendEmailResult = { sent: false, reason: "simulated provider rejection" };
  const client = await makeClient({ email: "client-fail@example.test" });
  const quote = await makeQuote(client.id);
  const before_ = await quoteRow(quote.id);

  await assert.rejects(() => updateQuoteStatus(quote.id, "sent"));

  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, before_.status);
  assert.equal(after_.status, "draft");
  assert.equal(after_.sentAt, null);
});

// ---- I/J. provider success -> status sent, sentAt set ----
test("I/J — a provider success sets status to sent and populates sentAt", async () => {
  const client = await makeClient({ email: "client-ok@example.test" });
  const quote = await makeQuote(client.id);

  await updateQuoteStatus(quote.id, "sent");

  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "sent");
  assert.ok(after_.sentAt instanceof Date);
});

// ---- K/L. FR / EN ----
test("K — French client preference produces French email copy", async () => {
  const client = await makeClient({ email: "client-fr@example.test", preferredLocale: "fr" });
  const quote = await makeQuote(client.id);

  await updateQuoteStatus(quote.id, "sent");

  assert.match(sendEmailCalls[0].html, /Votre devis est disponible/);
});

test("L — English client preference produces English email copy", async () => {
  const client = await makeClient({ email: "client-en@example.test", preferredLocale: "en" });
  const quote = await makeQuote(client.id);

  await updateQuoteStatus(quote.id, "sent");

  assert.match(sendEmailCalls[0].html, /Your quote is available/);
});

// ---- M. double-click protection ----
test("M — a second immediate send attempt for the same quote is rejected by the rate limit", async () => {
  const client = await makeClient({ email: "client-double@example.test" });
  const quote = await makeQuote(client.id);

  await updateQuoteStatus(quote.id, "sent");
  await assert.rejects(() => updateQuoteStatus(quote.id, "sent"));

  assert.equal(sendEmailCalls.length, 1, "the second attempt must never reach the email provider");
});

// ---- N. idempotencyKey ----
test("N — idempotencyKey is a deterministic, secret-free, token-free value derived from the quote id", async () => {
  const client = await makeClient({ email: "client-idem@example.test" });
  const quote = await makeQuote(client.id);

  await updateQuoteStatus(quote.id, "sent");

  assert.equal(sendEmailCalls[0].idempotencyKey, `crm-quote-${quote.id}`);
  const [link] = await db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.quoteId, quote.id));
  assert.doesNotMatch(String(sendEmailCalls[0].idempotencyKey), new RegExp(link.token));
});

// ---- O. no token/accessUrl in logs or audit metadata ----
test("O — the source never logs the access token or a full accessUrl outside the email itself", async () => {
  const source = readFileSync(new URL("./crm-quotes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(log|error|warn)\([^)]*\b(link\.token|accessUrl)\b/);
  // metadata passed to logCrmAudit for the send action must stay limited
  // to quoteNumber/emailMessageId — never the token or the URL.
  const sentAuditBlock = source.match(/action:\s*"crm\.quote_sent"[\s\S]{0,200}/)?.[0] ?? "";
  assert.doesNotMatch(sentAuditBlock, /\btoken\b|\baccessUrl\b/);
});

// ---- P. no Catalogue recalculation ----
test("P — neither crm-quotes.ts's send path nor lib/email/quote.ts reference Catalogue tables", async () => {
  const actionsSource = readFileSync(new URL("./crm-quotes.ts", import.meta.url), "utf8");
  const emailSource = readFileSync(new URL("../email/quote.ts", import.meta.url), "utf8");
  for (const source of [actionsSource, emailSource]) {
    assert.doesNotMatch(source, /services|service_market_offers|serviceMarketOffers/i);
  }
});

// ---- Q. no real external email during tests (structural guarantee) ----
test("Q — @/lib/email/resend is fully mocked; RESEND_API_KEY is never read by these tests", async () => {
  assert.equal(process.env.RESEND_API_KEY, undefined, "this test file must never rely on or set a real Resend API key");
});
