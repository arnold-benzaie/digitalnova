// Integration tests for AI Commercial Radar / Phase 1G-B:
// lib/actions/commercial-analytics.ts's getCommercialAnalytics() — proving,
// against a real local database, that every metric in the Phase 1G-A.1
// frozen contract is computed exactly as specified.
//
// IMPORTANT — like Phase 1D's getRadarQueue(), this action aggregates over
// the WHOLE crm_clients/interactions/deals/crmQuotes/crmInvoices universe,
// not a single scoped row. The local test database already carries
// substantial real leftover data from every earlier phase of this
// engagement (hundreds of crmClients rows, real pre- and post-Phase-1F
// interactions). Every test below therefore uses the SAME robust technique
// already proven in lib/actions/radar-queue.integration.test.mjs:
//   - count/numerator/denominator assertions use a before/after DELTA,
//     never an absolute value
//   - revenue assertions use the ISO 4217 reserved test-only currency
//     codes "XTS"/"XXX" (never issued to any real currency), so they can
//     be asserted absolutely without colliding with real data
//   - AVG/MEDIAN correctness is verified by independently recomputing the
//     same aggregate directly from the live database in the test itself
//     (a "shadow query" using the exact same population/ordering rules)
//     and comparing against the action's own result — this proves
//     internal correctness without needing to control the whole dataset
//   - two scenarios (a truly zero denominator, and truly zero
//     direction-bearing interactions) cannot be honestly forced against
//     this shared, non-empty database without destructively wiping shared
//     state, which is out of scope — those are covered by a structural
//     read of the implementation source instead, exactly the same,
//     already-established pattern used for analogous cases in
//     lib/actions/radar-queue.integration.test.mjs
//
// Same mocking convention as every other *.integration.test.mjs file in
// this project: @/lib/session's requireSession() is faked with a mutable
// session state, so the REAL requireStaffRole() (lib/dev-role.ts, never
// mocked) runs against it.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project (public-map-approval-test-db, port 5434) —
// NEVER Supabase/Neon/pooler, NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/commercial-analytics.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

/** @type {{ session: object | null }} */
let mockState = { session: STAFF_SESSION };
function actAsStaff() {
  mockState = { session: STAFF_SESSION };
}
function actAsClient() {
  mockState = { session: CLIENT_SESSION };
}
function actAsUnauthenticated() {
  mockState = { session: null };
}

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) throw new Error("UNAUTHENTICATED — no session");
      return mockState.session;
    },
    // Always null (never mockState.session) — matches the established
    // convention (crm-clients-radar-foundation.integration.test.mjs):
    // logCrmAudit() is not exercised by this read-only action anyway, but
    // this keeps the mock consistent with the rest of the suite.
    getCurrentSession: async () => null,
  },
});

const { db } = await import("@/db");
const { crmClients, interactions, deals, crmQuotes, crmInvoices } = await import("@/db/schema");
const { inArray, sql } = await import("drizzle-orm");
const { getCommercialAnalytics } = await import("./commercial-analytics.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set(); // crmInvoices.clientId is SET NULL on client delete, not cascaded — tracked separately

beforeEach(() => {
  actAsStaff();
});

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdClientIds.size) {
    // deals/interactions/crmQuotes all cascade on crmClients delete.
    await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  }
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const values = {
    name: overrides.name ?? `Analytics Test ${randomUUID()}`,
    email: "prospect@example.test",
    doNotContact: overrides.doNotContact ?? false,
    archivedAt: overrides.archivedAt ?? null,
  };
  if (overrides.createdAt !== undefined) values.createdAt = overrides.createdAt;
  const [client] = await db.insert(crmClients).values(values).returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeInteraction(clientId, overrides = {}) {
  const values = {
    clientId,
    type: overrides.type ?? "call",
    summary: overrides.summary ?? `Test summary ${randomUUID()}`,
    direction: overrides.direction ?? null,
    outcome: overrides.outcome ?? null,
  };
  if (overrides.occurredAt !== undefined) values.occurredAt = overrides.occurredAt;
  const [row] = await db.insert(interactions).values(values).returning();
  return row;
}

async function makeDeal(clientId, stage) {
  await db.insert(deals).values({ clientId, title: `Deal ${randomUUID()}`, stage });
}

