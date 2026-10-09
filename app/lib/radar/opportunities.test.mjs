// Pure unit tests for lib/radar/opportunities.ts's assessOpportunities() —
// MICRO-STEP 3. Zero I/O, zero database, zero network, zero AI call, zero
// deal/task creation — plain function over an already-computed
// RadarSignal[] fixture, exactly like signals.test.mjs / score.test.mjs.
// Run with: npx tsx --test lib/radar/opportunities.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assessOpportunities,
  RADAR_OPPORTUNITY_TYPES,
  RADAR_OPPORTUNITY_SERVICES,
  RADAR_OPPORTUNITY_REASON_CODES,
} from "./opportunities.ts";

const OPPORTUNITY_TYPE_SET = new Set(RADAR_OPPORTUNITY_TYPES);
const SERVICE_SET = new Set(RADAR_OPPORTUNITY_SERVICES);
const REASON_CODE_SET = new Set(RADAR_OPPORTUNITY_REASON_CODES);

const NOW = new Date("2026-08-28T12:00:00Z");

/** A minimal RadarSignal-shaped fixture — only `type` is ever read by
 * assessOpportunities(), but the full shape is supplied so a fixture is
 * indistinguishable from a real signals.ts output. */
function signal(type, overrides = {}) {
  return {
    type,
    color: "blue",
    severity: "info",
    reason: "FIXTURE_REASON",
    evidence: {},
    detectedAt: NOW,
    ...overrides,
  };
}

// ---- 1. NO_WEBSITE -> WEBSITE ----
test("NO_WEBSITE alone produces exactly one WEBSITE/website_creation opportunity", () => {
  const opportunities = assessOpportunities([signal("NO_WEBSITE")]);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].type, "WEBSITE");
  assert.equal(opportunities[0].service, "website_creation");
});

// ---- 2. a different signal alone -> no opportunity ----
test("DISCOVERY_NEW alone never produces any opportunity", () => {
  assert.deepEqual(assessOpportunities([signal("DISCOVERY_NEW")]), []);
});

test("BUSINESS_CLOSED alone never produces any opportunity (not just never a WEBSITE one)", () => {
  assert.deepEqual(assessOpportunities([signal("BUSINESS_CLOSED")]), []);
});

test("NO_RECENT_INTERACTION alone never produces any opportunity", () => {
  assert.deepEqual(assessOpportunities([signal("NO_RECENT_INTERACTION")]), []);
});

test("RECENT_ACTIVITY alone never produces any opportunity", () => {
  assert.deepEqual(assessOpportunities([signal("RECENT_ACTIVITY")]), []);
});

// ---- 3. no signal at all -> no opportunity ----
test("an empty signal list produces an empty opportunity list", () => {
  assert.deepEqual(assessOpportunities([]), []);
});

// ---- 4. several signals -> WEBSITE only when NO_WEBSITE is present ----
test("several signals including NO_WEBSITE (without BUSINESS_CLOSED) still produce exactly one WEBSITE opportunity, never duplicated", () => {
  const opportunities = assessOpportunities([
    signal("DISCOVERY_NEW"),
    signal("NO_WEBSITE"),
    signal("NO_RECENT_INTERACTION"),
    signal("RECENT_ACTIVITY"),
  ]);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].type, "WEBSITE");
});

// ---- 4C.1 — BUSINESS_CLOSED blocks the WEBSITE opportunity ----
test("4C.1: NO_WEBSITE alone -> exactly one WEBSITE opportunity", () => {
  const opportunities = assessOpportunities([signal("NO_WEBSITE")]);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].type, "WEBSITE");
});

test("4C.1: BUSINESS_CLOSED alone -> no opportunity", () => {
  assert.deepEqual(assessOpportunities([signal("BUSINESS_CLOSED")]), []);
});

test("4C.1: BUSINESS_CLOSED + NO_WEBSITE -> no opportunity", () => {
  assert.deepEqual(assessOpportunities([signal("BUSINESS_CLOSED"), signal("NO_WEBSITE")]), []);
});

test("4C.1: the block does not depend on signal order", () => {
  assert.deepEqual(assessOpportunities([signal("NO_WEBSITE"), signal("BUSINESS_CLOSED")]), []);
});

test("4C.1: BUSINESS_CLOSED + NO_WEBSITE + informational signals -> no WEBSITE opportunity", () => {
  const opportunities = assessOpportunities([
    signal("DISCOVERY_NEW"),
    signal("NO_WEBSITE"),
    signal("BUSINESS_CLOSED"),
    signal("NO_RECENT_INTERACTION"),
    signal("RECENT_ACTIVITY"),
  ]);
  assert.ok(!opportunities.some((o) => o.type === "WEBSITE"));
  assert.deepEqual(opportunities, []);
});

test("several signals without NO_WEBSITE still produce no opportunity", () => {
  const opportunities = assessOpportunities([signal("DISCOVERY_NEW"), signal("BUSINESS_CLOSED"), signal("RECENT_ACTIVITY")]);
  assert.deepEqual(opportunities, []);
});

