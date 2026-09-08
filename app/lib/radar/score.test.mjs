// Pure unit tests for lib/radar/score.ts's assessOpportunity(). Zero I/O,
// zero database, zero network — plain function over fixture data. This
// file must only ever be called for QUALIFIED prospects (enforced by the
// caller, lib/actions/radar.ts) — it has no knowledge of doNotContact or
// eligibility at all, by design.
//
// RADAR-CORE-3F — the engine now emits stable semantic codes, never
// localized prose. `reasons` is a RadarReason[] (`{ code }`, plus a
// `value: string` only on INDUSTRY_RECORDED / LOCATION_RECORDED);
// `recommendedNextAction` is a RadarNextActionCode. Every behavioural
// assertion below is unchanged in intent — only the representation moved
// from English string to code. FR/EN copy coverage + the
// no-predictive-language guarantee live in lib/radar/radar-copy.test.mjs.
// Run with: npx tsx --test lib/radar/score.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessOpportunity,
  RECENT_INTERACTION_THRESHOLD_DAYS,
  RADAR_REASON_CODES,
  RADAR_NEXT_ACTION_CODES,
} from "./score.ts";

const NOW = new Date("2026-08-28T12:00:00Z");

const REASON_CODE_SET = new Set(RADAR_REASON_CODES);
const NEXT_ACTION_CODE_SET = new Set(RADAR_NEXT_ACTION_CODES);
const PARAMETRIC_REASON_CODES = new Set(["INDUSTRY_RECORDED", "LOCATION_RECORDED"]);

function hasReason(result, code) {
  return result.reasons.some((r) => r.code === code);
}
function hasReasonWithValue(result, code, value) {
  return result.reasons.some((r) => r.code === code && r.value === value);
}

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
  assert.ok(hasReason(result, "INTERACTION_NONE"));
  assert.equal(result.recommendedNextAction, "COMPLETE_CONTACT_DATA");
});

// ---- deal stages ----
test("a deal at stage 'new' contributes LOW priority", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "new" }] }));
  assert.equal(result.priority, "LOW");
  assert.ok(hasReason(result, "DEAL_STAGE_NEW"));
});

test("a deal at stage 'contacted' emits the DEAL_STAGE_CONTACTED reason", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "contacted" }] }));
  assert.equal(result.priority, "LOW");
  assert.ok(hasReason(result, "DEAL_STAGE_CONTACTED"));
});

test("a deal at stage 'qualified' contributes MEDIUM priority", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "qualified" }] }));
  assert.equal(result.priority, "MEDIUM");
  assert.ok(hasReason(result, "DEAL_STAGE_QUALIFIED"));
});

test("a deal at stage 'proposal' contributes HIGH priority", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "proposal" }] }));
  assert.equal(result.priority, "HIGH");
  assert.ok(hasReason(result, "DEAL_STAGE_PROPOSAL"));
  assert.equal(result.recommendedNextAction, "FOLLOW_UP_PROPOSAL");
});

test("a deal at stage 'won' contributes HIGH priority, distinct reason code", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "won" }] }));
  assert.equal(result.priority, "HIGH");
  assert.ok(hasReason(result, "DEAL_WON"));
  assert.ok(!hasReason(result, "DEAL_STAGE_PROPOSAL"));
});

test("a deal at stage 'lost' contributes nothing — never read as negative, never credited", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "lost" }] }));
  assert.equal(result.priority, "LOW");
  assert.ok(
    !result.reasons.some((r) => r.code.startsWith("DEAL_")),
    "no deal reason of any kind should be emitted for a lone lost deal",
  );
});

test("multiple deals: the best non-lost stage wins", () => {
  const result = assessOpportunity(base({ deals: [{ stage: "lost" }, { stage: "new" }, { stage: "proposal" }] }));
  assert.equal(result.priority, "HIGH");
  assert.ok(hasReason(result, "DEAL_STAGE_PROPOSAL"));
  assert.ok(!hasReason(result, "DEAL_STAGE_NEW"));
});

// ---- quote activity ----
test("an accepted quote contributes HIGH priority", () => {
  const result = assessOpportunity(base({ quotes: [{ status: "accepted", sentAt: daysAgo(10), respondedAt: daysAgo(5) }] }));
  assert.equal(result.priority, "HIGH");
  assert.ok(hasReason(result, "QUOTE_ACCEPTED"));
});

test("a sent quote with no response yet contributes MEDIUM priority", () => {
  const result = assessOpportunity(base({ quotes: [{ status: "sent", sentAt: daysAgo(2), respondedAt: null }] }));
  assert.equal(result.priority, "MEDIUM");
  assert.ok(hasReason(result, "QUOTE_PENDING"));
  assert.equal(result.recommendedNextAction, "FOLLOW_UP_PROPOSAL");
});

test("a declined/expired/draft quote (no active proposal) contributes LOW priority", () => {
  const result = assessOpportunity(base({ quotes: [{ status: "declined", sentAt: daysAgo(30), respondedAt: daysAgo(25) }] }));
  assert.equal(result.priority, "LOW");
  assert.ok(hasReason(result, "QUOTE_RECORDED"));
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
  assert.ok(hasReason(result, "INTERACTION_RECENT"));
});

test("a stale interaction (beyond the threshold) is labeled not recent", () => {
  const result = assessOpportunity(base({ interactions: [{ occurredAt: daysAgo(RECENT_INTERACTION_THRESHOLD_DAYS + 1) }] }));
  assert.ok(hasReason(result, "INTERACTION_STALE"));
});