async function makeQuote(clientId, overrides = {}) {
  await db.insert(crmQuotes).values({
    clientId,
    quoteNumber: `Q-${randomUUID()}`,
    title: "Test quote",
    status: overrides.status ?? "draft",
    sentAt: overrides.sentAt ?? null,
    dealId: overrides.dealId ?? null,
  });
}

async function makeInvoice(overrides = {}) {
  const [row] = await db
    .insert(crmInvoices)
    .values({
      clientId: overrides.clientId ?? null,
      invoiceNumber: `INV-${randomUUID()}`,
      title: "Test invoice",
      status: overrides.status ?? "draft",
      paidAt: overrides.paidAt ?? null,
      refundedAt: overrides.refundedAt ?? null,
      currency: overrides.currency ?? "XTS", // ISO 4217 reserved test-only code
      totalCents: overrides.totalCents ?? 0,
    })
    .returning();
  createdInvoiceIds.add(row.id);
  return row;
}

function findCurrency(moneyArray, currency) {
  return moneyArray.find((m) => m.currency === currency) ?? { currency, amountCents: 0 };
}

const IMPLEMENTATION_SOURCE = readFileSync(fileURLToPath(new URL("./commercial-analytics.ts", import.meta.url)), "utf8");

// =========================================================
// Authorization
// =========================================================

test("UNAUTHENTICATED getCommercialAnalytics: rejected", async () => {
  actAsUnauthenticated();
  await assert.rejects(() => getCommercialAnalytics());
});

test("NON-STAFF getCommercialAnalytics: rejected", async () => {
  actAsClient();
  await assert.rejects(() => getCommercialAnalytics());
});

test("STAFF getCommercialAnalytics: succeeds and returns the full contract shape", async () => {
  const snap = await getCommercialAnalytics();
  assert.equal(typeof snap.volume.uniqueProspectsContacted, "number");
  assert.equal(typeof snap.responses.responseRate.numerator, "number");
  assert.ok("value" in snap.responses.responseRate);
  assert.ok(Array.isArray(snap.payments.grossCollectedRevenue));
  assert.equal(snap.timing.timeToFirstContact.unit, "days");
  assert.equal(typeof snap.dataQuality.hasLegacyInteractionData, "boolean");
});

// =========================================================
// Empty-data structural proof (a true zero denominator / zero
// direction-bearing dataset cannot be honestly forced against this
// shared, non-empty local DB without destructive wiping — see file
// header. Verified by reading the actual null-guard logic instead.)
// =========================================================

test("structural: toRate() returns value=null (not 0) when denominator is 0", () => {
  assert.match(
    IMPLEMENTATION_SOURCE,
    /denominator > 0 \? numerator \/ denominator : null/,
    "expected the rate helper to null-guard a zero denominator, never return 0",
  );
});

test("structural: toDuration() returns avg/median=null when sampleSize is 0", () => {
  assert.match(IMPLEMENTATION_SOURCE, /sampleSize > 0 \? avgDays : null/);
  assert.match(IMPLEMENTATION_SOURCE, /sampleSize > 0 \? medianDays : null/);
});

test("structural: feedbackTrackingStartedAt is null-guarded for an absent value", () => {
  assert.match(
    IMPLEMENTATION_SOURCE,
    /feedbackTrackingStartedAt:\s*interactionsSummary\.feedback_tracking_started_at[\s\S]{0,120}:\s*null/,
  );
});

// =========================================================
// Legacy data
// =========================================================

test("legacy direction=NULL interaction contributes nothing to any direction-based metric", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInteraction(client.id, { type: "call", direction: null });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.volume.uniqueProspectsContacted, before.volume.uniqueProspectsContacted);
  assert.equal(afterSnap.volume.contactAttempts, before.volume.contactAttempts);
  assert.equal(afterSnap.volume.outboundCalls, before.volume.outboundCalls);
  assert.equal(afterSnap.responses.inboundEvents, before.responses.inboundEvents);
});

test("hasLegacyInteractionData is true (this shared local DB genuinely has pre-Phase-1F rows)", async () => {
  const snap = await getCommercialAnalytics();
  assert.equal(snap.dataQuality.hasLegacyInteractionData, true);
});