// ---- 5. deterministic ----
test("assessOpportunities is deterministic: identical input always produces an identical result", () => {
  for (const input of [[signal("NO_WEBSITE"), signal("DISCOVERY_NEW")], [signal("NO_WEBSITE"), signal("BUSINESS_CLOSED")]]) {
    assert.deepEqual(assessOpportunities(input), assessOpportunities(input));
  }
});

// ---- 6. evidence correcte ----
test("the WEBSITE opportunity's evidence is exactly the NO_WEBSITE signal's evidence (4F.6.6)", () => {
  const evidence = { website: null, discoveryCategory: "dentist", discoveryBusinessStatus: "OPERATIONAL", discoveredAt: new Date("2026-09-07T12:00:00Z") };
  const opportunities = assessOpportunities([signal("NO_WEBSITE", { evidence: structuredClone(evidence) })]);
  assert.deepEqual(opportunities[0].evidence, evidence);
});

// ---- 7. sourceSignals correcte ----
test("the WEBSITE opportunity's sourceSignals is exactly ['NO_WEBSITE']", () => {
  const opportunities = assessOpportunities([signal("NO_WEBSITE")]);
  assert.deepEqual(opportunities[0].sourceSignals, ["NO_WEBSITE"]);
});

test("sourceSignals never includes an unrelated co-occurring signal type", () => {
  const opportunities = assessOpportunities([signal("NO_WEBSITE"), signal("DISCOVERY_NEW"), signal("RECENT_ACTIVITY")]);
  assert.deepEqual(opportunities[0].sourceSignals, ["NO_WEBSITE"]);
});

// ---- 8. no side effect ----
test("assessOpportunities never mutates its input signal array or its elements", () => {
  const input = [signal("NO_WEBSITE"), signal("BUSINESS_CLOSED")];
  // structuredClone (not a JSON round-trip) so Date fields survive the
  // snapshot as real Date instances, keeping the comparison exact.
  const snapshot = structuredClone(input);
  assessOpportunities(input);
  assert.deepEqual(input, snapshot, "input must be left untouched");
});

test("assessOpportunities performs no I/O — a frozen input array/object is still accepted without throwing", () => {
  const frozenSignal = Object.freeze(signal("NO_WEBSITE"));
  const frozenInput = Object.freeze([frozenSignal]);
  assert.doesNotThrow(() => assessOpportunities(frozenInput));
});

// ---- 9. BUSINESS_CLOSED alone never creates a WEBSITE opportunity ----
test("BUSINESS_CLOSED alone, even with other non-NO_WEBSITE signals, never creates a WEBSITE opportunity", () => {
  const opportunities = assessOpportunities([signal("BUSINESS_CLOSED"), signal("DISCOVERY_NEW"), signal("RECENT_ACTIVITY")]);
  assert.ok(!opportunities.some((o) => o.type === "WEBSITE"));
  assert.deepEqual(opportunities, []);
});

// ---- structural / closed-set guarantees ----
test("every emitted opportunity's type/service/reason belongs to the closed RADAR_OPPORTUNITY_* sets", () => {
  const opportunities = assessOpportunities([signal("NO_WEBSITE")]);
  for (const opportunity of opportunities) {
    assert.ok(OPPORTUNITY_TYPE_SET.has(opportunity.type));
    assert.ok(SERVICE_SET.has(opportunity.service));
    assert.ok(REASON_CODE_SET.has(opportunity.reason));
  }
});

test("only WEBSITE, PROPOSAL_RENEWAL and DEAL_STALLED are defined opportunity types (4F.3) — SEO/GBP/upsell are out of scope", () => {
  assert.deepEqual([...OPPORTUNITY_TYPE_SET], ["WEBSITE", "PROPOSAL_RENEWAL", "DEAL_STALLED"]);
  assert.deepEqual([...SERVICE_SET], ["website_creation"], "no service identifier invented");
  assert.deepEqual([...REASON_CODE_SET], ["NO_WEBSITE_DETECTED", "QUOTE_VALIDITY_EXPIRED_UNANSWERED", "DEAL_OVERDUE_NO_RECENT_CONTACT"]);
});

// =========================================================
// MICRO-STEP 4F.2-A — QUOTE_PAST_VALIDITY -> PROPOSAL_RENEWAL
// =========================================================

// 4F.6.4: the signal carries the expired quotes themselves; count = list length.
function expiredQuoteList(expiredQuoteCount) {
  return Array.from({ length: expiredQuoteCount }, (_, i) => ({
    quoteId: `q-${i + 1}`,
    validUntil: new Date(Date.UTC(2026, 7, 1 + i)),
    dealId: i % 2 === 0 ? null : `deal-${i}`,
    daysPastValidity: 27 - i,
  }));
}
function pastValidity(expiredQuoteCount = 1) {
  return signal("QUOTE_PAST_VALIDITY", { evidence: { expiredQuoteCount, expiredQuotes: expiredQuoteList(expiredQuoteCount) } });
}
function renewals(opportunities) {
  return opportunities.filter((o) => o.type === "PROPOSAL_RENEWAL");
}

