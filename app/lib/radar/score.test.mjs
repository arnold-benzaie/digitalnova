// Pure unit tests for lib/radar/score.ts's assessOpportunity(). Zero I/O,
// zero database, zero network — plain function over fixture data. This
// file must only ever be called for QUALIFIED prospects (enforced by the
// caller, lib/actions/radar.ts) — it has no knowledge of doNotContact or
// eligibility at all, by design.
// Run with: npx tsx --test lib/radar/score.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessOpportunity, RECENT_INTERACTION_THRESHOLD_DAYS } from "./score.ts";

const NOW = new Date("2026-08-28T12:00:00Z");

function base(overrides = {}) {
  return {
    industry: null,
    country: null,
    region: null,
    city: null,
    organizationId: null,
    deals: [],
    interactions: [],
    quotes: [],
    invoices: [],
    now: NOW,
    ...overrides,
  };
}

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

// ---- no commercial history ----
test("no commercial history at all: LOW priority, LOW confidence, grounded neutral reasons", () => {
  const result = assessOpportunity(base());
  assert.equal(result.priority, "LOW");
  assert.equal(result.confidence, "LOW");
  assert.ok(result.reasons.includes("No logged interactions"));
  assert.equal(result.recommendedNextAction, "Complete missing contact data");
});

// ---- deal stages ----
test("a deal at stage 'new' contributes LOW priority", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "new" }] }));
  assert.equal(result.priority, "LOW");
  assert.ok(result.reasons.includes("Deal in progress at stage: new"));
});

test("a deal at stage 'qualified' contributes MEDIUM priority", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "qualified" }] }));
  assert.equal(result.priority, "MEDIUM");
});

test("a deal at stage 'proposal' contributes HIGH priority", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "proposal" }] }));
  assert.equal(result.priority, "HIGH");
  assert.equal(result.recommendedNextAction, "Follow up on recorded proposal");
});

test("a deal at stage 'won' contributes HIGH priority, distinct reason text", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "won" }] }));
  assert.equal(result.priority, "HIGH");
  assert.ok(result.reasons.includes("A deal on record has been won"));
});

test("a deal at stage 'lost' contributes nothing — never read as negative, never credited", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "lost" }] }));
  assert.equal(result.priority, "LOW");
  assert.ok(!result.reasons.some((r) => r.includes("lost")), "no reason should ever mention the lost deal");
});

test("multiple deals: the best non-lost stage wins", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "lost" }, { stage: "new" }, { stage: "proposal" }] }));
  assert.equal(result.priority, "HIGH");
  assert.ok(result.reasons.includes("Deal in progress at stage: proposal"));
});

// ---- quote activity ----
test("an accepted quote contributes HIGH priority", () => {
  const result = assessOpportunity(base({ quotes: [{ status: "accepted", sentAt: daysAgo(10), respondedAt: daysAgo(5) }] }));
  assert.equal(result.priority, "HIGH");
  assert.ok(result.reasons.includes("A quote has been accepted"));
});

test("a sent quote with no response yet contributes MEDIUM priority", () => {
  const result = assessOpportunity(base({ quotes: [{ status: "sent", sentAt: daysAgo(2), respondedAt: null }] }));
  assert.equal(result.priority, "MEDIUM");
  assert.equal(result.recommendedNextAction, "Follow up on recorded proposal");
});

test("a declined/expired/draft quote (no active proposal) contributes LOW priority", () => {
  const result = assessOpportunity(base({ quotes: [{ status: "declined", sentAt: daysAgo(30), respondedAt: daysAgo(25) }] }));
  assert.equal(result.priority, "LOW");
  assert.ok(result.reasons.includes("Quote activity recorded, no active proposal"));
});

test("deal and quote signals both present: the higher tier wins", () => {
  const result = assessOpportunity(
    base({
      deals: [{ stage: "new" }], // LOW
      quotes: [{ status: "accepted", sentAt: daysAgo(10), respondedAt: daysAgo(5) }], // HIGH
    }),
  );
  assert.equal(result.priority, "HIGH");
});