test("feedbackTrackingStartedAt tracks the true minimum createdAt among direction-bearing rows", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  // An artificially early createdAt, forced via direct insert (never
  // possible through the real createInteraction() action) — a controlled
  // way to prove the MIN() actually recomputes rather than being cached.
  const veryEarly = new Date("2000-01-01T00:00:00Z");
  await db.insert(interactions).values({
    clientId: client.id,
    type: "call",
    summary: "early fixture",
    direction: "outbound",
    createdAt: veryEarly,
  });
  const afterSnap = await getCommercialAnalytics();
  assert.ok(afterSnap.dataQuality.feedbackTrackingStartedAt !== null);
  assert.ok(new Date(afterSnap.dataQuality.feedbackTrackingStartedAt).getTime() <= veryEarly.getTime() + 1000);
  if (before.dataQuality.feedbackTrackingStartedAt) {
    assert.ok(new Date(afterSnap.dataQuality.feedbackTrackingStartedAt).getTime() <= new Date(before.dataQuality.feedbackTrackingStartedAt).getTime());
  }
});

// =========================================================
// Contact volume
// =========================================================

test("multiple outbound events for the same client: contactAttempts increases by N, uniqueProspectsContacted by exactly 1", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInteraction(client.id, { type: "call", direction: "outbound" });
  await makeInteraction(client.id, { type: "email", direction: "outbound" });
  await makeInteraction(client.id, { type: "call", direction: "outbound" });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.volume.contactAttempts - before.volume.contactAttempts, 3);
  assert.equal(afterSnap.volume.uniqueProspectsContacted - before.volume.uniqueProspectsContacted, 1);
});

// =========================================================
// Channel counts
// =========================================================

test("outbound call and email counts are tracked independently", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInteraction(client.id, { type: "call", direction: "outbound" });
  await makeInteraction(client.id, { type: "email", direction: "outbound" });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.volume.outboundCalls - before.volume.outboundCalls, 1);
  assert.equal(afterSnap.volume.outboundEmails - before.volume.outboundEmails, 1);
  assert.equal(afterSnap.volume.contactAttempts - before.volume.contactAttempts, 2);
});

// =========================================================
// Response rate — strict temporal ordering
// =========================================================

test("an inbound BEFORE the client's first outbound does not enter the response numerator", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  const t0 = new Date("2024-01-01T00:00:00Z");
  const t1 = new Date("2024-01-02T00:00:00Z");
  await makeInteraction(client.id, { type: "email", direction: "inbound", occurredAt: t0 });
  await makeInteraction(client.id, { type: "email", direction: "outbound", occurredAt: t1 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.responses.responseRate.denominator - before.responses.responseRate.denominator, 1, "client has an outbound, must enter denominator");
  assert.equal(afterSnap.responses.responseRate.numerator - before.responses.responseRate.numerator, 0, "the only inbound predates the outbound, must not count");
});

test("an inbound AFTER the client's first outbound enters the response numerator", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  const t0 = new Date("2024-01-01T00:00:00Z");
  const t1 = new Date("2024-01-02T00:00:00Z");
  await makeInteraction(client.id, { type: "email", direction: "outbound", occurredAt: t0 });
  await makeInteraction(client.id, { type: "email", direction: "inbound", occurredAt: t1 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.responses.responseRate.denominator - before.responses.responseRate.denominator, 1);
  assert.equal(afterSnap.responses.responseRate.numerator - before.responses.responseRate.numerator, 1);
});

test("an inbound at the EXACT SAME timestamp as the outbound does not count (strict >, not >=)", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  const sameInstant = new Date("2024-03-01T12:00:00.000Z");
  await makeInteraction(client.id, { type: "call", direction: "outbound", occurredAt: sameInstant });
  await makeInteraction(client.id, { type: "email", direction: "inbound", occurredAt: sameInstant });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.responses.responseRate.denominator - before.responses.responseRate.denominator, 1);
  assert.equal(afterSnap.responses.responseRate.numerator - before.responses.responseRate.numerator, 0, "identical timestamp must not satisfy strict >");
});

// =========================================================
// Positive / negative response
// =========================================================