test("the most recent of several interactions is the one evaluated", () => {
  const result = assessOpportunity(
    base({ interactions: [{ occurredAt: daysAgo(200) }, { occurredAt: daysAgo(1) }, { occurredAt: daysAgo(50) }] }),
  );
  assert.ok(hasReason(result, "INTERACTION_RECENT"));
  assert.equal(result.recommendedNextAction, "REVIEW_INTERACTION");
});

// ---- known / unknown industry ----
test("known industry produces a grounded industry reason carrying the raw value", () => {
  const result = assessOpportunity(base({ industry: "Boulangerie" }));
  assert.ok(hasReasonWithValue(result, "INDUSTRY_RECORDED", "Boulangerie"));
});

test("unknown (null) industry produces no industry-based reason at all", () => {
  const result = assessOpportunity(base({ industry: null }));
  assert.ok(!hasReason(result, "INDUSTRY_RECORDED"));
});

// ---- known / unknown geography ----
test("known geography (city only) produces a grounded location reason carrying the composed label", () => {
  const result = assessOpportunity(base({ city: "Lyon" }));
  assert.ok(hasReasonWithValue(result, "LOCATION_RECORDED", "Lyon"));
});

test("unknown geography (all null) produces no location-based reason at all", () => {
  const result = assessOpportunity(base({ country: null, region: null, city: null }));
  assert.ok(!hasReason(result, "LOCATION_RECORDED"));
});

// ---- existing paid relationship ----
test("an existing paid invoice is surfaced as context but does not by itself raise priority", () => {
  const withPaid = assessOpportunity(base({ invoices: [{ paidAt: daysAgo(100) }] }));
  const withoutPaid = assessOpportunity(base({ invoices: [] }));
  assert.ok(hasReason(withPaid, "PAID_INVOICE"));
  assert.equal(withPaid.priority, withoutPaid.priority, "priority must be identical with/without a paid invoice when no deal/quote signal exists");
});

test("a linked organization is surfaced as context but does not by itself raise priority", () => {
  const withOrg = assessOpportunity(base({ organizationId: "org-1" }));
  const withoutOrg = assessOpportunity(base({ organizationId: null }));
  assert.ok(hasReason(withOrg, "ORG_LINKED"));
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

// ---- RADAR-CORE-3F — semantic-code contract ----
test("3F: every emitted reason is a valid descriptor — a known code, `value` string ONLY on the two 'recorded' codes", () => {
  const result = assessOpportunity(
    base({
      industry: "Santé",
      country: "France",
      region: "Occitanie",
      city: "Toulouse",
      organizationId: "org-1",
      deals: [{ stage: "proposal" }],
      quotes: [{ status: "accepted", sentAt: daysAgo(10), respondedAt: daysAgo(5) }],
      interactions: [{ occurredAt: daysAgo(1) }],
      invoices: [{ paidAt: daysAgo(50) }],
    }),
  );
  assert.ok(result.reasons.length > 0);
  for (const r of result.reasons) {
    assert.ok(REASON_CODE_SET.has(r.code), `reason code "${r.code}" is not in RADAR_REASON_CODES`);
    const keys = Object.keys(r).sort();
    if (PARAMETRIC_REASON_CODES.has(r.code)) {
      assert.deepEqual(keys, ["code", "value"], `${r.code} must carry exactly { code, value }`);
      assert.equal(typeof r.value, "string");
      assert.ok(r.value.length > 0);
    } else {
      assert.deepEqual(keys, ["code"], `${r.code} must be a bare { code } descriptor`);
    }
  }
});

test("3F: the domain engine emits ONLY codes — no reason descriptor or next-action carries prose", () => {
  const inputs = [
    base(),
    base({ deals: [{ stage: "won" }] }),
    base({ deals: [{ stage: "contacted" }] }),
    base({ quotes: [{ status: "sent", sentAt: daysAgo(2), respondedAt: null }] }),
    base({ interactions: [{ occurredAt: daysAgo(2) }] }),
    base({ industry: "X", city: "Y" }),
  ];
  const CODE_SHAPE = /^[A-Z][A-Z_]*$/;
  for (const input of inputs) {
    const result = assessOpportunity(input);
    for (const r of result.reasons) {
      assert.match(r.code, CODE_SHAPE, `reason code "${r.code}" must be an ALL_CAPS code, never prose`);
    }
    assert.ok(NEXT_ACTION_CODE_SET.has(result.recommendedNextAction), `"${result.recommendedNextAction}" is not a RADAR_NEXT_ACTION_CODES member`);
    assert.match(result.recommendedNextAction, CODE_SHAPE);
  }
});

test("3F: recommendedNextAction branch order is unchanged — pending-quote/proposal beats accepted-quote/any-deal beats interaction beats low-confidence beats fallback", () => {
  assert.equal(
    assessOpportunity(base({ quotes: [{ status: "sent", sentAt: daysAgo(1), respondedAt: null }], deals: [{ stage: "won" }] })).recommendedNextAction,
    "FOLLOW_UP_PROPOSAL",
  );
  assert.equal(
    assessOpportunity(base({ deals: [{ stage: "qualified" }], interactions: [{ occurredAt: daysAgo(1) }] })).recommendedNextAction,
    "REVIEW_DEAL",
  );
  assert.equal(
    assessOpportunity(base({ interactions: [{ occurredAt: daysAgo(1) }], industry: "X", city: "Y" })).recommendedNextAction,
    "REVIEW_INTERACTION",
  );
  assert.equal(assessOpportunity(base()).recommendedNextAction, "COMPLETE_CONTACT_DATA");
  assert.equal(
    assessOpportunity(base({ industry: "Restauration", country: "France", city: "Paris" })).recommendedNextAction,
    "REVIEW_PROSPECT",
  );
});
