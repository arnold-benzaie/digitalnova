// Integration tests for Chantier 1 / Phase 4: the public client
// accept/decline response (lib/actions/crm-quote-response.ts's
// respondToQuoteByToken). PUBLIC action — no Clerk session, no staff
// role — authorized entirely by the token via resolveQuoteByToken
// (lib/actions/crm-quote-access.ts, unmodified). requireSession() is only
// mocked because createOrGetQuoteAccessLink (staff-only, used here purely
// as fixture setup to mint a token) and logCrmAudit's getCurrentSession()
// need it — respondToQuoteByToken itself never calls it.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-quote-respond.integration.test.mjs
import { test, mock, before, after } from "node:test";
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
// resolveQuoteByToken calls next/headers's headers() for rate-limit IP
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

const { db } = await import("@/db");
const { auditLog, crmClients, crmQuoteAccessLinks, crmQuotes, integrationApiRateLimitHits } = await import("@/db/schema");
const { eq, and, inArray, like } = await import("drizzle-orm");
const { createOrGetQuoteAccessLink } = await import("./crm-quote-access.ts");
const { respondToQuoteByToken } = await import("./crm-quote-response.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();

async function clearQuoteTokenRateLimitHits() {
  await db.delete(integrationApiRateLimitHits).where(like(integrationApiRateLimitHits.key, "crm_quote_token:%"));
}

before(clearQuoteTokenRateLimitHits);
after(async () => {
  await clearQuoteTokenRateLimitHits();
  if (createdQuoteIds.size) await db.delete(crmQuoteAccessLinks).where(inArray(crmQuoteAccessLinks.quoteId, [...createdQuoteIds]));
  if (createdQuoteIds.size) await db.delete(auditLog).where(inArray(auditLog.targetId, [...createdQuoteIds]));
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClientAndQuote(overrides = {}) {
  const [client] = await db.insert(crmClients).values({ name: `P4 Test Client ${randomUUID()}` }).returning();
  createdClientIds.add(client.id);
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId: client.id, quoteNumber: `P4-TEST-${randomUUID().slice(0, 8)}`, title: "Devis test Chantier 1 Phase 4", currency: "EUR", ...overrides })
    .returning();
  createdQuoteIds.add(quote.id);
  return quote;
}

async function makeSentQuoteWithToken(overrides = {}) {
  const quote = await makeClientAndQuote({ status: "sent", sentAt: new Date(), ...overrides });
  const link = await createOrGetQuoteAccessLink(quote.id);
  return { quote, link };
}

async function quoteRow(id) {
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  return row;
}

async function auditRowsFor(quoteId, action) {
  return db.select().from(auditLog).where(and(eq(auditLog.targetId, quoteId), eq(auditLog.action, action)));
}

// ---- A. sent -> accepted ----
test("A — a valid token for a sent quote can accept it", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  const result = await respondToQuoteByToken(link.token, "accepted");
  assert.deepEqual(result, { ok: true, status: "accepted", alreadyResponded: false });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "accepted");
});

// ---- B. sent -> declined ----
test("B — a valid token for a sent quote can decline it", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  const result = await respondToQuoteByToken(link.token, "declined");
  assert.deepEqual(result, { ok: true, status: "declined", alreadyResponded: false });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "declined");
});

// ---- C. respondedAt written ----
test("C — respondedAt is populated by a real transition", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  await respondToQuoteByToken(link.token, "accepted");
  const after_ = await quoteRow(quote.id);
  assert.ok(after_.respondedAt instanceof Date);
});