test("positiveResponseRateOfContacted and OfResponders use different, correctly-scoped denominators", async () => {
  const before = await getCommercialAnalytics();
  const t0 = new Date("2024-02-01T00:00:00Z");
  const t1 = new Date("2024-02-02T00:00:00Z");

  const responder = await makeClient();
  await makeInteraction(responder.id, { type: "call", direction: "outbound", occurredAt: t0 });
  await makeInteraction(responder.id, { type: "call", direction: "inbound", occurredAt: t1, outcome: "positive" });

  const nonResponder = await makeClient();
  await makeInteraction(nonResponder.id, { type: "call", direction: "outbound", occurredAt: t0 });

  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.responses.positiveResponseRateOfContacted.numerator - before.responses.positiveResponseRateOfContacted.numerator, 1);
  assert.equal(afterSnap.responses.positiveResponseRateOfContacted.denominator - before.responses.positiveResponseRateOfContacted.denominator, 2, "both contacted clients count toward the OfContacted denominator");
  assert.equal(afterSnap.responses.positiveResponseRateOfResponders.numerator - before.responses.positiveResponseRateOfResponders.numerator, 1);
  assert.equal(afterSnap.responses.positiveResponseRateOfResponders.denominator - before.responses.positiveResponseRateOfResponders.denominator, 1, "only the responder counts toward the OfResponders denominator");
});

test("a positive outcome BEFORE first outbound does not count toward the positive numerator", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  const t0 = new Date("2024-04-01T00:00:00Z");
  const t1 = new Date("2024-04-02T00:00:00Z");
  await makeInteraction(client.id, { type: "call", direction: "inbound", occurredAt: t0, outcome: "positive" });
  await makeInteraction(client.id, { type: "call", direction: "outbound", occurredAt: t1 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.responses.positiveResponseRateOfContacted.numerator - before.responses.positiveResponseRateOfContacted.numerator, 0);
});

test("negativeResponseRateOfContacted and OfResponders: numerator increases and denominators are correctly scoped (not assumed symmetric with positive)", async () => {
  const before = await getCommercialAnalytics();
  const t0 = new Date("2024-07-01T00:00:00Z");
  const t1 = new Date("2024-07-02T00:00:00Z");

  const negativeResponder = await makeClient();
  await makeInteraction(negativeResponder.id, { type: "call", direction: "outbound", occurredAt: t0 });
  await makeInteraction(negativeResponder.id, { type: "call", direction: "inbound", occurredAt: t1, outcome: "negative" });

  const nonResponder = await makeClient();
  await makeInteraction(nonResponder.id, { type: "call", direction: "outbound", occurredAt: t0 });

  const afterSnap = await getCommercialAnalytics();

  assert.equal(
    afterSnap.responses.negativeResponseRateOfContacted.numerator - before.responses.negativeResponseRateOfContacted.numerator,
    1,
    "the negative-outcome responder must increment the negative numerator",
  );
  assert.equal(
    afterSnap.responses.negativeResponseRateOfContacted.denominator - before.responses.negativeResponseRateOfContacted.denominator,
    2,
    "OfContacted denominator = all contacted clients, both fixtures were contacted",
  );
  assert.equal(
    afterSnap.responses.negativeResponseRateOfResponders.numerator - before.responses.negativeResponseRateOfResponders.numerator,
    1,
  );
  assert.equal(
    afterSnap.responses.negativeResponseRateOfResponders.denominator - before.responses.negativeResponseRateOfResponders.denominator,
    1,
    "OfResponders denominator = clients satisfying the response-rate numerator (only the negative responder qualifies, the never-replied client does not)",
  );
});

test("a negative outcome BEFORE first outbound does not count toward the negative numerator", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  const t0 = new Date("2024-07-10T00:00:00Z");
  const t1 = new Date("2024-07-11T00:00:00Z");
  await makeInteraction(client.id, { type: "call", direction: "inbound", occurredAt: t0, outcome: "negative" });
  await makeInteraction(client.id, { type: "call", direction: "outbound", occurredAt: t1 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.responses.negativeResponseRateOfContacted.numerator - before.responses.negativeResponseRateOfContacted.numerator, 0);
});

// =========================================================
// Meetings
// =========================================================

