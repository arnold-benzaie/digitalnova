// Integration tests for AI Commercial Radar / Phase 1C:
// lib/actions/radar.ts's getProspectQualification() — proving, against a
// real local database, that:
// - requireStaffRole() genuinely gates the action (unauthenticated and
//   non-staff callers are rejected at runtime, not just by a page-level
//   guard);
// - the strongest possible commercial signal (a proposal-stage deal)
//   never overrides a doNotContact=true hard block — the opportunity
//   engine is never even invoked for an ineligible prospect;
// - missing data never becomes a fabricated negative fact, end to end
//   through the real Server Action wiring, not just the isolated pure
//   functions already covered by lib/radar/qualification.test.mjs and
//   lib/radar/score.test.mjs.
//
// Same mocking convention as crm-clients-radar-foundation.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session state
// (actAsStaff()/actAsClient()/actAsUnauthenticated()), so the REAL
// requireStaffRole() (lib/dev-role.ts, never mocked) runs against it.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-qualification.integration.test.mjs
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
    getCurrentSession: async () => null,
  },
});

const { db } = await import("@/db");
const { crmClients, deals, interactions, crmQuotes, crmInvoices } = await import("@/db/schema");
const { inArray } = await import("drizzle-orm");
const { getProspectQualification } = await import("./radar.ts");

const createdClientIds = new Set();

beforeEach(() => {
  actAsStaff();
});

after(async () => {
  if (createdClientIds.size) await db.delete(deals).where(inArray(deals.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(interactions).where(inArray(interactions.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const [client] = await db
    .insert(crmClients)
    .values({
      name: overrides.name === undefined ? `Radar P1C Test ${randomUUID()}` : overrides.name,
      email: overrides.email === undefined ? "prospect@example.test" : overrides.email,
      phone: overrides.phone ?? null,
      industry: overrides.industry ?? null,
      country: overrides.country ?? null,
      region: overrides.region ?? null,
      city: overrides.city ?? null,
      doNotContact: overrides.doNotContact ?? false,
      doNotContactReason: overrides.doNotContactReason ?? null,
      archivedAt: overrides.archivedAt ?? null,
    })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDeal(clientId, stage) {
  await db.insert(deals).values({ clientId, title: `Deal ${randomUUID()}`, stage });
}

async function makeQuote(clientId, { status, sentAt = null, respondedAt = null }) {
  await db.insert(crmQuotes).values({ clientId, quoteNumber: `Q-${randomUUID()}`, title: "Test quote", status, sentAt, respondedAt });
}

async function makeInvoice(clientId, { paidAt = null }) {
  await db.insert(crmInvoices).values({ clientId, invoiceNumber: `INV-${randomUUID()}`, title: "Test invoice", paidAt });
}

async function makeInteraction(clientId, occurredAt) {
  await db.insert(interactions).values({ clientId, type: "note", summary: "Test interaction", occurredAt });
}

// =========================================================
// Authorization — runtime proof, not textual checks
// =========================================================

test("UNAUTHENTICATED getProspectQualification: rejected", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => getProspectQualification(client.id));
});

test("NON-STAFF getProspectQualification: rejected", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => getProspectQualification(client.id));
});

test("STAFF getProspectQualification: succeeds for a simple qualified prospect", async () => {
  const client = await makeClient({ name: "Staff OK Test", email: "ok@example.test" });
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "QUALIFIED");
  assert.equal(result.eligibility.contactable, true);
  assert.ok(result.opportunity !== null);
});

// =========================================================
// Qualification / eligibility wiring
// =========================================================

test("a nonexistent clientId is rejected", async () => {
  await assert.rejects(() => getProspectQualification(randomUUID()));
});

test("INSUFFICIENT_DATA: name only, no email or phone — opportunity is never computed", async () => {
  const client = await makeClient({ email: null, phone: null });
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "INSUFFICIENT_DATA");
  assert.equal(result.opportunity, null);
});

test("NOT_ELIGIBLE: archived prospect — opportunity is never computed", async () => {
  const client = await makeClient({ archivedAt: new Date() });
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "NOT_ELIGIBLE");
  assert.equal(result.eligibility.contactable, false);
  assert.equal(result.opportunity, null);
});

