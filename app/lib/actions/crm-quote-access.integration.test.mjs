// Integration tests for Chantier 1 / Phase 1: crm_quote_access_links +
// lib/actions/crm-quote-access.ts (createOrGetQuoteAccessLink,
// resolveQuoteByToken). Infrastructure only — no public page, no email,
// no accept/decline exist yet.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview. Same mocking convention as
// lib/developer-console/actions.integration.test.mjs: @/lib/session's
// requireSession() (the one lib/dev-role.ts's requireStaffRole() actually
// calls) is faked with a fixed staff session; next/cache is not imported
// by the module under test, so it needs no mock here.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-quote-access.integration.test.mjs
import { test, mock, before, after } from "node:test";
import { like } from "drizzle-orm";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
// resolveQuoteByToken calls next/headers's headers() for rate-limit IP
// resolution — throws outside a real request scope (unlike getLocale(),
// which self-catches this); a plain empty Headers is enough since
// clientIpFromHeaders() already falls back to "unknown" when absent.
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
  },
});

const { db } = await import("@/db");
const { crmClients, crmQuoteAccessLinks, crmQuotes, integrationApiRateLimitHits } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createOrGetQuoteAccessLink, resolveQuoteByToken } = await import("./crm-quote-access.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();

async function makeClientAndQuote(overrides = {}) {
  const [client] = await db.insert(crmClients).values({ name: `P1 Test Client ${randomUUID()}` }).returning();
  createdClientIds.add(client.id);
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId: client.id, quoteNumber: `P1-TEST-${randomUUID().slice(0, 8)}`, title: "Devis test Chantier 1 Phase 1", currency: "EUR", ...overrides })
    .returning();
  createdQuoteIds.add(quote.id);
  return quote;
}

async function linkRowFor(quoteId) {
  return db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.quoteId, quoteId));
}

// The rate-limit test (L) deliberately drives the "crm_quote_token:unknown"
// bucket to its limit — clear any residue from a previous run of this same
// file before starting, and again afterward, so re-running this suite
// within the same 5-minute window never sees stale hit counts.
async function clearQuoteTokenRateLimitHits() {
  await db.delete(integrationApiRateLimitHits).where(like(integrationApiRateLimitHits.key, "crm_quote_token:%"));
}

before(clearQuoteTokenRateLimitHits);

after(async () => {
  await clearQuoteTokenRateLimitHits();
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

// ---- A. creation for an existing quote ----
test("createOrGetQuoteAccessLink creates a link for an existing quote", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(link.quoteId, quote.id);
  assert.ok(link.token);
  const rows = await linkRowFor(quote.id);
  assert.equal(rows.length, 1);
});

// ---- B. token uniqueness (DB-level unique index) ----
test("tokens are unique across two different quotes", async () => {
  const quoteA = await makeClientAndQuote();
  const quoteB = await makeClientAndQuote();
  const linkA = await createOrGetQuoteAccessLink(quoteA.id);
  const linkB = await createOrGetQuoteAccessLink(quoteB.id);
  assert.notEqual(linkA.token, linkB.token);
});

// ---- C. token entropy/format ----
test("token is a 256-bit value encoded as base64url (43 chars, expected charset)", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);
  const expectedLength = Buffer.alloc(32).toString("base64url").length; // 32 raw bytes -> 43 base64url chars, no padding
  assert.equal(link.token.length, expectedLength);
  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/, "must be exactly the base64url charset, no padding characters");
});

// ---- D. reuse of an existing, still-valid link ----
test("a second call for the same quote reuses the same, still-valid link (same id, same token)", async () => {
  const quote = await makeClientAndQuote();
  const first = await createOrGetQuoteAccessLink(quote.id);
  const second = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(second.id, first.id);
  assert.equal(second.token, first.token);
  const rows = await linkRowFor(quote.id);
  assert.equal(rows.length, 1, "no duplicate row should ever accumulate for the same quote");
});

test("a revoked link is NOT reused — a fresh one is minted instead", async () => {
  const quote = await makeClientAndQuote();
  const first = await createOrGetQuoteAccessLink(quote.id);
  await db.update(crmQuoteAccessLinks).set({ revokedAt: new Date() }).where(eq(crmQuoteAccessLinks.id, first.id));

  const second = await createOrGetQuoteAccessLink(quote.id);
  assert.notEqual(second.token, first.token);
  assert.equal(second.revokedAt, null, "the replacement link must not itself be pre-revoked");
});