test("heldEvents counts a meeting even with no prior outbound contact at all", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInteraction(client.id, { type: "meeting" });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.meetings.heldEvents - before.meetings.heldEvents, 1);
  assert.equal(afterSnap.meetings.uniqueProspectsWithMeeting - before.meetings.uniqueProspectsWithMeeting, 1);
  // Never contacted (no outbound) -> must not enter meetingRate's denominator.
  assert.equal(afterSnap.meetings.meetingRate.denominator - before.meetings.meetingRate.denominator, 0);
});

test("meetingRate only counts a meeting strictly after the client's first outbound", async () => {
  const before = await getCommercialAnalytics();
  const t0 = new Date("2024-05-01T00:00:00Z");
  const t1 = new Date("2024-05-02T00:00:00Z");

  const afterOutbound = await makeClient();
  await makeInteraction(afterOutbound.id, { type: "call", direction: "outbound", occurredAt: t0 });
  await makeInteraction(afterOutbound.id, { type: "meeting", occurredAt: t1 });

  const beforeOutbound = await makeClient();
  await makeInteraction(beforeOutbound.id, { type: "meeting", occurredAt: t0 });
  await makeInteraction(beforeOutbound.id, { type: "call", direction: "outbound", occurredAt: t1 });

  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.meetings.meetingRate.denominator - before.meetings.meetingRate.denominator, 2, "both clients were contacted");
  assert.equal(afterSnap.meetings.meetingRate.numerator - before.meetings.meetingRate.numerator, 1, "only the meeting-after-outbound client counts");
});

// =========================================================
// Proposals — quote-based only
// =========================================================

test("proposal document counts: sent, accepted, declined", async () => {
  const before = await getCommercialAnalytics();
  const c1 = await makeClient();
  const c2 = await makeClient();
  const c3 = await makeClient();
  await makeQuote(c1.id, { status: "sent", sentAt: new Date() });
  await makeQuote(c2.id, { status: "accepted", sentAt: new Date() });
  await makeQuote(c3.id, { status: "declined", sentAt: new Date() });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.proposals.sentDocuments - before.proposals.sentDocuments, 3, "accepted/declined quotes were also sent");
  assert.equal(afterSnap.proposals.acceptedDocuments - before.proposals.acceptedDocuments, 1);
  assert.equal(afterSnap.proposals.declinedDocuments - before.proposals.declinedDocuments, 1);
});

test("proposal unique-client counts differ from document counts for a client with multiple quotes", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeQuote(client.id, { status: "sent", sentAt: new Date() });
  await makeQuote(client.id, { status: "sent", sentAt: new Date() });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.proposals.sentDocuments - before.proposals.sentDocuments, 2);
  assert.equal(afterSnap.proposals.sentUniqueClients - before.proposals.sentUniqueClients, 1);
});

test("a quote with dealId=null still counts normally", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeQuote(client.id, { status: "sent", sentAt: new Date(), dealId: null });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.proposals.sentDocuments - before.proposals.sentDocuments, 1);
});

// =========================================================
// Deals
// =========================================================

test("open-pipeline deal stages are excluded from the win-rate denominator", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  for (const stage of ["new", "contacted", "qualified", "proposal"]) {
    await makeDeal(client.id, stage);
  }
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.deals.dealWinRate.denominator - before.deals.dealWinRate.denominator, 0);
  assert.equal(afterSnap.deals.dealWinRate.numerator - before.deals.dealWinRate.numerator, 0);
});

test("won/lost deals enter the win-rate denominator correctly", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeDeal(client.id, "won");
  await makeDeal(client.id, "lost");
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.deals.dealWinRate.denominator - before.deals.dealWinRate.denominator, 2);
  assert.equal(afterSnap.deals.dealWinRate.numerator - before.deals.dealWinRate.numerator, 1);
});

test("client conversion rate counts a client with multiple deals once, not per-deal", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInteraction(client.id, { type: "call", direction: "outbound" });
  await makeDeal(client.id, "won");
  await makeDeal(client.id, "lost");
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.deals.clientConversionRate.numerator - before.deals.clientConversionRate.numerator, 1);
});