test("4F.2-A A: QUOTE_PAST_VALIDITY -> exactly one PROPOSAL_RENEWAL with service null, reason, evidence and sourceSignals", () => {
  assert.deepEqual(assessOpportunities([pastValidity(2)]), [
    {
      type: "PROPOSAL_RENEWAL",
      service: null,
      reason: "QUOTE_VALIDITY_EXPIRED_UNANSWERED",
      evidence: { expiredQuoteCount: 2, expiredQuotes: expiredQuoteList(2) },
      sourceSignals: ["QUOTE_PAST_VALIDITY"],
    },
  ]);
});

test("4F.2-A B: no signal -> no opportunity", () => {
  assert.deepEqual(assessOpportunities([]), []);
});

test("4F.2-A C: QUOTE_PENDING alone -> no PROPOSAL_RENEWAL", () => {
  assert.deepEqual(assessOpportunities([signal("QUOTE_PENDING", { evidence: { pendingQuoteCount: 1 } })]), []);
});

test("4F.2-A D: DEAL_PAST_EXPECTED_CLOSE alone -> no PROPOSAL_RENEWAL (since 4F.3 it yields DEAL_STALLED only)", () => {
  const opportunities = assessOpportunities([signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 1, overdueDeals: [{ dealId: "d-1", stage: "new", expectedCloseDate: new Date("2026-08-01T00:00:00Z"), overdueDays: 27, lastDealInteractionAt: null, dealContactState: "NONE_RECORDED" }] } })]);
  assert.deepEqual(renewals(opportunities), []);
  assert.deepEqual(opportunities.map((o) => o.type), ["DEAL_STALLED"]);
});

test("4F.2-A E: NO_RECENT_INTERACTION + QUOTE_PAST_VALIDITY -> exactly one PROPOSAL_RENEWAL", () => {
  const opportunities = assessOpportunities([signal("NO_RECENT_INTERACTION"), pastValidity()]);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].type, "PROPOSAL_RENEWAL");
});

test("4F.2-A F: DEAL_ACTIVE + QUOTE_PAST_VALIDITY -> exactly one PROPOSAL_RENEWAL", () => {
  const opportunities = assessOpportunities([signal("DEAL_ACTIVE", { evidence: { openDealCount: 1 } }), pastValidity()]);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].type, "PROPOSAL_RENEWAL");
});

test("4F.2-A G: BUSINESS_CLOSED + QUOTE_PAST_VALIDITY -> PROPOSAL_RENEWAL is NOT blocked (existing CRM relationship)", () => {
  const opportunities = assessOpportunities([signal("BUSINESS_CLOSED"), pastValidity()]);
  assert.equal(renewals(opportunities).length, 1);
});

test("4F.2-A H: BUSINESS_CLOSED + NO_WEBSITE -> no WEBSITE (unchanged 4C.1 rule)", () => {
  assert.deepEqual(assessOpportunities([signal("BUSINESS_CLOSED"), signal("NO_WEBSITE")]), []);
});

test("4F.2-A I: BUSINESS_CLOSED + NO_WEBSITE + QUOTE_PAST_VALIDITY -> exactly one PROPOSAL_RENEWAL and no WEBSITE", () => {
  const opportunities = assessOpportunities([signal("BUSINESS_CLOSED"), signal("NO_WEBSITE"), pastValidity()]);
  assert.deepEqual(opportunities.map((o) => o.type), ["PROPOSAL_RENEWAL"]);
});

test("4F.2-A J: NO_WEBSITE + QUOTE_PAST_VALIDITY -> exactly WEBSITE then PROPOSAL_RENEWAL, whatever the signal order", () => {
  for (const signals of [
    [signal("NO_WEBSITE"), pastValidity()],
    [pastValidity(), signal("NO_WEBSITE")],
  ]) {
    assert.deepEqual(assessOpportunities(signals).map((o) => o.type), ["WEBSITE", "PROPOSAL_RENEWAL"]);
  }
});

test("4F.2-A J2: the WEBSITE opportunity is byte-identical with or without a co-occurring PROPOSAL_RENEWAL", () => {
  const alone = assessOpportunities([signal("NO_WEBSITE")]);
  const withRenewal = assessOpportunities([signal("NO_WEBSITE"), pastValidity()]);
  assert.deepEqual(withRenewal[0], alone[0]);
});

test("4F.2-A K1: closed sets — type and reason belong to the sets; service is exactly null for PROPOSAL_RENEWAL", () => {
  const opportunities = assessOpportunities([signal("NO_WEBSITE"), pastValidity()]);
  for (const opportunity of opportunities) {
    assert.ok(OPPORTUNITY_TYPE_SET.has(opportunity.type));
    assert.ok(REASON_CODE_SET.has(opportunity.reason));
    assert.ok(opportunity.service === null || SERVICE_SET.has(opportunity.service));
  }
  assert.equal(renewals(opportunities)[0].service, null);
});

test("4F.2-A K2: evidence is taken from the signal, never recomputed", () => {
  assert.deepEqual(renewals(assessOpportunities([pastValidity(5)]))[0].evidence, { expiredQuoteCount: 5, expiredQuotes: expiredQuoteList(5) });
});