test("an expired link is NOT reused — a fresh one is minted, expiry recomputed from the quote's current validUntil", async () => {
  const quote = await makeClientAndQuote({ validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
  const first = await createOrGetQuoteAccessLink(quote.id);
  await db.update(crmQuoteAccessLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(crmQuoteAccessLinks.id, first.id));

  const second = await createOrGetQuoteAccessLink(quote.id);
  assert.notEqual(second.token, first.token);
  assert.ok(second.expiresAt && second.expiresAt.getTime() > Date.now(), "the fresh link's expiry must be recomputed from the quote's own validUntil, not left in the past");
});

test("expiresAt is populated from the quote's validUntil when set", async () => {
  const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const quote = await makeClientAndQuote({ validUntil });
  const link = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(link.expiresAt?.getTime(), validUntil.getTime());
});

test("expiresAt stays null when the quote has no validUntil — never a fabricated duration", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(link.expiresAt, null);
});

// ---- E. nonexistent quote rejected ----
test("createOrGetQuoteAccessLink rejects a nonexistent quote id and creates no link", async () => {
  await assert.rejects(() => createOrGetQuoteAccessLink(randomUUID()));
});

// ---- F. unknown token rejected cleanly ----
test("resolveQuoteByToken rejects an unknown token", async () => {
  const result = await resolveQuoteByToken("this-token-does-not-exist-anywhere-000000");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_found");
});

// ---- G. revoked token rejected ----
test("resolveQuoteByToken rejects a revoked token", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);
  await db.update(crmQuoteAccessLinks).set({ revokedAt: new Date() }).where(eq(crmQuoteAccessLinks.id, link.id));

  const result = await resolveQuoteByToken(link.token);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "revoked");
});

// ---- H. expired token rejected ----
test("resolveQuoteByToken rejects an expired token", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);
  await db.update(crmQuoteAccessLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(crmQuoteAccessLinks.id, link.id));

  const result = await resolveQuoteByToken(link.token);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired");
});

test("resolveQuoteByToken succeeds for a valid, non-expired, non-revoked token and returns the quote", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);

  const result = await resolveQuoteByToken(link.token);
  assert.equal(result.ok, true);
  assert.equal(result.quote.id, quote.id);
});

// ---- I. deleting the quote cascades the link away ----
test("deleting a quote cascades its access link (ON DELETE CASCADE)", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);
  createdQuoteIds.delete(quote.id); // deleted explicitly by this test, not by after()

  await db.delete(crmQuotes).where(eq(crmQuotes.id, quote.id));

  const [row] = await db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.id, link.id));
  assert.equal(row, undefined, "the access link row must be gone once its quote is deleted");
});

// ---- J. no mutation of crmQuotes.status/sentAt/respondedAt ----
test("creating and resolving an access link never touches crmQuotes.status/sentAt/respondedAt", async () => {
  const quote = await makeClientAndQuote();
  const before_ = await db.select({ status: crmQuotes.status, sentAt: crmQuotes.sentAt, respondedAt: crmQuotes.respondedAt }).from(crmQuotes).where(eq(crmQuotes.id, quote.id));

  const link = await createOrGetQuoteAccessLink(quote.id);
  await resolveQuoteByToken(link.token);

  const after_ = await db.select({ status: crmQuotes.status, sentAt: crmQuotes.sentAt, respondedAt: crmQuotes.respondedAt }).from(crmQuotes).where(eq(crmQuotes.id, quote.id));
  assert.deepEqual(after_, before_);
});

// ---- K. no Catalogue/price data touched (structural — this module never imports/queries services/service_market_offers) ----
test("this module has zero references to Catalogue/pricing tables (source-level guarantee)", async () => {
  const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("./crm-quote-access.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /services|service_market_offers|serviceMarketOffers|unitPriceCents/i);
});

// ---- L. rate limit present on public resolution ----
test("resolveQuoteByToken enforces a rate limit on repeated calls (dedicated scope, not shared with invoices)", async () => {
  const quote = await makeClientAndQuote();
  const link = await createOrGetQuoteAccessLink(quote.id);

  let sawRateLimited = false;
  for (let i = 0; i < 35; i++) {
    const result = await resolveQuoteByToken(link.token);
    if (!result.ok && result.reason === "rate_limited") {
      sawRateLimited = true;
      break;
    }
  }
  assert.ok(sawRateLimited, "expected rate_limited within 35 calls given a 30-per-5min window");
});