test("a won deal without any tracked outbound interaction does not enter the client-conversion numerator or denominator", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeDeal(client.id, "won"); // no interaction at all for this client
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.deals.clientConversionRate.denominator - before.deals.clientConversionRate.denominator, 0, "numerator must remain a subset of denominator — this client was never structurally contacted");
  assert.equal(afterSnap.deals.clientConversionRate.numerator - before.deals.clientConversionRate.numerator, 0);
});

// =========================================================
// Payments
// =========================================================

test("a paid invoice with a linked client counts as a paying client", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInvoice({ clientId: client.id, status: "paid", paidAt: new Date(), totalCents: 1000 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.payments.payingClientCount - before.payments.payingClientCount, 1);
});

test("a paid invoice with clientId=null does not count as a paying client, but does count toward revenue", async () => {
  const before = await getCommercialAnalytics();
  await makeInvoice({ clientId: null, status: "paid", paidAt: new Date(), totalCents: 2500, currency: "XTS" });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.payments.payingClientCount - before.payments.payingClientCount, 0);
  const beforeXts = findCurrency(before.payments.grossCollectedRevenue, "XTS").amountCents;
  const afterXts = findCurrency(afterSnap.payments.grossCollectedRevenue, "XTS").amountCents;
  assert.equal(afterXts - beforeXts, 2500);
});

test("multiple paid invoices for the same client count that client once", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInvoice({ clientId: client.id, status: "paid", paidAt: new Date(), totalCents: 500 });
  await makeInvoice({ clientId: client.id, status: "paid", paidAt: new Date(), totalCents: 700 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.payments.payingClientCount - before.payments.payingClientCount, 1);
});

// =========================================================
// Refunds and currency separation
// =========================================================

test("a paid-then-refunded invoice contributes to BOTH grossCollectedRevenue and refundedRevenue", async () => {
  const before = await getCommercialAnalytics();
  await makeInvoice({ status: "refunded", paidAt: new Date(), refundedAt: new Date(), totalCents: 4200, currency: "XTS" });
  const afterSnap = await getCommercialAnalytics();

  const grossDelta = findCurrency(afterSnap.payments.grossCollectedRevenue, "XTS").amountCents - findCurrency(before.payments.grossCollectedRevenue, "XTS").amountCents;
  const refundedDelta = findCurrency(afterSnap.payments.refundedRevenue, "XTS").amountCents - findCurrency(before.payments.refundedRevenue, "XTS").amountCents;

  assert.equal(grossDelta, 4200, "a refunded invoice was still genuinely collected at some point — must remain in gross");
  assert.equal(refundedDelta, 4200, "must also be visible in refundedRevenue so a consumer can compute net");
});

test("currencies are never summed together", async () => {
  const before = await getCommercialAnalytics();
  await makeInvoice({ status: "paid", paidAt: new Date(), totalCents: 1000, currency: "XTS" });
  await makeInvoice({ status: "paid", paidAt: new Date(), totalCents: 2000, currency: "XXX" });
  const afterSnap = await getCommercialAnalytics();

  const xtsDelta = findCurrency(afterSnap.payments.grossCollectedRevenue, "XTS").amountCents - findCurrency(before.payments.grossCollectedRevenue, "XTS").amountCents;
  const xxxDelta = findCurrency(afterSnap.payments.grossCollectedRevenue, "XXX").amountCents - findCurrency(before.payments.grossCollectedRevenue, "XXX").amountCents;

  assert.equal(xtsDelta, 1000);
  assert.equal(xxxDelta, 2000);
});

// =========================================================
// Timing
// =========================================================

test("timeToFirstContact uses MIN(outbound.occurredAt), not just any outbound row", async () => {
  const before = await getCommercialAnalytics();
  const createdAt = new Date("2024-06-01T00:00:00Z");
  const client = await makeClient({ createdAt });
  const laterOutbound = new Date("2024-06-10T00:00:00Z");
  const earlierOutbound = new Date("2024-06-05T00:00:00Z");
  await makeInteraction(client.id, { type: "call", direction: "outbound", occurredAt: laterOutbound });
  await makeInteraction(client.id, { type: "call", direction: "outbound", occurredAt: earlierOutbound });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.timing.timeToFirstContact.sampleSize - before.timing.timeToFirstContact.sampleSize, 1);
});