// ---- D. invalid token -> no mutation ----
test("D — an unknown token causes no mutation", async () => {
  const { quote } = await makeSentQuoteWithToken();
  const result = await respondToQuoteByToken("this-token-does-not-exist-anywhere-000000", "accepted");
  assert.deepEqual(result, { ok: false, reason: "not_found" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.respondedAt, null);
});

// ---- E. expired token -> no mutation ----
test("E — an expired token causes no mutation", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  await db.update(crmQuoteAccessLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(crmQuoteAccessLinks.id, link.id));

  const result = await respondToQuoteByToken(link.token, "accepted");
  assert.deepEqual(result, { ok: false, reason: "expired" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.respondedAt, null);
});

// ---- F. revoked token -> no mutation ----
test("F — a revoked token causes no mutation", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  await db.update(crmQuoteAccessLinks).set({ revokedAt: new Date() }).where(eq(crmQuoteAccessLinks.id, link.id));

  const result = await respondToQuoteByToken(link.token, "accepted");
  assert.deepEqual(result, { ok: false, reason: "revoked" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.respondedAt, null);
});

// ---- G. locked token -> no mutation ----
test("G — a locked token (exhausted attempt budget) causes no mutation", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  await db.update(crmQuoteAccessLinks).set({ failedAttempts: link.maxAttempts }).where(eq(crmQuoteAccessLinks.id, link.id));

  const result = await respondToQuoteByToken(link.token, "accepted");
  assert.deepEqual(result, { ok: false, reason: "locked" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.respondedAt, null);
});

// ---- H. invalid decision -> rejected ----
test("H — an arbitrary status string is rejected as an invalid decision, before any DB read", async () => {
  const { quote } = await makeSentQuoteWithToken();
  const result = await respondToQuoteByToken("irrelevant-token", "draft");
  assert.deepEqual(result, { ok: false, reason: "invalid_decision" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "sent");
});

// ---- I. accepted -> declined rejected ----
test("I — a quote already accepted cannot be flipped to declined", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  await respondToQuoteByToken(link.token, "accepted");

  const result = await respondToQuoteByToken(link.token, "declined");
  assert.deepEqual(result, { ok: false, reason: "conflicting_decision" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "accepted");
});

// ---- J. declined -> accepted rejected ----
test("J — a quote already declined cannot be flipped to accepted", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  await respondToQuoteByToken(link.token, "declined");

  const result = await respondToQuoteByToken(link.token, "accepted");
  assert.deepEqual(result, { ok: false, reason: "conflicting_decision" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "declined");
});

// ---- K. same decision repeated -> idempotent ----
test("K — repeating the exact same decision is idempotent", async () => {
  const { link } = await makeSentQuoteWithToken();
  const first = await respondToQuoteByToken(link.token, "accepted");
  const second = await respondToQuoteByToken(link.token, "accepted");

  assert.deepEqual(first, { ok: true, status: "accepted", alreadyResponded: false });
  assert.deepEqual(second, { ok: true, status: "accepted", alreadyResponded: true });
});

// ---- L/M. concurrent double call -> one real transition, one audit log ----
test("L/M — a concurrent double call for the same decision produces exactly one real transition and one audit log entry", async () => {
  const { quote, link } = await makeSentQuoteWithToken();

  const [first, second] = await Promise.all([respondToQuoteByToken(link.token, "accepted"), respondToQuoteByToken(link.token, "accepted")]);

  const results = [first, second];
  const realTransitions = results.filter((r) => r.ok && !r.alreadyResponded);
  const idempotentEchoes = results.filter((r) => r.ok && r.alreadyResponded);
  assert.equal(realTransitions.length, 1, "exactly one call must perform the real transition");
  assert.equal(idempotentEchoes.length, 1, "the other call must observe it as already responded");

  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "accepted");

  const auditRows = await auditRowsFor(quote.id, "crm.quote_accepted");
  assert.equal(auditRows.length, 1, "exactly one audit log row must exist for the real transition");
});

// ---- N. draft -> rejected ----
test("N — a draft quote (never sent) cannot be responded to", async () => {
  const quote = await makeClientAndQuote({ status: "draft" });
  const link = await createOrGetQuoteAccessLink(quote.id);

  const result = await respondToQuoteByToken(link.token, "accepted");
  assert.deepEqual(result, { ok: false, reason: "not_eligible" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "draft");
});

// ---- O. expired status -> rejected ----
test("O — a quote whose status is already expired cannot be responded to", async () => {
  const quote = await makeClientAndQuote({ status: "expired" });
  const link = await createOrGetQuoteAccessLink(quote.id);

  const result = await respondToQuoteByToken(link.token, "accepted");
  assert.deepEqual(result, { ok: false, reason: "not_eligible" });
  const after_ = await quoteRow(quote.id);
  assert.equal(after_.status, "expired");
});

// ---- P/Q. FR/EN vocabulary present ----
test("P — the FR dictionary carries the required response vocabulary", async () => {
  const { quoteVerification } = await import("@/lib/i18n/dictionaries/quote-verification.ts");
  for (const key of ["accept", "decline", "confirmDecline", "accepted", "declined", "conflictingDecision", "notEligible"]) {
    assert.ok(quoteVerification.fr.response[key], `fr.response.${key} must be a non-empty string`);
  }
});

test("Q — the EN dictionary carries the required response vocabulary", async () => {
  const { quoteVerification } = await import("@/lib/i18n/dictionaries/quote-verification.ts");
  for (const key of ["accept", "decline", "confirmDecline", "accepted", "declined", "conflictingDecision", "notEligible"]) {
    assert.ok(quoteVerification.en.response[key], `en.response.${key} must be a non-empty string`);
  }
});

// ---- R. token never logged ----
test("R — the source never logs the access token", async () => {
  const source = readFileSync(new URL("./crm-quote-response.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(log|error|warn)\(/);
});

// ---- S. no client-supplied quoteId used as authority ----
test("S — respondToQuoteByToken never accepts a quoteId parameter; only resolveQuoteByToken's own result authorizes the mutation", async () => {
  const source = readFileSync(new URL("./crm-quote-response.ts", import.meta.url), "utf8");
  const signature = source.match(/export async function respondToQuoteByToken\(([^)]*)\)/)?.[1] ?? "";
  assert.doesNotMatch(signature, /quoteId|clientId|organizationId|status/i, "the public signature must only ever be (token, decision)");
  assert.match(source, /resolved\.quote\.id/, "the write must key off resolveQuoteByToken's own resolved id");
});

// ---- T. no Catalogue touched ----
test("T — the source has zero references to Catalogue/pricing tables", async () => {
  const source = readFileSync(new URL("./crm-quote-response.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /services|service_market_offers|serviceMarketOffers|unitPriceCents/i);
});

// ---- U. no invoice touched ----
test("U — the source has zero references to invoice tables", async () => {
  const source = readFileSync(new URL("./crm-quote-response.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /crmInvoice|invoice/i);
});

// ---- V. respondedAt not rewritten on an idempotent repeat ----
test("V — respondedAt is not rewritten by a repeated, idempotent decision", async () => {
  const { quote, link } = await makeSentQuoteWithToken();
  await respondToQuoteByToken(link.token, "accepted");
  const firstRow = await quoteRow(quote.id);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await respondToQuoteByToken(link.token, "accepted");
  const secondRow = await quoteRow(quote.id);

  assert.equal(secondRow.respondedAt.getTime(), firstRow.respondedAt.getTime());
});