test("4F.2-A K3: deterministic, and the input signals are never mutated", () => {
  const input = [signal("BUSINESS_CLOSED"), signal("NO_WEBSITE"), pastValidity(3)];
  const snapshot = structuredClone(input);
  assert.deepEqual(assessOpportunities(input), assessOpportunities(input));
  assert.deepEqual(input, snapshot);
  assert.doesNotThrow(() => assessOpportunities(Object.freeze(input.map((s) => Object.freeze(s)))));
});

// =========================================================
// MICRO-STEP 4F.3 — DEAL_PAST_EXPECTED_CLOSE without RECENT_ACTIVITY -> DEAL_STALLED
// =========================================================

const STALE_AT = new Date("2026-07-01T10:00:00Z");

// 4F.6.2: the signal carries the overdue deals themselves; count = list length.
// 4F.8.7: each deal carries its own contact state (default NONE_RECORDED = stalled).
function overdueList(overdueDealCount, dealContactState = "NONE_RECORDED", lastDealInteractionAt = null) {
  return Array.from({ length: overdueDealCount }, (_, i) => ({
    dealId: `d-${i + 1}`,
    stage: "new",
    expectedCloseDate: new Date(Date.UTC(2026, 7, 1 + i)),
    overdueDays: 27 - i,
    lastDealInteractionAt,
    dealContactState,
  }));
}
function pastClose(overdueDealCount = 1, dealContactState = "NONE_RECORDED", lastDealInteractionAt = null) {
  return signal("DEAL_PAST_EXPECTED_CLOSE", {
    evidence: { overdueDealCount, overdueDeals: overdueList(overdueDealCount, dealContactState, lastDealInteractionAt) },
  });
}
function noRecent(lastInteractionAt = STALE_AT) {
  return signal("NO_RECENT_INTERACTION", { evidence: { lastInteractionAt, thresholdDays: 30 } });
}
function recentActivity() {
  return signal("RECENT_ACTIVITY", { evidence: { lastInteractionAt: new Date("2026-08-27T10:00:00Z"), thresholdDays: 30 } });
}
function stalled(opportunities) {
  return opportunities.filter((o) => o.type === "DEAL_STALLED");
}

test("4F.3 A/D/L: DEAL_PAST_EXPECTED_CLOSE alone (no interaction recorded) -> DEAL_STALLED, NONE_RECORDED, sourceSignals = [DEAL_PAST_EXPECTED_CLOSE]", () => {
  assert.deepEqual(assessOpportunities([pastClose(1)]), [
    {
      type: "DEAL_STALLED",
      service: null,
      reason: "DEAL_OVERDUE_NO_RECENT_CONTACT",
      evidence: { overdueDealCount: 1, overdueDeals: overdueList(1), lastInteractionAt: null },
      sourceSignals: ["DEAL_PAST_EXPECTED_CLOSE"],
    },
  ]);
});

test("4F.3 B (4F.8.7): an overdue deal whose own contact state is RECENT -> no DEAL_STALLED", () => {
  const recentAt = new Date("2026-08-27T10:00:00Z");
  assert.deepEqual(stalled(assessOpportunities([pastClose(1, "RECENT", recentAt), recentActivity()])), []);
  assert.deepEqual(stalled(assessOpportunities([pastClose(2, "RECENT", recentAt)])), []);
});

test("4F.3 C/M: STALE overdue deal + NO_RECENT_INTERACTION -> DEAL_STALLED, both source signals, lastInteractionAt from the signal", () => {
  assert.deepEqual(assessOpportunities([pastClose(1, "STALE", STALE_AT), noRecent(STALE_AT)]), [
    {
      type: "DEAL_STALLED",
      service: null,
      reason: "DEAL_OVERDUE_NO_RECENT_CONTACT",
      evidence: { overdueDealCount: 1, overdueDeals: overdueList(1, "STALE", STALE_AT), lastInteractionAt: STALE_AT },
      sourceSignals: ["DEAL_PAST_EXPECTED_CLOSE", "NO_RECENT_INTERACTION"],
    },
  ]);
});

test("4F.3 E: no interaction and no DEAL_PAST_EXPECTED_CLOSE -> no DEAL_STALLED", () => {
  assert.deepEqual(assessOpportunities([signal("DEAL_ACTIVE", { evidence: { openDealCount: 1 } })]), []);
});

test("4F.3 F: RECENT_ACTIVITY without DEAL_PAST_EXPECTED_CLOSE -> no DEAL_STALLED", () => {
  assert.deepEqual(assessOpportunities([recentActivity()]), []);
});

test("4F.3 E2: NO_RECENT_INTERACTION without DEAL_PAST_EXPECTED_CLOSE -> no DEAL_STALLED", () => {
  assert.deepEqual(assessOpportunities([noRecent()]), []);
});

test("4F.3 G: BUSINESS_CLOSED does not remove DEAL_STALLED (NONE_RECORDED and STALE)", () => {
  assert.equal(stalled(assessOpportunities([signal("BUSINESS_CLOSED"), pastClose()])).length, 1);
  assert.equal(stalled(assessOpportunities([signal("BUSINESS_CLOSED"), pastClose(), noRecent()])).length, 1);
});