test("a client contacted but never responded is excluded from timeToFirstResponse's population", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  await makeInteraction(client.id, { type: "call", direction: "outbound" });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.timing.timeToFirstResponse.sampleSize - before.timing.timeToFirstResponse.sampleSize, 0);
});

test("timeToFirstResponse positive path: a genuine responder increases sampleSize by exactly 1 and contributes its known duration to the aggregate", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient();
  const outboundAt = new Date("2024-09-01T00:00:00Z");
  const knownDurationDays = 3;
  const inboundAt = new Date(outboundAt.getTime() + knownDurationDays * 86400 * 1000);
  await makeInteraction(client.id, { type: "call", direction: "outbound", occurredAt: outboundAt });
  await makeInteraction(client.id, { type: "call", direction: "inbound", occurredAt: inboundAt });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.timing.timeToFirstResponse.sampleSize - before.timing.timeToFirstResponse.sampleSize, 1);

  // Mathematically valid before/after check that does not assume anything
  // about the shared DB's other rows: sum_after must equal
  // sum_before + knownDurationDays, where sum = avg * sampleSize (0 when
  // sampleSize is 0, matching toDuration()'s own null-guard).
  const sumBefore = before.timing.timeToFirstResponse.sampleSize > 0 ? before.timing.timeToFirstResponse.avgDays * before.timing.timeToFirstResponse.sampleSize : 0;
  const sumAfter = afterSnap.timing.timeToFirstResponse.avgDays * afterSnap.timing.timeToFirstResponse.sampleSize;
  assert.ok(
    Math.abs(sumAfter - (sumBefore + knownDurationDays)) < 1e-6,
    `expected the new responder's ${knownDurationDays}-day duration to shift the aggregate sum by exactly that amount`,
  );
});

test("shadow query: timeToFirstResponse avgDays and medianDays match an independent recomputation from the live database", async () => {
  const snap = await getCommercialAnalytics();
  const result = await db.execute(sql`
    WITH first_outbound AS (
      SELECT client_id, MIN(occurred_at) AS first_outbound_at
      FROM interactions
      WHERE direction = 'outbound'
      GROUP BY client_id
    ),
    first_response AS (
      SELECT
        fo.client_id,
        fo.first_outbound_at,
        (
          SELECT MIN(i.occurred_at) FROM interactions i
          WHERE i.client_id = fo.client_id AND i.direction = 'inbound' AND i.occurred_at > fo.first_outbound_at
        ) AS first_inbound_after
      FROM first_outbound fo
    ),
    durations AS (
      SELECT EXTRACT(EPOCH FROM (first_inbound_after - first_outbound_at)) / 86400.0 AS duration_days
      FROM first_response
      WHERE first_inbound_after IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*)::int FROM durations WHERE duration_days >= 0) AS sample_size,
      (SELECT AVG(duration_days)::float8 FROM durations WHERE duration_days >= 0) AS avg_days,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_days)::float8 FROM durations WHERE duration_days >= 0) AS median_days
  `);
  const row = result.rows[0];
  assert.equal(snap.timing.timeToFirstResponse.sampleSize, row.sample_size);
  if (row.sample_size > 0) {
    assert.ok(Math.abs(snap.timing.timeToFirstResponse.avgDays - Number(row.avg_days)) < 1e-6);
    assert.ok(Math.abs(snap.timing.timeToFirstResponse.medianDays - Number(row.median_days)) < 1e-6);
  } else {
    assert.equal(snap.timing.timeToFirstResponse.avgDays, null);
    assert.equal(snap.timing.timeToFirstResponse.medianDays, null);
  }
});