// ---- interaction recency ----
test("a recent interaction (within the threshold) is labeled recent", () => {
  const result = assessOpportunity(base({ interactions: [{ occurredAt: daysAgo(RECENT_INTERACTION_THRESHOLD_DAYS - 1) }] }));
  assert.ok(result.reasons.includes("Recent interaction logged"));
});

test("a stale interaction (beyond the threshold) is labeled not recent", () => {
  const result = assessOpportunity(base({ interactions: [{ occurredAt: daysAgo(RECENT_INTERACTION_THRESHOLD_DAYS + 1) }] }));
  assert.ok(result.reasons.includes("Last logged interaction is not recent"));
});

test("the most recent of several interactions is the one evaluated", () => {
  const result = assessOpportunity(
    base({ interactions: [{ occurredAt: daysAgo(200) }, { occurredAt: daysAgo(1) }, { occurredAt: daysAgo(50) }] }),
  );
  assert.ok(result.reasons.includes("Recent interaction logged"));
  assert.equal(result.recommendedNextAction, "Review recent interaction");
});

// ---- known / unknown industry ----
test("known industry produces a grounded industry reason", () => {
  const result = assessOpportunity(base({ industry: "Boulangerie" }));
  assert.ok(result.reasons.includes("Industry recorded: Boulangerie"));
});

test("unknown (null) industry produces no industry-based reason at all", () => {
  const result = assessOpportunity(base({ industry: null }));
  assert.ok(!result.reasons.some((r) => r.toLowerCase().includes("industry")));
});

// ---- known / unknown geography ----
test("known geography (city only) produces a grounded location reason", () => {
  const result = assessOpportunity(base({ city: "Lyon" }));
  assert.ok(result.reasons.includes("Location recorded: Lyon"));
});

test("unknown geography (all null) produces no location-based reason at all", () => {
  const result = assessOpportunity(base({ country: null, region: null, city: null }));
  assert.ok(!result.reasons.some((r) => r.toLowerCase().includes("location")));
});

// ---- existing paid relationship ----
test("an existing paid invoice is surfaced as context but does not by itself raise priority", () => {
  const withPaid = assessOpportunity(base({ invoices: [{ paidAt: daysAgo(100) }] }));
  const withoutPaid = assessOpportunity(base({ invoices: [] }));
  assert.ok(withPaid.reasons.includes("Existing paid invoice on record"));
  assert.equal(withPaid.priority, withoutPaid.priority, "priority must be identical with/without a paid invoice when no deal/quote signal exists");
});

test("a linked organization is surfaced as context but does not by itself raise priority", () => {
  const withOrg = assessOpportunity(base({ organizationId: "org-1" }));
  const withoutOrg = assessOpportunity(base({ organizationId: null }));
  assert.ok(withOrg.reasons.includes("Already linked to a platform organization"));
  assert.equal(withOrg.priority, withoutOrg.priority);
});

// ---- HIGH priority + LOW confidence must be representable ----
test("HIGH priority + LOW confidence: a proposal-stage deal with almost no other profile data", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "proposal" }], industry: null, country: null, region: null, city: null }));
  assert.equal(result.priority, "HIGH");
  assert.equal(result.confidence, "LOW");
});

// ---- confidence must not automatically correlate with priority ----
test("LOW priority + HIGH confidence: a fully-profiled prospect with no deal/quote activity yet", () => {
  const result = assessOpportunity(base({ industry: "Restauration", country: "France", city: "Paris" }));
  assert.equal(result.priority, "LOW");
  assert.equal(result.confidence, "HIGH");
});

// ---- deterministic repeatability ----
test("calling assessOpportunity twice with identical input produces identical output", () => {
  const input = base({
    industry: "Santé",
    city: "Toulouse",
    deals: [{ stage: "qualified" }],
    quotes: [{ status: "sent", sentAt: daysAgo(3), respondedAt: null }],
    interactions: [{ occurredAt: daysAgo(2) }],
    invoices: [{ paidAt: null }],
  });
  const first = assessOpportunity(input);
  const second = assessOpportunity(input);
  assert.deepEqual(first, second);
});