test("4F.3 H: BUSINESS_CLOSED + NO_WEBSITE still blocks WEBSITE (unchanged), even alongside DEAL_STALLED", () => {
  assert.deepEqual(assessOpportunities([signal("BUSINESS_CLOSED"), signal("NO_WEBSITE")]), []);
  assert.deepEqual(assessOpportunities([signal("BUSINESS_CLOSED"), signal("NO_WEBSITE"), pastClose()]).map((o) => o.type), ["DEAL_STALLED"]);
});

test("4F.3 I: PROPOSAL_RENEWAL and DEAL_STALLED coexist, no deduplication", () => {
  assert.deepEqual(assessOpportunities([pastValidity(), pastClose(), noRecent()]).map((o) => o.type), ["PROPOSAL_RENEWAL", "DEAL_STALLED"]);
});

test("4F.3 J: several overdue deals -> exactly one DEAL_STALLED carrying the signal's overdueDealCount", () => {
  const result = stalled(assessOpportunities([pastClose(3), noRecent()]));
  assert.equal(result.length, 1);
  assert.equal(result[0].evidence.overdueDealCount, 3);
});

test("4F.3 K: no relevant signal -> no additional opportunity", () => {
  for (const type of ["DISCOVERY_NEW", "UNASSIGNED", "FOLLOW_UP_OVERDUE", "NO_FOLLOW_UP_SCHEDULED", "QUOTE_PENDING"]) {
    assert.deepEqual(assessOpportunities([signal(type)]), [], type);
  }
});

test("4F.3 N: evidence is copied from the signals, never recomputed", () => {
  const [opportunity] = stalled(assessOpportunities([pastClose(7, "STALE", STALE_AT), noRecent(STALE_AT)]));
  assert.deepEqual(opportunity.evidence, { overdueDealCount: 7, overdueDeals: overdueList(7, "STALE", STALE_AT), lastInteractionAt: STALE_AT });
});

test("4F.3 O: deterministic order WEBSITE -> PROPOSAL_RENEWAL -> DEAL_STALLED, whatever the signal order", () => {
  const signals = [pastClose(), noRecent(), pastValidity(), signal("NO_WEBSITE")];
  for (const ordering of [signals, [...signals].reverse(), [signals[2], signals[0], signals[3], signals[1]]]) {
    assert.deepEqual(assessOpportunities(ordering).map((o) => o.type), ["WEBSITE", "PROPOSAL_RENEWAL", "DEAL_STALLED"]);
  }
});

test("4F.3 P: NO_INTERACTION_HISTORY appears nowhere — not as a source signal, not in the engine source", () => {
  const all = [
    ...assessOpportunities([pastClose()]),
    ...assessOpportunities([pastClose(), noRecent()]),
  ];
  assert.ok(all.every((o) => !o.sourceSignals.includes("NO_INTERACTION_HISTORY")));
  assert.ok(all.every((o) => !o.sourceSignals.includes("RECENT_ACTIVITY")), "RECENT_ACTIVITY is never a source signal");
  const source = readFileSync(fileURLToPath(new URL("./opportunities.ts", import.meta.url)), "utf8");
  assert.ok(!source.includes("NO_INTERACTION_HISTORY"));
  assert.ok(!source.includes("NEVER_CONTACTED"));
});

test("4F.3: closed sets, service null, determinism and no mutation for DEAL_STALLED", () => {
  const input = [signal("BUSINESS_CLOSED"), pastClose(2), noRecent()];
  const snapshot = structuredClone(input);
  const result = assessOpportunities(input);
  assert.deepEqual(result, assessOpportunities(input));
  assert.deepEqual(input, snapshot);
  for (const opportunity of result) {
    assert.ok(OPPORTUNITY_TYPE_SET.has(opportunity.type));
    assert.ok(REASON_CODE_SET.has(opportunity.reason));
  }
  assert.equal(stalled(result)[0].service, null);
});

// =========================================================
// MICRO-STEP 4F.6.2 — DEAL_STALLED copies the signal's overdueDeals verbatim
// =========================================================

test("4F.6.2 DEAL_STALLED copies overdueDealCount, overdueDeals and lastInteractionAt exactly (STALE and NONE_RECORDED)", () => {
  const deals = [
    { dealId: "d-b", stage: "proposal", expectedCloseDate: new Date("2026-08-28T00:00:00Z"), overdueDays: 40, lastDealInteractionAt: STALE_AT, dealContactState: "STALE" },
    { dealId: "d-a", stage: "new", expectedCloseDate: new Date("2026-10-02T00:00:00Z"), overdueDays: 5, lastDealInteractionAt: null, dealContactState: "NONE_RECORDED" },
  ];
  const signalFor = () => signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 2, overdueDeals: structuredClone(deals) } });

  const [stale] = stalled(assessOpportunities([signalFor(), noRecent(STALE_AT)]));
  assert.deepEqual(stale.evidence, { overdueDealCount: 2, overdueDeals: deals, lastInteractionAt: STALE_AT });
  assert.deepEqual(stale.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE", "NO_RECENT_INTERACTION"]);

  const [none] = stalled(assessOpportunities([signalFor()]));
  assert.deepEqual(none.evidence, { overdueDealCount: 2, overdueDeals: deals, lastInteractionAt: null });
  assert.deepEqual(none.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE"]);
});