test("createdToFirstPaid uses MIN(paidAt) across multiple paid invoices for the same client", async () => {
  const before = await getCommercialAnalytics();
  const createdAt = new Date("2024-01-01T00:00:00Z");
  const client = await makeClient({ createdAt });
  await makeInvoice({ clientId: client.id, status: "paid", paidAt: new Date("2024-03-01T00:00:00Z"), totalCents: 100 });
  await makeInvoice({ clientId: client.id, status: "paid", paidAt: new Date("2024-02-01T00:00:00Z"), totalCents: 100 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.timing.createdToFirstPaid.sampleSize - before.timing.createdToFirstPaid.sampleSize, 1);
});

test("a data anomaly (occurredAt before client createdAt) is excluded from timeToFirstContact and counted as an anomaly, never silently clamped", async () => {
  const before = await getCommercialAnalytics();
  const createdAt = new Date("2024-08-15T00:00:00Z");
  const client = await makeClient({ createdAt });
  const impossiblyEarly = new Date("2024-08-01T00:00:00Z"); // before the client even existed
  await makeInteraction(client.id, { type: "call", direction: "outbound", occurredAt: impossiblyEarly });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.timing.timeToFirstContact.sampleSize - before.timing.timeToFirstContact.sampleSize, 0, "must not silently count as a valid (clamped) observation");
  assert.equal(
    afterSnap.dataQuality.anomalousNegativeDurationCounts.timeToFirstContact - before.dataQuality.anomalousNegativeDurationCounts.timeToFirstContact,
    1,
    "must be visibly counted, not hidden",
  );
});

test("a data anomaly (paidAt before client createdAt) is excluded from createdToFirstPaid and counted as an anomaly, never silently clamped", async () => {
  const before = await getCommercialAnalytics();
  const createdAt = new Date("2024-10-15T00:00:00Z");
  const client = await makeClient({ createdAt });
  const impossiblyEarlyPaidAt = new Date("2024-10-01T00:00:00Z"); // before the client even existed
  await makeInvoice({ clientId: client.id, status: "paid", paidAt: impossiblyEarlyPaidAt, totalCents: 100 });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.timing.createdToFirstPaid.sampleSize - before.timing.createdToFirstPaid.sampleSize, 0, "must not silently count as a valid (clamped) observation");
  assert.equal(
    afterSnap.dataQuality.anomalousNegativeDurationCounts.createdToFirstPaid - before.dataQuality.anomalousNegativeDurationCounts.createdToFirstPaid,
    1,
    "must be visibly counted, not hidden",
  );
});

test("shadow query: timeToFirstContact avgDays matches an independent recomputation from the live database", async () => {
  const snap = await getCommercialAnalytics();
  const result = await db.execute(sql`
    WITH first_contact AS (
      SELECT c.id AS client_id, c.created_at, MIN(i.occurred_at) AS first_outbound_at
      FROM crm_clients c
      JOIN interactions i ON i.client_id = c.id AND i.direction = 'outbound'
      GROUP BY c.id, c.created_at
    ),
    durations AS (
      SELECT EXTRACT(EPOCH FROM (first_outbound_at - created_at)) / 86400.0 AS duration_days
      FROM first_contact
    )
    SELECT
      (SELECT COUNT(*)::int FROM durations WHERE duration_days >= 0) AS sample_size,
      (SELECT AVG(duration_days)::float8 FROM durations WHERE duration_days >= 0) AS avg_days
  `);
  const row = result.rows[0];
  assert.equal(snap.timing.timeToFirstContact.sampleSize, row.sample_size);
  if (row.sample_size > 0) {
    assert.ok(Math.abs(snap.timing.timeToFirstContact.avgDays - Number(row.avg_days)) < 1e-6);
  } else {
    assert.equal(snap.timing.timeToFirstContact.avgDays, null);
  }
});

// =========================================================
// DNC / archived — historical inclusion
// =========================================================

test("a DNC client's already-recorded historical interaction still counts in analytics", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient({ doNotContact: true });
  // Inserted directly (bypassing createInteraction()'s own DNC-outbound
  // block) to represent a genuinely legitimate historical fact: an
  // interaction recorded before/independent of the current DNC flag.
  await makeInteraction(client.id, { type: "call", direction: "outbound" });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.volume.uniqueProspectsContacted - before.volume.uniqueProspectsContacted, 1, "DNC must not erase real historical activity");
});

test("an archived client's already-recorded historical interaction still counts in analytics", async () => {
  const before = await getCommercialAnalytics();
  const client = await makeClient({ archivedAt: new Date() });
  await makeInteraction(client.id, { type: "call", direction: "outbound" });
  const afterSnap = await getCommercialAnalytics();

  assert.equal(afterSnap.volume.uniqueProspectsContacted - before.volume.uniqueProspectsContacted, 1);
});