// ---- THE critical Phase 1C requirement: strongest signal + doNotContact ----
test("doNotContact=true blocks even the strongest possible commercial signal (proposal-stage deal + accepted quote + paid invoice)", async () => {
  const client = await makeClient({ doNotContact: true, doNotContactReason: "Explicit opt-out on file" });
  await makeDeal(client.id, "proposal");
  await makeQuote(client.id, { status: "accepted", sentAt: new Date(), respondedAt: new Date() });
  await makeInvoice(client.id, { paidAt: new Date() });

  const result = await getProspectQualification(client.id);

  assert.equal(result.qualificationStatus, "NOT_ELIGIBLE");
  assert.equal(result.eligibility.contactable, false);
  assert.equal(result.eligibility.reason, "do_not_contact");
  assert.equal(result.opportunity, null, "the opportunity engine must never be invoked for a doNotContact=true prospect, no matter how strong the underlying signals are");
});

// =========================================================
// Opportunity wiring against real data
// =========================================================

test("a real proposal-stage deal produces HIGH priority end-to-end", async () => {
  const client = await makeClient();
  await makeDeal(client.id, "proposal");
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "QUALIFIED");
  assert.equal(result.opportunity.priority, "HIGH");
  assert.ok(result.opportunity.reasons.includes("Deal in progress at stage: proposal"));
});

test("HIGH priority + LOW confidence is representable end-to-end (proposal deal, no other profile data)", async () => {
  const client = await makeClient({ industry: null, country: null, region: null, city: null });
  await makeDeal(client.id, "proposal");
  const result = await getProspectQualification(client.id);
  assert.equal(result.opportunity.priority, "HIGH");
  assert.equal(result.opportunity.confidence, "LOW");
});

// =========================================================
// Anti-hallucination — real DB round trip
// =========================================================

test("null industry produces no industry-based reason (real row)", async () => {
  const client = await makeClient({ industry: null });
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => r.toLowerCase().includes("industry")));
});

test("null geography produces no location-based reason (real row)", async () => {
  const client = await makeClient({ country: null, region: null, city: null });
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => r.toLowerCase().includes("location")));
});

test("no interactions never produces a 'not interested' style claim (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(result.opportunity.reasons.includes("No logged interactions"));
  assert.ok(!result.opportunity.reasons.some((r) => /not interested|uninterested/i.test(r)));
});

test("no deal never produces a 'low intent' style claim (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => /low intent|not interested|unlikely/i.test(r)));
});

test("no quote never produces a fabricated proposal/accepted reason (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => /accepted|awaiting a response/i.test(r)));
});

test("no invoice never produces a fabricated conversion reason (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => /paid invoice/i.test(r)));
});

test("no service recommendation or predictive/probability language ever appears, across a fully-populated real prospect", async () => {
  const client = await makeClient({ industry: "Boulangerie", country: "France", city: "Lyon" });
  await makeDeal(client.id, "qualified");
  await makeQuote(client.id, { status: "sent", sentAt: new Date(), respondedAt: null });
  await makeInteraction(client.id, new Date());
  await makeInvoice(client.id, { paidAt: null });

  const result = await getProspectQualification(client.id);
  const allText = [result.opportunity.recommendedNextAction, ...result.opportunity.reasons].join(" ");

  assert.ok(!/potential fit|recommended service|local seo|google ads/i.test(allText), "no service recommendation may ever appear");
  assert.ok(!/%|percent|probability|likely to|will convert|expected to/i.test(allText), "no predictive/probability language may ever appear");
});

// =========================================================
// Determinism
// =========================================================

test("calling getProspectQualification twice for the same real prospect produces identical output", async () => {
  const client = await makeClient({ industry: "Santé", city: "Toulouse" });
  await makeDeal(client.id, "qualified");
  await makeQuote(client.id, { status: "sent", sentAt: new Date("2026-08-01T00:00:00Z"), respondedAt: null });

  const first = await getProspectQualification(client.id);
  const second = await getProspectQualification(client.id);
  assert.deepEqual(first, second);
});