test("4F.6.2 DEAL_STALLED never re-sorts, filters or recomputes overdueDeals", () => {
  const unsorted = [
    { dealId: "z", stage: "qualified", expectedCloseDate: new Date("2026-10-01T00:00:00Z"), overdueDays: 999, lastDealInteractionAt: null, dealContactState: "NONE_RECORDED" },
    { dealId: "a", stage: "new", expectedCloseDate: new Date("2026-01-01T00:00:00Z"), overdueDays: 0, lastDealInteractionAt: STALE_AT, dealContactState: "STALE" },
  ];
  const input = signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 2, overdueDeals: unsorted } });
  const [opportunity] = stalled(assessOpportunities([input]));
  assert.deepEqual(opportunity.evidence.overdueDeals, unsorted);
  assert.equal(opportunity.evidence.overdueDealCount, opportunity.evidence.overdueDeals.length);
});

test("4F.6.2/4F.8.7 trigger rule: RECENT deals never stall (whatever RECENT_ACTIVITY); signals not mutated", () => {
  const input = [pastClose(2, "RECENT", new Date("2026-08-27T10:00:00Z")), recentActivity()];
  const snapshot = structuredClone(input);
  assert.deepEqual(stalled(assessOpportunities(input)), []);
  assert.deepEqual(input, snapshot);
});

// =========================================================
// MICRO-STEP 4F.6.4 — PROPOSAL_RENEWAL copies the signal's expiredQuotes verbatim
// =========================================================

test("4F.6.4 one quote: PROPOSAL_RENEWAL copies expiredQuoteCount and expiredQuotes exactly; type/service/reason/sourceSignals unchanged", () => {
  const quotes = [{ quoteId: "q-1", validUntil: new Date("2026-10-06T00:00:00Z"), dealId: null, daysPastValidity: 1 }];
  const [renewal] = renewals(assessOpportunities([signal("QUOTE_PAST_VALIDITY", { evidence: { expiredQuoteCount: 1, expiredQuotes: structuredClone(quotes) } })]));
  assert.deepEqual(renewal, {
    type: "PROPOSAL_RENEWAL",
    service: null,
    reason: "QUOTE_VALIDITY_EXPIRED_UNANSWERED",
    evidence: { expiredQuoteCount: 1, expiredQuotes: quotes },
    sourceSignals: ["QUOTE_PAST_VALIDITY"],
  });
  assert.strictEqual(renewal.evidence.expiredQuotes[0].dealId, null);
});

test("4F.6.4 two quotes: both copied, dealId kept, still exactly one PROPOSAL_RENEWAL", () => {
  const quotes = [
    { quoteId: "q-a", validUntil: new Date("2026-09-27T00:00:00Z"), dealId: "deal-A", daysPastValidity: 10 },
    { quoteId: "q-b", validUntil: new Date("2026-10-02T00:00:00Z"), dealId: "deal-A", daysPastValidity: 5 },
  ];
  const result = renewals(assessOpportunities([signal("QUOTE_PAST_VALIDITY", { evidence: { expiredQuoteCount: 2, expiredQuotes: structuredClone(quotes) } })]));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].evidence, { expiredQuoteCount: 2, expiredQuotes: quotes });
});

test("4F.6.4 an empty expiredQuotes list is impossible for a PROPOSAL_RENEWAL produced from assessSignals", async () => {
  const { assessSignals } = await import("./signals.ts");
  const now = new Date("2026-10-07T12:00:00Z");
  const base = { source: null, discoverySource: null, discoveredAt: null, lastInteractionAt: null, interactions: [], assignedUserId: "u", nextFollowUpDueAt: null, nextFollowUpOverdue: false, deals: [], now };
  const q = (id, validUntil, extra = {}) => ({ id, dealId: null, status: "sent", respondedAt: null, validUntil, ...extra });
  const cases = [
    [],
    [q("q-1", new Date("2026-10-07T00:00:00Z"))],
    [q("q-1", null)],
    [q("q-1", new Date("2026-10-06T00:00:00Z"), { respondedAt: now })],
    [q("q-1", new Date("2026-10-06T00:00:00Z"))],
    [q("q-1", new Date("2026-10-06T00:00:00Z")), q("q-2", new Date("2026-09-01T00:00:00Z"))],
  ];
  for (const quotes of cases) {
    for (const renewal of renewals(assessOpportunities(assessSignals({ ...base, quotes })))) {
      assert.ok(renewal.evidence.expiredQuotes.length > 0);
      assert.equal(renewal.evidence.expiredQuoteCount, renewal.evidence.expiredQuotes.length);
    }
  }
  assert.equal(renewals(assessOpportunities(assessSignals({ ...base, quotes: [q("q-1", null)] }))).length, 0);
});

test("4F.6.4 PROPOSAL_RENEWAL never re-sorts, filters or recomputes expiredQuotes", () => {
  const unsorted = [
    { quoteId: "z", validUntil: new Date("2026-10-01T00:00:00Z"), dealId: "deal-Z", daysPastValidity: 999 },
    { quoteId: "a", validUntil: new Date("2026-01-01T00:00:00Z"), dealId: null, daysPastValidity: 0 },
  ];
  const [renewal] = renewals(assessOpportunities([signal("QUOTE_PAST_VALIDITY", { evidence: { expiredQuoteCount: 2, expiredQuotes: unsorted } })]));
  assert.deepEqual(renewal.evidence.expiredQuotes, unsorted);
});

test("4F.6.4 BUSINESS_CLOSED still allows PROPOSAL_RENEWAL (with its expiredQuotes); signals not mutated", () => {
  const input = [signal("BUSINESS_CLOSED"), pastValidity(2)];
  const snapshot = structuredClone(input);
  const result = renewals(assessOpportunities(input));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].evidence.expiredQuotes, expiredQuoteList(2));
  assert.deepEqual(input, snapshot);
});

// =========================================================
// MICRO-STEP 4F.6.6 — WEBSITE copies the NO_WEBSITE evidence verbatim
// =========================================================

function noWebsite(evidence = { website: null, discoveryCategory: "florist", discoveryBusinessStatus: null, discoveredAt: new Date("2026-09-07T12:00:00Z") }) {
  return signal("NO_WEBSITE", { evidence });
}

test("4F.6.6 #10 WEBSITE = exact copy of NO_WEBSITE evidence; type/service/reason/sourceSignals unchanged", () => {
  const evidence = { website: null, discoveryCategory: null, discoveryBusinessStatus: "CLOSED_TEMPORARILY", discoveredAt: new Date("2026-01-02T03:04:05Z") };
  const [website] = assessOpportunities([noWebsite(structuredClone(evidence))]);
  assert.deepEqual(website, { type: "WEBSITE", service: "website_creation", reason: "NO_WEBSITE_DETECTED", evidence, sourceSignals: ["NO_WEBSITE"] });
  assert.deepEqual(Object.keys(website.evidence).sort(), ["discoveredAt", "discoveryBusinessStatus", "discoveryCategory", "website"]);
});

test("4F.6.6 WEBSITE never recomputes or reinterprets the evidence (copied as-is, a distinct object)", () => {
  const input = noWebsite({ website: null, discoveryCategory: "odd", discoveryBusinessStatus: "SOMETHING_ELSE", discoveredAt: new Date("1999-12-31T00:00:00Z") });
  const snapshot = structuredClone(input);
  const [website] = assessOpportunities([input]);
  assert.deepEqual(website.evidence, input.evidence);
  assert.notStrictEqual(website.evidence, input.evidence);
  website.evidence.discoveryCategory = "mutated";
  assert.deepEqual(input, snapshot, "the signal is never mutated");
});

test("4F.6.6 #9 BUSINESS_CLOSED still blocks WEBSITE exactly as before, whatever the NO_WEBSITE evidence", () => {
  assert.deepEqual(assessOpportunities([signal("BUSINESS_CLOSED"), noWebsite()]), []);
  assert.deepEqual(assessOpportunities([noWebsite(), signal("BUSINESS_CLOSED")]), []);
  const closedEvidence = noWebsite({ website: null, discoveryCategory: "x", discoveryBusinessStatus: "CLOSED_PERMANENTLY", discoveredAt: new Date("2026-09-07T12:00:00Z") });
  assert.deepEqual(assessOpportunities([closedEvidence]).map((o) => o.type), ["WEBSITE"], "the evidence's businessStatus is never read as a blocker — only the BUSINESS_CLOSED signal blocks");
});

test("4F.6.6 opportunity order unchanged: WEBSITE -> PROPOSAL_RENEWAL -> DEAL_STALLED", () => {
  const signals = [pastClose(), noRecent(), pastValidity(), noWebsite()];
  for (const ordering of [signals, [...signals].reverse()]) {
    assert.deepEqual(assessOpportunities(ordering).map((o) => o.type), ["WEBSITE", "PROPOSAL_RENEWAL", "DEAL_STALLED"]);
  }
});

// =========================================================
// MICRO-STEP 4F.7.1 — WEBSITE still depends only on NO_WEBSITE; when the CRM
// already has a website, NO_WEBSITE (hence WEBSITE) is simply absent.
// =========================================================

test("4F.7.1 #7 hasCrmWebsite=true -> no NO_WEBSITE -> no WEBSITE; false -> WEBSITE with unchanged evidence", async () => {
  const { assessSignals } = await import("./signals.ts");
  const now = new Date("2026-10-07T12:00:00Z");
  const discoveredAt = new Date("2026-09-07T12:00:00Z");
  const input = (hasCrmWebsite, businessStatus = "OPERATIONAL") => ({
    source: null, discoverySource: { category: "dentist", website: null, businessStatus }, discoveredAt, hasCrmWebsite,
    lastInteractionAt: null, interactions: [], assignedUserId: "u", nextFollowUpDueAt: null, nextFollowUpOverdue: false, deals: [], quotes: [], now,
  });
  assert.deepEqual(assessOpportunities(assessSignals(input(true))), []);
  assert.deepEqual(assessOpportunities(assessSignals(input(false))), [
    {
      type: "WEBSITE",
      service: "website_creation",
      reason: "NO_WEBSITE_DETECTED",
      evidence: { website: null, discoveryCategory: "dentist", discoveryBusinessStatus: "OPERATIONAL", discoveredAt },
      sourceSignals: ["NO_WEBSITE"],
    },
  ]);
  assert.deepEqual(assessOpportunities(assessSignals(input(false, "CLOSED_PERMANENTLY"))), [], "BUSINESS_CLOSED still blocks WEBSITE");
  assert.deepEqual(assessOpportunities(assessSignals(input(true, "CLOSED_PERMANENTLY"))), []);
});

test("4F.7.1 absence of NO_WEBSITE -> no WEBSITE; other opportunities unaffected and in the same order", () => {
  assert.deepEqual(assessOpportunities([pastValidity(), pastClose()]).map((o) => o.type), ["PROPOSAL_RENEWAL", "DEAL_STALLED"]);
  assert.deepEqual(assessOpportunities([noWebsite(), pastValidity(), pastClose()]).map((o) => o.type), ["WEBSITE", "PROPOSAL_RENEWAL", "DEAL_STALLED"]);
});

// =========================================================
// MICRO-STEP 4F.8.7 — DEAL_STALLED is evaluated PER DEAL from the signal's
// own dealContactState; RECENT deals are left out; the global contactState is
// gone; lastInteractionAt = the prospect's real latest interaction.
// =========================================================

function dealEntry(dealId, dealContactState, lastDealInteractionAt = null, day = 1) {
  return { dealId, stage: "new", expectedCloseDate: new Date(Date.UTC(2026, 7, day)), overdueDays: 30 - day, lastDealInteractionAt, dealContactState };
}
const RECENT_AT = new Date("2026-08-27T10:00:00Z");

test("4F.8.7 one stalled deal -> DEAL_STALLED with exactly that deal", () => {
  const deal = dealEntry("d-a", "NONE_RECORDED");
  const [ds] = stalled(assessOpportunities([signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 1, overdueDeals: [deal] } })]));
  assert.deepEqual(ds.evidence, { overdueDealCount: 1, overdueDeals: [deal], lastInteractionAt: null });
  assert.deepEqual(ds.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE"]);
});

test("4F.8.7 mixed deals: RECENT left out; overdueDealCount = number of STALLED deals (not of overdue deals); order kept", () => {
  const deals = [dealEntry("d-1", "STALE", STALE_AT, 1), dealEntry("d-2", "RECENT", RECENT_AT, 2), dealEntry("d-3", "NONE_RECORDED", null, 3)];
  const [ds] = stalled(assessOpportunities([signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 3, overdueDeals: deals } }), noRecent(STALE_AT)]));
  assert.equal(ds.evidence.overdueDealCount, 2);
  assert.deepEqual(ds.evidence.overdueDeals, [deals[0], deals[2]]);
  assert.deepEqual(ds.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE", "NO_RECENT_INTERACTION"]);
});

test("4F.8.7 global RECENT_ACTIVITY present but a deal-specific NONE_RECORDED/STALE deal -> DEAL_STALLED; lastInteractionAt = the prospect's real latest interaction", () => {
  const deal = dealEntry("d-a", "NONE_RECORDED");
  const [ds] = stalled(assessOpportunities([signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 1, overdueDeals: [deal] } }), recentActivity()]));
  assert.ok(ds, "RECENT_ACTIVITY on the prospect no longer masks an individually stalled deal");
  assert.deepEqual(ds.evidence, { overdueDealCount: 1, overdueDeals: [deal], lastInteractionAt: RECENT_AT });
  assert.deepEqual(ds.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE"], "RECENT_ACTIVITY is never a source signal");
});

test("4F.8.7 evidence copied faithfully: exact keys, no global contactState, entries are the signal's own (not recomputed)", () => {
  const deals = [dealEntry("d-1", "STALE", STALE_AT, 1)];
  const [ds] = stalled(assessOpportunities([signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 1, overdueDeals: structuredClone(deals) } }), noRecent(STALE_AT)]));
  assert.deepEqual(Object.keys(ds.evidence).sort(), ["lastInteractionAt", "overdueDealCount", "overdueDeals"]);
  assert.deepEqual(ds.evidence.overdueDeals, deals);
  assert.deepEqual(Object.keys(ds.evidence.overdueDeals[0]).sort(), ["dealContactState", "dealId", "expectedCloseDate", "lastDealInteractionAt", "overdueDays", "stage"]);
});

test("4F.8.7 only RECENT overdue deals -> no DEAL_STALLED, other opportunities unchanged", () => {
  const deals = [dealEntry("d-1", "RECENT", RECENT_AT, 1), dealEntry("d-2", "RECENT", RECENT_AT, 2)];
  const result = assessOpportunities([signal("DEAL_PAST_EXPECTED_CLOSE", { evidence: { overdueDealCount: 2, overdueDeals: deals } }), pastValidity()]);
  assert.deepEqual(result.map((o) => o.type), ["PROPOSAL_RENEWAL"]);
});
