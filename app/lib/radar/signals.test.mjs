// Pure unit tests for lib/radar/signals.ts's assessSignals() — MICRO-STEP 2.
// Zero I/O, zero database, zero network, zero AI call — plain function over
// fixture data, exactly like score.test.mjs / qualification.test.mjs.
// Run with: npx tsx --test lib/radar/signals.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assessSignals,
  RADAR_SIGNAL_TYPES,
  RADAR_SIGNAL_REASON_CODES,
  DISCOVERY_NEW_THRESHOLD_DAYS,
  RECENT_INTERACTION_THRESHOLD_DAYS,
} from "./signals.ts";

const NOW = new Date("2026-08-28T12:00:00Z");
const SIGNAL_TYPE_SET = new Set(RADAR_SIGNAL_TYPES);
const REASON_CODE_SET = new Set(RADAR_SIGNAL_REASON_CODES);

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

// Signals V2 inputs default to NEUTRAL values (assigned, a future
// non-overdue follow-up, no deal, no quote) so every V1 test below keeps
// its exact original meaning and emits no V2 signal unless it opts in.
function base(overrides = {}) {
  return {
    source: null,
    discoverySource: null,
    discoveredAt: null,
    hasCrmWebsite: false,
    lastInteractionAt: null,
    interactions: [],
    assignedUserId: "user-assigned",
    nextFollowUpDueAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    nextFollowUpOverdue: false,
    deals: [],
    quotes: [],
    now: NOW,
    ...overrides,
  };
}

function typesOf(signals) {
  return signals.map((s) => s.type);
}
function has(signals, type) {
  return signals.some((s) => s.type === type);
}

// ---- no signal at all ----
test("a plain prospect with no Discovery link and no interaction history ever produces an empty array", () => {
  const signals = assessSignals(base());
  assert.deepEqual(signals, []);
});

// ---- DISCOVERY_NEW ----
test("DISCOVERY_NEW fires when source is RADAR Discovery and discoveredAt is within the threshold", () => {
  const signals = assessSignals(base({ source: "RADAR Discovery", discoveredAt: daysAgo(1) }));
  assert.ok(has(signals, "DISCOVERY_NEW"));
  const signal = signals.find((s) => s.type === "DISCOVERY_NEW");
  assert.equal(signal.color, "blue");
  assert.equal(signal.severity, "info");
  assert.equal(signal.reason, "DISCOVERED_VIA_RADAR_DISCOVERY_RECENTLY");
  assert.deepEqual(signal.evidence, { discoveredAt: daysAgo(1) });
  assert.deepEqual(signal.detectedAt, NOW);
});

test("DISCOVERY_NEW does not fire once discoveredAt is older than DISCOVERY_NEW_THRESHOLD_DAYS", () => {
  const signals = assessSignals(base({ source: "RADAR Discovery", discoveredAt: daysAgo(DISCOVERY_NEW_THRESHOLD_DAYS + 1) }));
  assert.ok(!has(signals, "DISCOVERY_NEW"));
});

test("DISCOVERY_NEW fires at exactly the threshold boundary (<=), not just strictly under it", () => {
  const signals = assessSignals(base({ source: "RADAR Discovery", discoveredAt: daysAgo(DISCOVERY_NEW_THRESHOLD_DAYS) }));
  assert.ok(has(signals, "DISCOVERY_NEW"));
});

test("DISCOVERY_NEW never fires when source is not the literal RADAR Discovery label, even with a recent discoveredAt", () => {
  const signals = assessSignals(base({ source: "manual", discoveredAt: daysAgo(1) }));
  assert.ok(!has(signals, "DISCOVERY_NEW"));
});

test("DISCOVERY_NEW never fires when source is RADAR Discovery but discoveredAt is null", () => {
  const signals = assessSignals(base({ source: "RADAR Discovery", discoveredAt: null }));
  assert.ok(!has(signals, "DISCOVERY_NEW"));
});

test("DISCOVERY_NEW never fires for a prospect with no Discovery link at all (source null)", () => {
  const signals = assessSignals(base());
  assert.ok(!has(signals, "DISCOVERY_NEW"));
});

// ---- NO_WEBSITE ----
test("NO_WEBSITE fires when discoverySource exists and website is null", () => {
  const signals = assessSignals(base({ discoverySource: { category: "restaurant", website: null, businessStatus: null } }));
  assert.ok(has(signals, "NO_WEBSITE"));
  const signal = signals.find((s) => s.type === "NO_WEBSITE");
  assert.equal(signal.color, "orange");
  assert.equal(signal.severity, "important");
  assert.equal(signal.reason, "DISCOVERY_WEBSITE_ABSENT");
  // 4F.6.6 — provenance copied from the input (base() has discoveredAt: null).
  assert.deepEqual(signal.evidence, { website: null, discoveryCategory: "restaurant", discoveryBusinessStatus: null, discoveredAt: null });
});

test("NO_WEBSITE never fires when discoverySource has a non-null website", () => {
  const signals = assessSignals(base({ discoverySource: { category: null, website: "https://example.test", businessStatus: null } }));
  assert.ok(!has(signals, "NO_WEBSITE"));
});

test("NO_WEBSITE never fires when discoverySource itself is null (no Discovery link -- never fabricate 'no website' from the absence of any Discovery data)", () => {
  const signals = assessSignals(base({ discoverySource: null }));
  assert.ok(!has(signals, "NO_WEBSITE"));
});

// ---- BUSINESS_CLOSED ----
test("BUSINESS_CLOSED fires when businessStatus is exactly CLOSED_PERMANENTLY", () => {
  const signals = assessSignals(base({ discoverySource: { category: null, website: null, businessStatus: "CLOSED_PERMANENTLY" } }));
  assert.ok(has(signals, "BUSINESS_CLOSED"));
  const signal = signals.find((s) => s.type === "BUSINESS_CLOSED");
  assert.equal(signal.color, "red");
  assert.equal(signal.severity, "critical");
  assert.equal(signal.reason, "DISCOVERY_BUSINESS_CLOSED_PERMANENTLY");
  assert.deepEqual(signal.evidence, { businessStatus: "CLOSED_PERMANENTLY" });
});

test("BUSINESS_CLOSED never fires for CLOSED_TEMPORARILY", () => {
  const signals = assessSignals(base({ discoverySource: { category: null, website: null, businessStatus: "CLOSED_TEMPORARILY" } }));
  assert.ok(!has(signals, "BUSINESS_CLOSED"));
});

test("BUSINESS_CLOSED never fires for OPERATIONAL", () => {
  const signals = assessSignals(base({ discoverySource: { category: null, website: null, businessStatus: "OPERATIONAL" } }));
  assert.ok(!has(signals, "BUSINESS_CLOSED"));
});

test("BUSINESS_CLOSED never fires when businessStatus is null", () => {
  const signals = assessSignals(base({ discoverySource: { category: null, website: null, businessStatus: null } }));
  assert.ok(!has(signals, "BUSINESS_CLOSED"));
});

test("BUSINESS_CLOSED never fires when discoverySource itself is null", () => {
  const signals = assessSignals(base({ discoverySource: null }));
  assert.ok(!has(signals, "BUSINESS_CLOSED"));
});

// ---- RECENT_ACTIVITY / NO_RECENT_INTERACTION (mutually exclusive) ----
test("RECENT_ACTIVITY fires for a recent interaction, never alongside NO_RECENT_INTERACTION", () => {
  const signals = assessSignals(base({ lastInteractionAt: daysAgo(1) }));
  assert.ok(has(signals, "RECENT_ACTIVITY"));
  assert.ok(!has(signals, "NO_RECENT_INTERACTION"));
  const signal = signals.find((s) => s.type === "RECENT_ACTIVITY");
  assert.equal(signal.color, "green");
  assert.equal(signal.severity, "favorable");
  assert.equal(signal.reason, "INTERACTION_WITHIN_THRESHOLD");
  assert.deepEqual(signal.evidence, { lastInteractionAt: daysAgo(1), thresholdDays: RECENT_INTERACTION_THRESHOLD_DAYS });
});

test("RECENT_ACTIVITY fires at exactly the threshold boundary (<=)", () => {
  const signals = assessSignals(base({ lastInteractionAt: daysAgo(RECENT_INTERACTION_THRESHOLD_DAYS) }));
  assert.ok(has(signals, "RECENT_ACTIVITY"));
  assert.ok(!has(signals, "NO_RECENT_INTERACTION"));
});

test("NO_RECENT_INTERACTION fires for a stale interaction (older than the threshold), never alongside RECENT_ACTIVITY", () => {
  const signals = assessSignals(base({ lastInteractionAt: daysAgo(RECENT_INTERACTION_THRESHOLD_DAYS + 1) }));
  assert.ok(has(signals, "NO_RECENT_INTERACTION"));
  assert.ok(!has(signals, "RECENT_ACTIVITY"));
  const signal = signals.find((s) => s.type === "NO_RECENT_INTERACTION");
  assert.equal(signal.color, "yellow");
  assert.equal(signal.severity, "attention");
  assert.equal(signal.reason, "NO_INTERACTION_WITHIN_THRESHOLD");
});

test("neither RECENT_ACTIVITY nor NO_RECENT_INTERACTION fires when lastInteractionAt is null (no interaction history at all, nothing yet to flag)", () => {
  const signals = assessSignals(base({ lastInteractionAt: null }));
  assert.ok(!has(signals, "RECENT_ACTIVITY"));
  assert.ok(!has(signals, "NO_RECENT_INTERACTION"));
});

// ---- several signals simultaneously ----
test("several signals can co-occur: DISCOVERY_NEW + NO_WEBSITE + BUSINESS_CLOSED + NO_RECENT_INTERACTION", () => {
  const signals = assessSignals(
    base({
      source: "RADAR Discovery",
      discoveredAt: daysAgo(2),
      discoverySource: { category: "restaurant", website: null, businessStatus: "CLOSED_PERMANENTLY" },
      lastInteractionAt: daysAgo(90),
    }),
  );
  assert.deepEqual(
    new Set(typesOf(signals)),
    new Set(["DISCOVERY_NEW", "NO_WEBSITE", "BUSINESS_CLOSED", "NO_RECENT_INTERACTION"]),
  );
});

test("a freshly discovered prospect with a website and a recent interaction only produces DISCOVERY_NEW + RECENT_ACTIVITY (favorable signals never forced into a problem bucket)", () => {
  const signals = assessSignals(
    base({
      source: "RADAR Discovery",
      discoveredAt: daysAgo(1),
      discoverySource: { category: "plumber", website: "https://example.test", businessStatus: "OPERATIONAL" },
      lastInteractionAt: daysAgo(1),
    }),
  );
  assert.deepEqual(new Set(typesOf(signals)), new Set(["DISCOVERY_NEW", "RECENT_ACTIVITY"]));
});

// ---- structural / closed-set guarantees ----
test("every emitted signal's type/reason belongs to the closed RADAR_SIGNAL_TYPES / RADAR_SIGNAL_REASON_CODES sets", () => {
  const signals = assessSignals(
    base({
      source: "RADAR Discovery",
      discoveredAt: daysAgo(1),
      discoverySource: { category: "x", website: null, businessStatus: "CLOSED_PERMANENTLY" },
      lastInteractionAt: daysAgo(1),
    }),
  );
  for (const signal of signals) {
    assert.ok(SIGNAL_TYPE_SET.has(signal.type), `${signal.type} must be in RADAR_SIGNAL_TYPES`);
    assert.ok(REASON_CODE_SET.has(signal.reason), `${signal.reason} must be in RADAR_SIGNAL_REASON_CODES`);
    assert.ok(signal.detectedAt instanceof Date);
  }
});

test("purple is never used as a color — reserved for a future AI-origin signal", () => {
  const signals = assessSignals(
    base({
      source: "RADAR Discovery",
      discoveredAt: daysAgo(1),
      discoverySource: { category: "x", website: null, businessStatus: "CLOSED_PERMANENTLY" },
      lastInteractionAt: daysAgo(1),
    }),
  );
  assert.ok(signals.every((s) => s.color !== "purple"));
});

test("assessSignals is deterministic: identical input always produces an identical result", () => {
  const input = base({
    source: "RADAR Discovery",
    discoveredAt: daysAgo(3),
    discoverySource: { category: "x", website: null, businessStatus: "OPERATIONAL" },
    lastInteractionAt: daysAgo(5),
  });
  assert.deepEqual(assessSignals(input), assessSignals(input));
});

test("now defaults to the real current time when omitted (still returns an array, never throws)", () => {
  const withoutNow = base();
  delete withoutNow.now;
  const signals = assessSignals(withoutNow);
  assert.ok(Array.isArray(signals));
});

// =========================================================
// Signals V2 — MICRO-STEP 4E.2 (class A: already-loaded CRM facts only)
// =========================================================

function only(signals, type) {
  return signals.filter((s) => s.type === type);
}

// ---- UNASSIGNED ----
test("V2 UNASSIGNED fires when assignedUserId is null, with spec color/severity/reason and evidence", () => {
  const [signal] = only(assessSignals(base({ assignedUserId: null })), "UNASSIGNED");
  assert.ok(signal);
  assert.equal(signal.color, "yellow");
  assert.equal(signal.severity, "attention");
  assert.equal(signal.reason, "PROSPECT_UNASSIGNED");
  assert.deepEqual(signal.evidence, { assignedUserId: null });
  assert.deepEqual(signal.detectedAt, NOW);
});

test("V2 UNASSIGNED does not fire when assignedUserId is set", () => {
  assert.ok(!has(assessSignals(base({ assignedUserId: "user-1" })), "UNASSIGNED"));
});

test("V2 UNASSIGNED edge: an empty-string assignedUserId is not treated as unassigned (strict null rule)", () => {
  assert.ok(!has(assessSignals(base({ assignedUserId: "" })), "UNASSIGNED"));
});

// ---- FOLLOW_UP_OVERDUE / NO_FOLLOW_UP_SCHEDULED ----
test("V2 FOLLOW_UP_OVERDUE fires when a dated follow-up is flagged overdue, with spec values and evidence", () => {
  const due = daysAgo(2);
  const [signal] = only(assessSignals(base({ nextFollowUpDueAt: due, nextFollowUpOverdue: true })), "FOLLOW_UP_OVERDUE");
  assert.ok(signal);
  assert.equal(signal.color, "orange");
  assert.equal(signal.severity, "important");
  assert.equal(signal.reason, "FOLLOW_UP_PAST_DUE");
  assert.deepEqual(signal.evidence, { nextFollowUpDueAt: due });
});

test("V2 FOLLOW_UP_OVERDUE does not fire for a dated follow-up that is not overdue", () => {
  const signals = assessSignals(base({ nextFollowUpDueAt: daysAgo(-3), nextFollowUpOverdue: false }));
  assert.ok(!has(signals, "FOLLOW_UP_OVERDUE"));
  assert.ok(!has(signals, "NO_FOLLOW_UP_SCHEDULED"));
});

test("V2 FOLLOW_UP_OVERDUE edge: the flag is trusted verbatim — a past date with overdue=false does not fire (no second definition of 'overdue')", () => {
  assert.ok(!has(assessSignals(base({ nextFollowUpDueAt: daysAgo(10), nextFollowUpOverdue: false })), "FOLLOW_UP_OVERDUE"));
});

test("V2 NO_FOLLOW_UP_SCHEDULED fires when there is no open dated follow-up, with spec values and evidence", () => {
  const [signal] = only(assessSignals(base({ nextFollowUpDueAt: null, nextFollowUpOverdue: false })), "NO_FOLLOW_UP_SCHEDULED");
  assert.ok(signal);
  assert.equal(signal.color, "yellow");
  assert.equal(signal.severity, "attention");
  assert.equal(signal.reason, "NO_OPEN_DATED_FOLLOW_UP");
  assert.deepEqual(signal.evidence, { nextFollowUpDueAt: null });
});

test("V2 NO_FOLLOW_UP_SCHEDULED does not fire when a dated follow-up exists", () => {
  assert.ok(!has(assessSignals(base({ nextFollowUpDueAt: daysAgo(-1) })), "NO_FOLLOW_UP_SCHEDULED"));
});

test("V2 mutual exclusion: FOLLOW_UP_OVERDUE and NO_FOLLOW_UP_SCHEDULED never co-occur, even for an inconsistent input", () => {
  const cases = [
    { nextFollowUpDueAt: null, nextFollowUpOverdue: false },
    { nextFollowUpDueAt: null, nextFollowUpOverdue: true }, // inconsistent on purpose
    { nextFollowUpDueAt: daysAgo(1), nextFollowUpOverdue: true },
    { nextFollowUpDueAt: daysAgo(-1), nextFollowUpOverdue: false },
  ];
  for (const c of cases) {
    const signals = assessSignals(base(c));
    assert.ok(!(has(signals, "FOLLOW_UP_OVERDUE") && has(signals, "NO_FOLLOW_UP_SCHEDULED")), JSON.stringify(c));
  }
  assert.ok(has(assessSignals(base({ nextFollowUpDueAt: null, nextFollowUpOverdue: true })), "NO_FOLLOW_UP_SCHEDULED"), "no date wins");
});

// ---- DEAL_ACTIVE ----
test("V2 DEAL_ACTIVE fires for an open deal, with spec values and an openDealCount evidence", () => {
  const [signal] = only(assessSignals(base({ deals: [{ stage: "qualified" }, { stage: "won" }, { stage: "proposal" }] })), "DEAL_ACTIVE");
  assert.ok(signal);
  assert.equal(signal.color, "green");
  assert.equal(signal.severity, "favorable");
  assert.equal(signal.reason, "OPEN_DEAL_PRESENT");
  assert.deepEqual(signal.evidence, { openDealCount: 2 });
});

test("V2 DEAL_ACTIVE fires for every open stage: new, contacted, qualified, proposal", () => {
  for (const stage of ["new", "contacted", "qualified", "proposal"]) {
    assert.ok(has(assessSignals(base({ deals: [{ stage }] })), "DEAL_ACTIVE"), stage);
  }
});

test("V2 DEAL_ACTIVE does not fire for a won deal alone", () => {
  assert.ok(!has(assessSignals(base({ deals: [{ stage: "won" }] })), "DEAL_ACTIVE"));
});

test("V2 DEAL_ACTIVE does not fire for a lost deal alone", () => {
  assert.ok(!has(assessSignals(base({ deals: [{ stage: "lost" }] })), "DEAL_ACTIVE"));
});

test("V2 DEAL_ACTIVE edge: no deal at all, or only won + lost, never fires", () => {
  assert.ok(!has(assessSignals(base({ deals: [] })), "DEAL_ACTIVE"));
  assert.ok(!has(assessSignals(base({ deals: [{ stage: "won" }, { stage: "lost" }] })), "DEAL_ACTIVE"));
});

// ---- QUOTE_PENDING ----
test("V2 QUOTE_PENDING fires for a sent quote without response, with spec values and a pendingQuoteCount evidence", () => {
  const [signal] = only(
    assessSignals(base({ quotes: [{ status: "sent", respondedAt: null }, { status: "sent", respondedAt: null }, { status: "draft", respondedAt: null }] })),
    "QUOTE_PENDING",
  );
  assert.ok(signal);
  assert.equal(signal.color, "yellow");
  assert.equal(signal.severity, "attention");
  assert.equal(signal.reason, "QUOTE_AWAITING_RESPONSE");
  assert.deepEqual(signal.evidence, { pendingQuoteCount: 2 });
});

test("V2 QUOTE_PENDING does not fire for a draft quote", () => {
  assert.ok(!has(assessSignals(base({ quotes: [{ status: "draft", respondedAt: null }] })), "QUOTE_PENDING"));
});

test("V2 QUOTE_PENDING does not fire for an accepted quote", () => {
  assert.ok(!has(assessSignals(base({ quotes: [{ status: "accepted", respondedAt: daysAgo(1) }] })), "QUOTE_PENDING"));
});

test("V2 QUOTE_PENDING does not fire for a sent quote that has a response", () => {
  assert.ok(!has(assessSignals(base({ quotes: [{ status: "sent", respondedAt: daysAgo(1) }] })), "QUOTE_PENDING"));
});

test("V2 QUOTE_PENDING edge: declined / expired never fire, and an undefined respondedAt counts as no response", () => {
  assert.ok(!has(assessSignals(base({ quotes: [{ status: "declined", respondedAt: null }, { status: "expired", respondedAt: null }] })), "QUOTE_PENDING"));
  assert.ok(has(assessSignals(base({ quotes: [{ status: "sent" }] })), "QUOTE_PENDING"));
});

// ---- combined / structural ----
test("V2 a bare prospect (unassigned, no follow-up, nothing else) yields exactly UNASSIGNED + NO_FOLLOW_UP_SCHEDULED", () => {
  const signals = assessSignals(base({ assignedUserId: null, nextFollowUpDueAt: null }));
  assert.deepEqual(typesOf(signals), ["UNASSIGNED", "NO_FOLLOW_UP_SCHEDULED"]);
});

test("V2 all five new signals can co-occur with V1 signals, in a deterministic order", () => {
  const input = base({
    source: "RADAR Discovery",
    discoveredAt: daysAgo(1),
    discoverySource: { category: "x", website: null, businessStatus: "OPERATIONAL" },
    lastInteractionAt: daysAgo(1),
    assignedUserId: null,
    nextFollowUpDueAt: daysAgo(2),
    nextFollowUpOverdue: true,
    deals: [{ stage: "proposal" }],
    quotes: [{ status: "sent", respondedAt: null }],
  });
  assert.deepEqual(typesOf(assessSignals(input)), [
    "DISCOVERY_NEW",
    "NO_WEBSITE",
    "RECENT_ACTIVITY",
    "UNASSIGNED",
    "FOLLOW_UP_OVERDUE",
    "DEAL_ACTIVE",
    "QUOTE_PENDING",
  ]);
  assert.deepEqual(assessSignals(input), assessSignals(input), "deterministic");
});

test("V2 every new signal type and reason code belongs to the closed sets; purple is never used", () => {
  const signals = assessSignals(
    base({ assignedUserId: null, nextFollowUpDueAt: daysAgo(2), nextFollowUpOverdue: true, deals: [{ stage: "new" }], quotes: [{ status: "sent", respondedAt: null }] }),
  );
  assert.equal(signals.length, 4);
  for (const signal of signals) {
    assert.ok(SIGNAL_TYPE_SET.has(signal.type));
    assert.ok(REASON_CODE_SET.has(signal.reason));
    assert.notEqual(signal.color, "purple");
  }
});

test("V2 inputs are never mutated", () => {
  const input = base({ assignedUserId: null, deals: [{ stage: "new" }], quotes: [{ status: "sent", respondedAt: null }] });
  const snapshot = structuredClone(input);
  assessSignals(input);
  assert.deepEqual(input, snapshot);
});

// =========================================================
// Signals V2 phase B — MICRO-STEP 4E.3 (DEAL_PAST_EXPECTED_CLOSE,
// QUOTE_PAST_VALIDITY). Since 4E.5 a date is past only when it falls before
// the start of now's UTC day; any instant on now's UTC day is not past.
// =========================================================

const PAST = daysAgo(1);
const FUTURE = daysAgo(-1);

function deal(stage, expectedCloseDate = null, id = `deal-${stage}`) {
  return { id, stage, expectedCloseDate };
}
// 4F.6.2 evidence entry for one overdue deal (fixture ids are deal-<stage> by default).
function overdue(stage, expectedCloseDate, overdueDays, dealId = `deal-${stage}`, lastDealInteractionAt = null, dealContactState = "NONE_RECORDED") {
  return { dealId, stage, expectedCloseDate, overdueDays, lastDealInteractionAt, dealContactState };
}
function quote(status, { respondedAt = null, validUntil = null, id = `q-${status}`, dealId = null } = {}) {
  return { id, dealId, status, respondedAt, validUntil };
}
// 4F.6.4 evidence entry for one expired quote (fixture ids are q-<status> by default).
function expiredQ(validUntil, daysPastValidity, quoteId = "q-sent", dealId = null) {
  return { quoteId, validUntil, dealId, daysPastValidity };
}

// ---- DEAL_PAST_EXPECTED_CLOSE ----
test("4E.3 DEAL_PAST_EXPECTED_CLOSE fires for an open deal past its expected close, with spec values and evidence", () => {
  const [signal] = only(assessSignals(base({ deals: [deal("qualified", PAST)] })), "DEAL_PAST_EXPECTED_CLOSE");
  assert.ok(signal);
  assert.equal(signal.color, "orange");
  assert.equal(signal.severity, "important");
  assert.equal(signal.reason, "DEAL_EXPECTED_CLOSE_PASSED");
  assert.deepEqual(signal.evidence, { overdueDealCount: 1, overdueDeals: [overdue("qualified", PAST, 1)] });
  assert.deepEqual(signal.detectedAt, NOW);
});

test("4E.3 DEAL_PAST_EXPECTED_CLOSE does not fire for a future expected close", () => {
  assert.ok(!has(assessSignals(base({ deals: [deal("qualified", FUTURE)] })), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.3/4E.5 DEAL_PAST_EXPECTED_CLOSE does not fire when expectedCloseDate is the exact now instant (same UTC day)", () => {
  assert.ok(!has(assessSignals(base({ deals: [deal("qualified", new Date(NOW.getTime()))] })), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.3 DEAL_PAST_EXPECTED_CLOSE does not fire without expectedCloseDate (null or absent)", () => {
  assert.ok(!has(assessSignals(base({ deals: [deal("qualified", null)] })), "DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(!has(assessSignals(base({ deals: [{ stage: "qualified" }] })), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.3 DEAL_PAST_EXPECTED_CLOSE does not fire for a won deal past its date", () => {
  assert.ok(!has(assessSignals(base({ deals: [deal("won", PAST)] })), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.3 DEAL_PAST_EXPECTED_CLOSE does not fire for a lost deal past its date", () => {
  assert.ok(!has(assessSignals(base({ deals: [deal("lost", PAST)] })), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.3 several deals: overdueDealCount counts only open deals past their date", () => {
  const signals = assessSignals(
    base({ deals: [deal("new", PAST), deal("proposal", daysAgo(30)), deal("won", PAST), deal("lost", PAST), deal("qualified", FUTURE), deal("contacted")] }),
  );
  assert.deepEqual(only(signals, "DEAL_PAST_EXPECTED_CLOSE")[0].evidence, {
    overdueDealCount: 2,
    overdueDeals: [overdue("proposal", daysAgo(30), 30), overdue("new", PAST, 1)],
  });
});

test("4E.3 DEAL_ACTIVE vs DEAL_PAST_EXPECTED_CLOSE — exclusion is per deal: only-overdue -> PAST only; only-valid -> ACTIVE only; mixed -> both, counted separately", () => {
  const overdueOnly = assessSignals(base({ deals: [deal("qualified", PAST)] }));
  assert.ok(has(overdueOnly, "DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(!has(overdueOnly, "DEAL_ACTIVE"), "the overdue deal is not counted as active");

  const validOnly = assessSignals(base({ deals: [deal("qualified", FUTURE), deal("new")] }));
  assert.ok(!has(validOnly, "DEAL_PAST_EXPECTED_CLOSE"));
  assert.deepEqual(only(validOnly, "DEAL_ACTIVE")[0].evidence, { openDealCount: 2 }, "future date and no date both count as active");

  const mixed = assessSignals(base({ deals: [deal("qualified", PAST), deal("proposal", FUTURE), deal("new")] }));
  assert.deepEqual(only(mixed, "DEAL_ACTIVE")[0].evidence, { openDealCount: 2 });
  assert.deepEqual(only(mixed, "DEAL_PAST_EXPECTED_CLOSE")[0].evidence, { overdueDealCount: 1, overdueDeals: [overdue("qualified", PAST, 1)] });
  assert.deepEqual(
    typesOf(mixed).filter((t) => t.startsWith("DEAL_")),
    ["DEAL_ACTIVE", "DEAL_PAST_EXPECTED_CLOSE"],
    "deterministic order: DEAL_ACTIVE then DEAL_PAST_EXPECTED_CLOSE",
  );
});

// ---- QUOTE_PAST_VALIDITY ----
test("4E.3 QUOTE_PAST_VALIDITY fires for a sent, unanswered quote past validUntil, with spec values and evidence", () => {
  const [signal] = only(assessSignals(base({ quotes: [quote("sent", { validUntil: PAST })] })), "QUOTE_PAST_VALIDITY");
  assert.ok(signal);
  assert.equal(signal.color, "orange");
  assert.equal(signal.severity, "important");
  assert.equal(signal.reason, "QUOTE_VALIDITY_PASSED");
  assert.deepEqual(signal.evidence, { expiredQuoteCount: 1, expiredQuotes: [expiredQ(PAST, 1)] });
});

test("4E.3 QUOTE_PAST_VALIDITY does not fire for a future validUntil", () => {
  assert.ok(!has(assessSignals(base({ quotes: [quote("sent", { validUntil: FUTURE })] })), "QUOTE_PAST_VALIDITY"));
});

test("4E.3/4E.5 QUOTE_PAST_VALIDITY does not fire when validUntil is the exact now instant (same UTC day)", () => {
  assert.ok(!has(assessSignals(base({ quotes: [quote("sent", { validUntil: new Date(NOW.getTime()) })] })), "QUOTE_PAST_VALIDITY"));
});

test("4E.3 QUOTE_PAST_VALIDITY does not fire without validUntil (null or absent)", () => {
  assert.ok(!has(assessSignals(base({ quotes: [quote("sent")] })), "QUOTE_PAST_VALIDITY"));
  assert.ok(!has(assessSignals(base({ quotes: [{ status: "sent", respondedAt: null }] })), "QUOTE_PAST_VALIDITY"));
});

test("4E.3 QUOTE_PAST_VALIDITY does not fire for a sent quote that has a response", () => {
  assert.ok(!has(assessSignals(base({ quotes: [quote("sent", { respondedAt: daysAgo(3), validUntil: PAST })] })), "QUOTE_PAST_VALIDITY"));
});

test("4E.3 QUOTE_PAST_VALIDITY does not fire for accepted, declined or draft quotes past validUntil", () => {
  for (const status of ["accepted", "declined", "draft"]) {
    assert.ok(!has(assessSignals(base({ quotes: [quote(status, { validUntil: PAST })] })), "QUOTE_PAST_VALIDITY"), status);
  }
});

test("4E.3 the stored 'expired' status is never the source: expired + past validUntil fires nothing; sent + past validUntil fires", () => {
  const expired = assessSignals(base({ quotes: [quote("expired", { validUntil: PAST })] }));
  assert.ok(!has(expired, "QUOTE_PAST_VALIDITY"));
  assert.ok(!has(expired, "QUOTE_PENDING"));
  assert.ok(has(assessSignals(base({ quotes: [quote("sent", { validUntil: PAST })] })), "QUOTE_PAST_VALIDITY"));
});

test("4E.3 several quotes: expiredQuoteCount counts only sent, unanswered quotes past validUntil", () => {
  const signals = assessSignals(
    base({
      quotes: [
        quote("sent", { validUntil: PAST, id: "q-1" }),
        quote("sent", { validUntil: daysAgo(40), id: "q-2" }),
        quote("sent", { validUntil: PAST, respondedAt: daysAgo(2) }),
        quote("accepted", { validUntil: PAST }),
        quote("sent", { validUntil: FUTURE }),
      ],
    }),
  );
  assert.deepEqual(only(signals, "QUOTE_PAST_VALIDITY")[0].evidence, {
    expiredQuoteCount: 2,
    expiredQuotes: [expiredQ(daysAgo(40), 40, "q-2"), expiredQ(PAST, 1, "q-1")],
  });
});

// ---- QUOTE_PENDING vs QUOTE_PAST_VALIDITY ----
test("4E.3 exclusion: a valid sent quote -> QUOTE_PENDING only; a past-validity sent quote -> QUOTE_PAST_VALIDITY only", () => {
  const valid = assessSignals(base({ quotes: [quote("sent", { validUntil: FUTURE })] }));
  assert.ok(has(valid, "QUOTE_PENDING"));
  assert.ok(!has(valid, "QUOTE_PAST_VALIDITY"));

  const pastValidity = assessSignals(base({ quotes: [quote("sent", { validUntil: PAST })] }));
  assert.ok(has(pastValidity, "QUOTE_PAST_VALIDITY"));
  assert.ok(!has(pastValidity, "QUOTE_PENDING"));

  const noValidity = assessSignals(base({ quotes: [quote("sent")] }));
  assert.ok(has(noValidity, "QUOTE_PENDING"), "no validUntil -> stays pending, validity never invented");
  assert.ok(!has(noValidity, "QUOTE_PAST_VALIDITY"));
});

test("4E.3 exclusion is per quote: mixed valid + past quotes yield both signals with separate counts, in a deterministic order", () => {
  const mixed = assessSignals(base({ quotes: [quote("sent", { validUntil: PAST }), quote("sent", { validUntil: FUTURE }), quote("sent")] }));
  assert.deepEqual(only(mixed, "QUOTE_PENDING")[0].evidence, { pendingQuoteCount: 2 });
  assert.deepEqual(only(mixed, "QUOTE_PAST_VALIDITY")[0].evidence, { expiredQuoteCount: 1, expiredQuotes: [expiredQ(PAST, 1)] });
  assert.deepEqual(typesOf(mixed).filter((t) => t.startsWith("QUOTE_")), ["QUOTE_PENDING", "QUOTE_PAST_VALIDITY"]);
});

// ---- structural ----
test("4E.3 full deterministic emission order with every V2 signal present", () => {
  const input = base({
    assignedUserId: null,
    nextFollowUpDueAt: daysAgo(2),
    nextFollowUpOverdue: true,
    deals: [deal("qualified", PAST), deal("new")],
    quotes: [quote("sent", { validUntil: PAST }), quote("sent")],
  });
  assert.deepEqual(typesOf(assessSignals(input)), [
    "UNASSIGNED",
    "FOLLOW_UP_OVERDUE",
    "DEAL_ACTIVE",
    "DEAL_PAST_EXPECTED_CLOSE",
    "QUOTE_PENDING",
    "QUOTE_PAST_VALIDITY",
  ]);
  assert.deepEqual(assessSignals(input), assessSignals(input));
});

test("4E.3 new types and reason codes belong to the closed sets; inputs are never mutated", () => {
  const input = base({ deals: [deal("new", PAST)], quotes: [quote("sent", { validUntil: PAST })] });
  const snapshot = structuredClone(input);
  const signals = assessSignals(input);
  assert.deepEqual(input, snapshot);
  for (const signal of only(signals, "DEAL_PAST_EXPECTED_CLOSE").concat(only(signals, "QUOTE_PAST_VALIDITY"))) {
    assert.ok(SIGNAL_TYPE_SET.has(signal.type));
    assert.ok(REASON_CODE_SET.has(signal.reason));
  }
  assert.ok(SIGNAL_TYPE_SET.has("DEAL_PAST_EXPECTED_CLOSE") && SIGNAL_TYPE_SET.has("QUOTE_PAST_VALIDITY"));
  assert.ok(REASON_CODE_SET.has("DEAL_EXPECTED_CLOSE_PASSED") && REASON_CODE_SET.has("QUOTE_VALIDITY_PASSED"));
});

// =========================================================
// MICRO-STEP 4E.5 — calendar-date semantics. expectedCloseDate / validUntil
// are stored as UTC midnight of the chosen day (new Date("YYYY-MM-DD")).
// =========================================================

const CAL_NOW = new Date("2026-10-07T15:30:00.000Z");
const CAL_TODAY = new Date("2026-10-07T00:00:00.000Z");
const CAL_YESTERDAY = new Date("2026-10-06T00:00:00.000Z");
const CAL_TOMORROW = new Date("2026-10-08T00:00:00.000Z");

function cal(overrides) {
  return assessSignals(base({ now: CAL_NOW, ...overrides }));
}

// ---- DEAL_PAST_EXPECTED_CLOSE ----
test("4E.5 deal: expectedCloseDate = today (UTC midnight) is NOT past, even mid-afternoon", () => {
  const signals = cal({ deals: [deal("qualified", CAL_TODAY)] });
  assert.ok(!has(signals, "DEAL_PAST_EXPECTED_CLOSE"));
  assert.deepEqual(only(signals, "DEAL_ACTIVE")[0].evidence, { openDealCount: 1 }, "it still counts as an active deal");
});

test("4E.5 deal: expectedCloseDate = yesterday (UTC midnight) is past", () => {
  const signals = cal({ deals: [deal("qualified", CAL_YESTERDAY)] });
  assert.deepEqual(only(signals, "DEAL_PAST_EXPECTED_CLOSE")[0].evidence, { overdueDealCount: 1, overdueDeals: [overdue("qualified", CAL_YESTERDAY, 1)] });
  assert.ok(!has(signals, "DEAL_ACTIVE"));
});

test("4E.5 deal: expectedCloseDate = tomorrow is not past", () => {
  assert.ok(!has(cal({ deals: [deal("qualified", CAL_TOMORROW)] }), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.5 deal: today's date is not past at the very start nor at the very end of the UTC day", () => {
  for (const now of [new Date("2026-10-07T00:00:00.000Z"), new Date("2026-10-07T23:59:59.999Z")]) {
    assert.ok(!has(assessSignals(base({ now, deals: [deal("new", CAL_TODAY)] })), "DEAL_PAST_EXPECTED_CLOSE"), now.toISOString());
  }
});

test("4E.5 deal: yesterday's date becomes past exactly at the start of today's UTC day, not before", () => {
  const lastInstantOfYesterday = new Date("2026-10-06T23:59:59.999Z");
  const firstInstantOfToday = new Date("2026-10-07T00:00:00.000Z");
  assert.ok(!has(assessSignals(base({ now: lastInstantOfYesterday, deals: [deal("new", CAL_YESTERDAY)] })), "DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(has(assessSignals(base({ now: firstInstantOfToday, deals: [deal("new", CAL_YESTERDAY)] })), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.5 deal: null / undefined expectedCloseDate, won and lost never fire", () => {
  assert.ok(!has(cal({ deals: [deal("qualified", null)] }), "DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(!has(cal({ deals: [{ stage: "qualified" }] }), "DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(!has(cal({ deals: [deal("won", CAL_YESTERDAY)] }), "DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(!has(cal({ deals: [deal("lost", CAL_YESTERDAY)] }), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4E.5 deal: several deals — only open deals dated before today count as overdue", () => {
  const signals = cal({
    deals: [
      deal("new", CAL_YESTERDAY),
      deal("proposal", new Date("2026-09-01T00:00:00.000Z")),
      deal("qualified", CAL_TODAY),
      deal("contacted", CAL_TOMORROW),
      deal("won", CAL_YESTERDAY),
      deal("lost", CAL_YESTERDAY),
    ],
  });
  assert.deepEqual(only(signals, "DEAL_PAST_EXPECTED_CLOSE")[0].evidence, {
    overdueDealCount: 2,
    overdueDeals: [overdue("proposal", new Date("2026-09-01T00:00:00.000Z"), 36), overdue("new", CAL_YESTERDAY, 1)],
  });
  assert.deepEqual(only(signals, "DEAL_ACTIVE")[0].evidence, { openDealCount: 2 }, "today + tomorrow stay active");
});

// ---- QUOTE_PAST_VALIDITY / QUOTE_PENDING ----
test("4E.5 quote: validUntil = today (UTC midnight) is NOT past -> QUOTE_PENDING, not QUOTE_PAST_VALIDITY", () => {
  const signals = cal({ quotes: [quote("sent", { validUntil: CAL_TODAY })] });
  assert.ok(!has(signals, "QUOTE_PAST_VALIDITY"));
  assert.ok(has(signals, "QUOTE_PENDING"));
});

test("4E.5 quote: validUntil = yesterday (UTC midnight) -> QUOTE_PAST_VALIDITY, not QUOTE_PENDING", () => {
  const signals = cal({ quotes: [quote("sent", { validUntil: CAL_YESTERDAY })] });
  assert.deepEqual(only(signals, "QUOTE_PAST_VALIDITY")[0].evidence, { expiredQuoteCount: 1, expiredQuotes: [expiredQ(CAL_YESTERDAY, 1)] });
  assert.ok(!has(signals, "QUOTE_PENDING"));
});

test("4E.5 quote: validUntil = tomorrow -> QUOTE_PENDING only", () => {
  const signals = cal({ quotes: [quote("sent", { validUntil: CAL_TOMORROW })] });
  assert.ok(has(signals, "QUOTE_PENDING"));
  assert.ok(!has(signals, "QUOTE_PAST_VALIDITY"));
});

test("4E.5 quote: today's validity holds at the very start and the very end of the UTC day", () => {
  for (const now of [new Date("2026-10-07T00:00:00.000Z"), new Date("2026-10-07T23:59:59.999Z")]) {
    const signals = assessSignals(base({ now, quotes: [quote("sent", { validUntil: CAL_TODAY })] }));
    assert.ok(!has(signals, "QUOTE_PAST_VALIDITY"), now.toISOString());
    assert.ok(has(signals, "QUOTE_PENDING"), now.toISOString());
  }
});

test("4E.5 quote: null / undefined validUntil never past; answered or non-sent quotes never fire", () => {
  assert.ok(has(cal({ quotes: [quote("sent")] }), "QUOTE_PENDING"));
  assert.ok(!has(cal({ quotes: [quote("sent")] }), "QUOTE_PAST_VALIDITY"));
  assert.ok(!has(cal({ quotes: [{ status: "sent", respondedAt: null }] }), "QUOTE_PAST_VALIDITY"));
  assert.ok(!has(cal({ quotes: [quote("sent", { validUntil: CAL_YESTERDAY, respondedAt: CAL_YESTERDAY })] }), "QUOTE_PAST_VALIDITY"));
  for (const status of ["draft", "accepted", "declined", "expired"]) {
    const signals = cal({ quotes: [quote(status, { validUntil: CAL_YESTERDAY })] });
    assert.ok(!has(signals, "QUOTE_PAST_VALIDITY"), status);
    assert.ok(!has(signals, "QUOTE_PENDING"), status);
  }
});

test("4E.5 quote: several quotes — only sent, unanswered quotes dated before today count as past", () => {
  const signals = cal({
    quotes: [
      quote("sent", { validUntil: CAL_YESTERDAY, id: "q-1" }),
      quote("sent", { validUntil: new Date("2026-09-01T00:00:00.000Z"), id: "q-2" }),
      quote("sent", { validUntil: CAL_TODAY }),
      quote("sent", { validUntil: CAL_TOMORROW }),
      quote("sent"),
      quote("sent", { validUntil: CAL_YESTERDAY, respondedAt: CAL_YESTERDAY }),
      quote("accepted", { validUntil: CAL_YESTERDAY }),
    ],
  });
  assert.deepEqual(only(signals, "QUOTE_PAST_VALIDITY")[0].evidence, {
    expiredQuoteCount: 2,
    expiredQuotes: [expiredQ(new Date("2026-09-01T00:00:00.000Z"), 36, "q-2"), expiredQ(CAL_YESTERDAY, 1, "q-1")],
  });
  assert.deepEqual(only(signals, "QUOTE_PENDING")[0].evidence, { pendingQuoteCount: 3 }, "today + tomorrow + no validity");
});

test("4E.5 calendar comparison is deterministic and independent of the machine timezone (UTC getters only)", () => {
  const input = base({ now: CAL_NOW, deals: [deal("new", CAL_YESTERDAY), deal("new", CAL_TODAY)], quotes: [quote("sent", { validUntil: CAL_TODAY })] });
  assert.deepEqual(assessSignals(input), assessSignals(input));
  const source = readFileSync(fileURLToPath(new URL("./signals.ts", import.meta.url)), "utf8");
  assert.match(source, /Date\.UTC\(now\.getUTCFullYear\(\), now\.getUTCMonth\(\), now\.getUTCDate\(\)\)/);
  assert.ok(!/now\.get(FullYear|Month|Date|Hours)\(\)/.test(source), "no local-timezone getter on now");
});

// =========================================================
// MICRO-STEP 4F.6.2 — DEAL_PAST_EXPECTED_CLOSE evidence lists the overdue
// deals themselves: { dealId, stage, expectedCloseDate, overdueDays }, sorted
// by expectedCloseDate then dealId. The detection rule is unchanged.
// =========================================================

function pastClose(signals) {
  return only(signals, "DEAL_PAST_EXPECTED_CLOSE")[0];
}
const CAL_DAYS_AGO = (n) => new Date(CAL_TODAY.getTime() - n * 24 * 60 * 60 * 1000);

test("4F.6.2 one overdue deal -> overdueDeals has exactly that deal", () => {
  const signal = pastClose(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-1")] }));
  assert.deepEqual(signal.evidence, { overdueDealCount: 1, overdueDeals: [overdue("new", CAL_DAYS_AGO(10), 10, "d-1")] });
});

test("4F.6.2 two overdue deals -> both listed, overdueDealCount = overdueDeals.length", () => {
  const signal = pastClose(cal({ deals: [deal("new", CAL_DAYS_AGO(5), "d-a"), deal("proposal", CAL_DAYS_AGO(40), "d-b")] }));
  assert.equal(signal.evidence.overdueDeals.length, 2);
  assert.equal(signal.evidence.overdueDealCount, signal.evidence.overdueDeals.length);
  assert.deepEqual(signal.evidence.overdueDeals.map((d) => d.dealId).sort(), ["d-a", "d-b"]);
});

test("4F.6.2 one overdue + one future deal -> only the overdue deal is listed", () => {
  const signals = cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-past"), deal("qualified", CAL_TOMORROW, "d-future")] });
  assert.deepEqual(pastClose(signals).evidence.overdueDeals, [overdue("new", CAL_DAYS_AGO(10), 10, "d-past")]);
  assert.deepEqual(only(signals, "DEAL_ACTIVE")[0].evidence, { openDealCount: 1 });
});

test("4F.6.2 proposal stage is kept verbatim", () => {
  assert.equal(pastClose(cal({ deals: [deal("proposal", CAL_YESTERDAY)] })).evidence.overdueDeals[0].stage, "proposal");
});

test("4F.6.2 qualified stage is kept verbatim", () => {
  assert.equal(pastClose(cal({ deals: [deal("qualified", CAL_YESTERDAY)] })).evidence.overdueDeals[0].stage, "qualified");
});

test("4F.6.2 expectedCloseDate = today is not overdue and never listed", () => {
  const signals = cal({ deals: [deal("new", CAL_TODAY, "d-today"), deal("new", CAL_YESTERDAY, "d-yday")] });
  assert.deepEqual(pastClose(signals).evidence.overdueDeals.map((d) => d.dealId), ["d-yday"]);
  assert.ok(!has(cal({ deals: [deal("new", CAL_TODAY)] }), "DEAL_PAST_EXPECTED_CLOSE"));
});

test("4F.6.2 expectedCloseDate = yesterday -> overdueDays = 1, at any time of today", () => {
  for (const now of [new Date("2026-10-07T00:00:00.000Z"), CAL_NOW, new Date("2026-10-07T23:59:59.999Z")]) {
    const signal = pastClose(assessSignals(base({ now, deals: [deal("new", CAL_YESTERDAY)] })));
    assert.equal(signal.evidence.overdueDeals[0].overdueDays, 1, now.toISOString());
  }
});

test("4F.6.2 old date -> exact overdueDays in whole calendar days", () => {
  const signal = pastClose(cal({ deals: [deal("qualified", new Date("2026-07-09T00:00:00.000Z"))] }));
  assert.equal(signal.evidence.overdueDeals[0].overdueDays, 90);
  assert.ok(Number.isInteger(signal.evidence.overdueDeals[0].overdueDays));
});

test("4F.6.2 won / lost deals are never listed, even past their date", () => {
  const signal = pastClose(cal({ deals: [deal("won", CAL_DAYS_AGO(3), "d-won"), deal("lost", CAL_DAYS_AGO(3), "d-lost"), deal("new", CAL_DAYS_AGO(3), "d-open")] }));
  assert.deepEqual(signal.evidence.overdueDeals.map((d) => d.dealId), ["d-open"]);
  assert.equal(signal.evidence.overdueDealCount, 1);
});

test("4F.6.2 sorted by expectedCloseDate ascending, regardless of input order", () => {
  const deals = [deal("new", CAL_DAYS_AGO(5), "d-5"), deal("proposal", CAL_DAYS_AGO(40), "d-40"), deal("qualified", CAL_DAYS_AGO(10), "d-10")];
  for (const order of [deals, [...deals].reverse()]) {
    assert.deepEqual(pastClose(cal({ deals: order })).evidence.overdueDeals.map((d) => d.dealId), ["d-40", "d-10", "d-5"]);
  }
});

test("4F.6.2 equal expectedCloseDate -> tie broken by dealId ascending", () => {
  const same = CAL_DAYS_AGO(10);
  const deals = [deal("new", same, "d-c"), deal("qualified", same, "d-a"), deal("proposal", same, "d-b")];
  for (const order of [deals, [...deals].reverse()]) {
    assert.deepEqual(pastClose(cal({ deals: order })).evidence.overdueDeals.map((d) => d.dealId), ["d-a", "d-b", "d-c"]);
  }
});

test("4F.6.2/4F.8.7 entries carry exactly dealId, stage, expectedCloseDate, overdueDays, lastDealInteractionAt, dealContactState (no title, no value)", () => {
  const input = { ...deal("new", CAL_YESTERDAY, "d-1"), title: "should not leak", valueEuros: 1000 };
  const [entry] = pastClose(cal({ deals: [input] })).evidence.overdueDeals;
  assert.deepEqual(Object.keys(entry).sort(), ["dealContactState", "dealId", "expectedCloseDate", "lastDealInteractionAt", "overdueDays", "stage"]);
});

test("4F.6.2 inputs are never mutated (deals array order and objects untouched)", () => {
  const deals = [deal("new", CAL_DAYS_AGO(5), "d-5"), deal("proposal", CAL_DAYS_AGO(40), "d-40")];
  const snapshot = structuredClone(deals);
  const signal = pastClose(cal({ deals }));
  assert.deepEqual(deals, snapshot);
  signal.evidence.overdueDeals[0].stage = "mutated";
  assert.deepEqual(deals, snapshot, "evidence entries are new objects, not the input deals");
});

test("4F.6.2 detection rule unchanged: same fire / no-fire outcomes, same color/severity/reason", () => {
  assert.ok(!has(cal({ deals: [deal("new", null)] }), "DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(!has(cal({ deals: [deal("new", CAL_TOMORROW)] }), "DEAL_PAST_EXPECTED_CLOSE"));
  const signal = pastClose(cal({ deals: [deal("new", CAL_YESTERDAY)] }));
  assert.equal(signal.color, "orange");
  assert.equal(signal.severity, "important");
  assert.equal(signal.reason, "DEAL_EXPECTED_CLOSE_PASSED");
});

test("4F.6.2 interaction signals are unaffected by overdueDeals (lastInteractionAt evidence unchanged)", () => {
  const last = new Date("2026-08-01T10:00:00.000Z");
  const signals = cal({ lastInteractionAt: last, deals: [deal("new", CAL_YESTERDAY)] });
  assert.deepEqual(only(signals, "NO_RECENT_INTERACTION")[0].evidence, only(cal({ lastInteractionAt: last }), "NO_RECENT_INTERACTION")[0].evidence);
});

test("4F.6.2 deterministic: identical input -> identical overdueDeals", () => {
  const input = base({ now: CAL_NOW, deals: [deal("new", CAL_DAYS_AGO(5), "d-b"), deal("new", CAL_DAYS_AGO(5), "d-a")] });
  assert.deepEqual(assessSignals(input), assessSignals(input));
});

// =========================================================
// MICRO-STEP 4F.6.4 — QUOTE_PAST_VALIDITY evidence lists the expired quotes
// themselves: { quoteId, validUntil, dealId, daysPastValidity }, sorted by
// validUntil then quoteId. The detection rule is unchanged.
// =========================================================

function pastValidityOf(signals) {
  return only(signals, "QUOTE_PAST_VALIDITY")[0];
}

test("4F.6.4 #1 one expired quote -> expiredQuotes has exactly that quote", () => {
  const signal = pastValidityOf(cal({ quotes: [quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-1" })] }));
  assert.deepEqual(signal.evidence, { expiredQuoteCount: 1, expiredQuotes: [expiredQ(CAL_DAYS_AGO(5), 5, "q-1")] });
});

test("4F.6.4 #2 two expired quotes -> both listed, expiredQuoteCount = expiredQuotes.length", () => {
  const signal = pastValidityOf(cal({ quotes: [quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-a" }), quote("sent", { validUntil: CAL_DAYS_AGO(10), id: "q-b" })] }));
  assert.equal(signal.evidence.expiredQuotes.length, 2);
  assert.equal(signal.evidence.expiredQuoteCount, signal.evidence.expiredQuotes.length);
  assert.notEqual(signal.evidence.expiredQuotes[0].quoteId, signal.evidence.expiredQuotes[1].quoteId);
});

test("4F.6.4 #3 pending + expired -> only the expired quote is listed; QUOTE_PENDING evidence unchanged", () => {
  const signals = cal({
    quotes: [
      quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-exp" }),
      quote("sent", { validUntil: CAL_TOMORROW, id: "q-fut" }),
      quote("sent", { id: "q-none" }),
    ],
  });
  assert.deepEqual(pastValidityOf(signals).evidence.expiredQuotes.map((q) => q.quoteId), ["q-exp"]);
  assert.deepEqual(only(signals, "QUOTE_PENDING")[0].evidence, { pendingQuoteCount: 2 });
});

test("4F.6.4 #4 validUntil = today is not expired and never listed", () => {
  const signals = cal({ quotes: [quote("sent", { validUntil: CAL_TODAY, id: "q-today" }), quote("sent", { validUntil: CAL_YESTERDAY, id: "q-yday" })] });
  assert.deepEqual(pastValidityOf(signals).evidence.expiredQuotes.map((q) => q.quoteId), ["q-yday"]);
  assert.ok(!has(cal({ quotes: [quote("sent", { validUntil: CAL_TODAY })] }), "QUOTE_PAST_VALIDITY"));
});

test("4F.6.4 #5 validUntil = yesterday -> daysPastValidity = 1, at any time of today", () => {
  for (const now of [new Date("2026-10-07T00:00:00.000Z"), CAL_NOW, new Date("2026-10-07T23:59:59.999Z")]) {
    const signal = pastValidityOf(assessSignals(base({ now, quotes: [quote("sent", { validUntil: CAL_YESTERDAY })] })));
    assert.equal(signal.evidence.expiredQuotes[0].daysPastValidity, 1, now.toISOString());
  }
});

test("4F.6.4 #6 old date -> exact daysPastValidity in whole calendar days", () => {
  const [entry] = pastValidityOf(cal({ quotes: [quote("sent", { validUntil: new Date("2026-07-09T00:00:00.000Z") })] })).evidence.expiredQuotes;
  assert.equal(entry.daysPastValidity, 90);
  assert.ok(Number.isInteger(entry.daysPastValidity));
});

test("4F.6.4 #7 validUntil null / absent -> never listed (stays QUOTE_PENDING)", () => {
  for (const q of [quote("sent", { validUntil: null }), { id: "q-x", dealId: null, status: "sent", respondedAt: null }]) {
    const signals = cal({ quotes: [q] });
    assert.ok(!has(signals, "QUOTE_PAST_VALIDITY"));
    assert.ok(has(signals, "QUOTE_PENDING"));
  }
});

test("4F.6.4 #8-#11 responded / declined / accepted / stored 'expired' status -> never listed", () => {
  const signals = cal({
    quotes: [
      quote("sent", { validUntil: CAL_DAYS_AGO(3), respondedAt: CAL_DAYS_AGO(2), id: "q-responded" }),
      quote("declined", { validUntil: CAL_DAYS_AGO(3), respondedAt: CAL_DAYS_AGO(2), id: "q-declined" }),
      quote("accepted", { validUntil: CAL_DAYS_AGO(3), respondedAt: CAL_DAYS_AGO(2), id: "q-accepted" }),
      quote("expired", { validUntil: CAL_DAYS_AGO(3), id: "q-status-expired" }),
      quote("sent", { validUntil: CAL_DAYS_AGO(3), id: "q-real" }),
    ],
  });
  assert.deepEqual(pastValidityOf(signals).evidence.expiredQuotes.map((q) => q.quoteId), ["q-real"]);
  for (const status of ["declined", "accepted", "expired"]) {
    assert.ok(!has(cal({ quotes: [quote(status, { validUntil: CAL_DAYS_AGO(3) })] }), "QUOTE_PAST_VALIDITY"), status);
  }
  assert.ok(!has(cal({ quotes: [quote("sent", { validUntil: CAL_DAYS_AGO(3), respondedAt: CAL_DAYS_AGO(2) })] }), "QUOTE_PAST_VALIDITY"));
});

test("4F.6.4 #12 dealId present -> kept verbatim", () => {
  const [entry] = pastValidityOf(cal({ quotes: [quote("sent", { validUntil: CAL_YESTERDAY, dealId: "deal-123" })] })).evidence.expiredQuotes;
  assert.equal(entry.dealId, "deal-123");
});

test("4F.6.4 #13 dealId null -> stays exactly null (never undefined, never a label)", () => {
  const [entry] = pastValidityOf(cal({ quotes: [quote("sent", { validUntil: CAL_YESTERDAY, dealId: null })] })).evidence.expiredQuotes;
  assert.ok("dealId" in entry);
  assert.strictEqual(entry.dealId, null);
});

test("4F.6.4 #14 several expired quotes on the same deal -> one entry per quote, same dealId", () => {
  const signal = pastValidityOf(cal({
    quotes: [quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-1", dealId: "deal-A" }), quote("sent", { validUntil: CAL_DAYS_AGO(10), id: "q-2", dealId: "deal-A" })],
  }));
  assert.deepEqual(signal.evidence.expiredQuotes.map((q) => [q.quoteId, q.dealId]), [["q-2", "deal-A"], ["q-1", "deal-A"]]);
  assert.equal(signal.evidence.expiredQuoteCount, 2);
});

test("4F.6.4 #15 expired quotes on several deals (and none) -> each keeps its own dealId", () => {
  const signal = pastValidityOf(cal({
    quotes: [
      quote("sent", { validUntil: CAL_DAYS_AGO(3), id: "q-a", dealId: "deal-A" }),
      quote("sent", { validUntil: CAL_DAYS_AGO(4), id: "q-b", dealId: "deal-B" }),
      quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-c", dealId: null }),
    ],
  }));
  assert.deepEqual(signal.evidence.expiredQuotes.map((q) => [q.quoteId, q.dealId]), [["q-c", null], ["q-b", "deal-B"], ["q-a", "deal-A"]]);
});

test("4F.6.4 #16 sorted by validUntil ascending, regardless of input order", () => {
  const quotes = [quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-5" }), quote("sent", { validUntil: CAL_DAYS_AGO(40), id: "q-40" }), quote("sent", { validUntil: CAL_DAYS_AGO(10), id: "q-10" })];
  for (const order of [quotes, [...quotes].reverse()]) {
    assert.deepEqual(pastValidityOf(cal({ quotes: order })).evidence.expiredQuotes.map((q) => q.quoteId), ["q-40", "q-10", "q-5"]);
  }
});

test("4F.6.4 #17 equal validUntil -> tie broken by quoteId ascending", () => {
  const same = CAL_DAYS_AGO(10);
  const quotes = [quote("sent", { validUntil: same, id: "q-c" }), quote("sent", { validUntil: same, id: "q-a" }), quote("sent", { validUntil: same, id: "q-b" })];
  for (const order of [quotes, [...quotes].reverse()]) {
    assert.deepEqual(pastValidityOf(cal({ quotes: order })).evidence.expiredQuotes.map((q) => q.quoteId), ["q-a", "q-b", "q-c"]);
  }
});

test("4F.6.4 #18 exact keys: evidence = { expiredQuoteCount, expiredQuotes }; entries = quoteId/validUntil/dealId/daysPastValidity only", () => {
  const input = { ...quote("sent", { validUntil: CAL_YESTERDAY, id: "q-1" }), totalCents: 99900, title: "leak?", quoteNumber: "Q-1", notes: "n", createdAt: CAL_YESTERDAY, sentAt: CAL_YESTERDAY };
  const signal = pastValidityOf(cal({ quotes: [input] }));
  assert.deepEqual(Object.keys(signal.evidence).sort(), ["expiredQuoteCount", "expiredQuotes"]);
  assert.deepEqual(Object.keys(signal.evidence.expiredQuotes[0]).sort(), ["daysPastValidity", "dealId", "quoteId", "validUntil"]);
});

test("4F.6.4 #19 inputs are never mutated (quotes array order and objects untouched)", () => {
  const quotes = [quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-5" }), quote("sent", { validUntil: CAL_DAYS_AGO(40), id: "q-40", dealId: "deal-A" })];
  const snapshot = structuredClone(quotes);
  const signal = pastValidityOf(cal({ quotes }));
  assert.deepEqual(quotes, snapshot);
  signal.evidence.expiredQuotes[0].quoteId = "mutated";
  assert.deepEqual(quotes, snapshot, "evidence entries are new objects, not the input quotes");
});

test("4F.6.4 #20 detection rule unchanged: same fire / no-fire outcomes, same color/severity/reason, same QUOTE_PENDING", () => {
  assert.ok(!has(cal({ quotes: [quote("sent", { validUntil: CAL_TOMORROW })] }), "QUOTE_PAST_VALIDITY"));
  assert.ok(!has(cal({ quotes: [quote("draft", { validUntil: CAL_YESTERDAY })] }), "QUOTE_PAST_VALIDITY"));
  const signal = pastValidityOf(cal({ quotes: [quote("sent", { validUntil: CAL_YESTERDAY })] }));
  assert.equal(signal.color, "orange");
  assert.equal(signal.severity, "important");
  assert.equal(signal.reason, "QUOTE_VALIDITY_PASSED");
  const input = base({ now: CAL_NOW, quotes: [quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-b" }), quote("sent", { validUntil: CAL_DAYS_AGO(5), id: "q-a" })] });
  assert.deepEqual(assessSignals(input), assessSignals(input));
});

// =========================================================
// MICRO-STEP 4F.6.6 — NO_WEBSITE evidence carries the Discovery provenance
// already loaded (category, businessStatus, discoveredAt). Provenance only:
// the trigger stays discoverySource !== null && website === null.
// =========================================================

const DISCOVERED_AT = new Date("2026-09-07T12:00:00.000Z");
function discovery(overrides = {}) {
  return { category: "dentist", website: null, businessStatus: "OPERATIONAL", ...overrides };
}
function noWebsiteOf(signals) {
  return only(signals, "NO_WEBSITE")[0];
}

test("4F.6.6 #1 NO_WEBSITE evidence = exactly { website, discoveryCategory, discoveryBusinessStatus, discoveredAt }", () => {
  const signal = noWebsiteOf(cal({ discoverySource: discovery(), discoveredAt: DISCOVERED_AT }));
  assert.deepEqual(signal.evidence, { website: null, discoveryCategory: "dentist", discoveryBusinessStatus: "OPERATIONAL", discoveredAt: DISCOVERED_AT });
});

test("4F.6.6 #2 category null is kept as null", () => {
  const signal = noWebsiteOf(cal({ discoverySource: discovery({ category: null }), discoveredAt: DISCOVERED_AT }));
  assert.ok("discoveryCategory" in signal.evidence);
  assert.strictEqual(signal.evidence.discoveryCategory, null);
});

test("4F.6.6 #3 businessStatus null is kept as null (and CLOSED_TEMPORARILY verbatim)", () => {
  const nullStatus = noWebsiteOf(cal({ discoverySource: discovery({ businessStatus: null }), discoveredAt: DISCOVERED_AT }));
  assert.ok("discoveryBusinessStatus" in nullStatus.evidence);
  assert.strictEqual(nullStatus.evidence.discoveryBusinessStatus, null);
  const temp = noWebsiteOf(cal({ discoverySource: discovery({ businessStatus: "CLOSED_TEMPORARILY" }), discoveredAt: DISCOVERED_AT }));
  assert.equal(temp.evidence.discoveryBusinessStatus, "CLOSED_TEMPORARILY");
});

test("4F.6.6 #4 discoveredAt is kept exactly (same instant), whatever its age", () => {
  for (const at of [DISCOVERED_AT, new Date("2020-01-01T08:15:00.000Z"), CAL_NOW]) {
    const signal = noWebsiteOf(cal({ discoverySource: discovery(), discoveredAt: at }));
    assert.equal(signal.evidence.discoveredAt.getTime(), at.getTime());
  }
});

test("4F.6.6 #5 website stays strictly null", () => {
  const signal = noWebsiteOf(cal({ discoverySource: discovery(), discoveredAt: DISCOVERED_AT }));
  assert.ok("website" in signal.evidence);
  assert.strictEqual(signal.evidence.website, null);
});

test("4F.6.6 #6 no extra key, even if the input carries more", () => {
  const signal = noWebsiteOf(cal({ discoverySource: { ...discovery(), url: "https://crm.example.test", label: "x", siteId: "s-1" }, discoveredAt: DISCOVERED_AT }));
  assert.deepEqual(Object.keys(signal.evidence).sort(), ["discoveredAt", "discoveryBusinessStatus", "discoveryCategory", "website"]);
});

test("4F.6.6 #7 inputs are never mutated", () => {
  const input = base({ now: CAL_NOW, discoverySource: discovery(), discoveredAt: DISCOVERED_AT });
  const snapshot = structuredClone(input);
  const signal = noWebsiteOf(assessSignals(input));
  assert.deepEqual(input, snapshot);
  signal.evidence.discoveryCategory = "mutated";
  assert.deepEqual(input, snapshot);
});

test("4F.6.6 #8 Discovery website present -> no NO_WEBSITE; no Discovery link -> no NO_WEBSITE (trigger unchanged)", () => {
  assert.ok(!has(cal({ discoverySource: discovery({ website: "https://example.test" }), discoveredAt: DISCOVERED_AT }), "NO_WEBSITE"));
  assert.ok(!has(cal({ discoverySource: null, discoveredAt: null }), "NO_WEBSITE"));
  for (const businessStatus of [null, "OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]) {
    for (const category of [null, "x"]) {
      assert.ok(has(cal({ discoverySource: discovery({ businessStatus, category }), discoveredAt: DISCOVERED_AT }), "NO_WEBSITE"), `${businessStatus}/${category}`);
    }
  }
});

test("4F.6.6 #9 BUSINESS_CLOSED co-occurs: NO_WEBSITE still emitted with the enriched evidence, BUSINESS_CLOSED unchanged", () => {
  const signals = cal({ discoverySource: discovery({ businessStatus: "CLOSED_PERMANENTLY" }), discoveredAt: DISCOVERED_AT });
  assert.equal(noWebsiteOf(signals).evidence.discoveryBusinessStatus, "CLOSED_PERMANENTLY");
  assert.deepEqual(only(signals, "BUSINESS_CLOSED")[0].evidence, { businessStatus: "CLOSED_PERMANENTLY" });
});

test("4F.6.6 #11 DISCOVERY_NEW unchanged: same trigger, evidence still exactly { discoveredAt }", () => {
  const recent = new Date(CAL_NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
  const signals = cal({ source: "RADAR Discovery", discoverySource: discovery(), discoveredAt: recent });
  assert.deepEqual(only(signals, "DISCOVERY_NEW")[0].evidence, { discoveredAt: recent });
  assert.equal(noWebsiteOf(signals).evidence.discoveredAt, recent);
  assert.ok(!has(cal({ source: "manual", discoverySource: discovery(), discoveredAt: recent }), "DISCOVERY_NEW"));
  assert.ok(!has(cal({ source: "RADAR Discovery", discoverySource: discovery(), discoveredAt: DISCOVERED_AT }), "DISCOVERY_NEW"), "30 days old -> not new");
});

// =========================================================
// MICRO-STEP 4F.7.1 — model C: NO_WEBSITE also requires no crm_websites row
// (hasCrmWebsite, presence only). Nothing else changes.
// =========================================================

test("4F.7.1 #1 hasCrmWebsite=false + Discovery website null -> NO_WEBSITE (enriched evidence unchanged)", () => {
  const signal = noWebsiteOf(cal({ discoverySource: discovery(), discoveredAt: DISCOVERED_AT, hasCrmWebsite: false }));
  assert.deepEqual(signal.evidence, { website: null, discoveryCategory: "dentist", discoveryBusinessStatus: "OPERATIONAL", discoveredAt: DISCOVERED_AT });
});

test("4F.7.1 #2 hasCrmWebsite=true + Discovery website null -> no NO_WEBSITE", () => {
  assert.ok(!has(cal({ discoverySource: discovery(), discoveredAt: DISCOVERED_AT, hasCrmWebsite: true }), "NO_WEBSITE"));
});

test("4F.7.1 #3/#4 Discovery website present -> no NO_WEBSITE, whatever hasCrmWebsite", () => {
  for (const hasCrmWebsite of [true, false]) {
    assert.ok(!has(cal({ discoverySource: discovery({ website: "https://example.test" }), discoveredAt: DISCOVERED_AT, hasCrmWebsite }), "NO_WEBSITE"), String(hasCrmWebsite));
  }
});

test("4F.7.1 #5 no Discovery link -> no NO_WEBSITE, whatever hasCrmWebsite", () => {
  for (const hasCrmWebsite of [true, false]) {
    assert.ok(!has(cal({ discoverySource: null, discoveredAt: null, hasCrmWebsite }), "NO_WEBSITE"), String(hasCrmWebsite));
  }
});

test("4F.7.1 #6 BUSINESS_CLOSED unchanged by hasCrmWebsite; only NO_WEBSITE depends on it", () => {
  for (const hasCrmWebsite of [true, false]) {
    const signals = cal({ discoverySource: discovery({ businessStatus: "CLOSED_PERMANENTLY" }), discoveredAt: DISCOVERED_AT, hasCrmWebsite });
    assert.deepEqual(only(signals, "BUSINESS_CLOSED")[0].evidence, { businessStatus: "CLOSED_PERMANENTLY" });
    assert.equal(has(signals, "NO_WEBSITE"), !hasCrmWebsite);
  }
});

test("4F.7.1 every other signal is identical with hasCrmWebsite true vs false", () => {
  const input = {
    now: CAL_NOW,
    source: "RADAR Discovery",
    discoverySource: discovery({ businessStatus: "CLOSED_PERMANENTLY" }),
    discoveredAt: new Date(CAL_NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
    lastInteractionAt: new Date("2026-08-01T00:00:00Z"),
    assignedUserId: null,
    nextFollowUpDueAt: null,
    deals: [deal("new", CAL_YESTERDAY, "d-1"), deal("qualified", CAL_TOMORROW, "d-2")],
    quotes: [quote("sent", { validUntil: CAL_YESTERDAY, id: "q-1" }), quote("sent", { validUntil: CAL_TOMORROW, id: "q-2" })],
  };
  const without = assessSignals(base({ ...input, hasCrmWebsite: false })).filter((s) => s.type !== "NO_WEBSITE");
  const withSite = assessSignals(base({ ...input, hasCrmWebsite: true }));
  assert.deepEqual(withSite, without);
});

test("4F.7.1 #8 NO_WEBSITE evidence never exposes a CRM url/id/label/count (keys unchanged)", () => {
  const signal = noWebsiteOf(cal({ discoverySource: discovery(), discoveredAt: DISCOVERED_AT, hasCrmWebsite: false }));
  assert.deepEqual(Object.keys(signal.evidence).sort(), ["discoveredAt", "discoveryBusinessStatus", "discoveryCategory", "website"]);
  assert.ok(!("hasCrmWebsite" in signal.evidence));
});

test("4F.7.1 #9/#10 no mutation and deterministic", () => {
  for (const hasCrmWebsite of [true, false]) {
    const input = base({ now: CAL_NOW, discoverySource: discovery(), discoveredAt: DISCOVERED_AT, hasCrmWebsite });
    const snapshot = structuredClone(input);
    assert.deepEqual(assessSignals(input), assessSignals(input));
    assert.deepEqual(input, snapshot);
  }
});

// =========================================================
// MICRO-STEP 4F.8.7 — per-deal contact state of each overdue deal:
// lastDealInteractionAt = max(interactions linked to THIS deal, general ones
// with dealId NULL); interactions linked to ANOTHER deal never count.
// NONE_RECORDED | RECENT (<= 30 days) | STALE. Prospect-level RECENT_ACTIVITY /
// NO_RECENT_INTERACTION are unchanged.
// =========================================================

const DAYS_AGO = (n) => new Date(CAL_NOW.getTime() - n * 24 * 60 * 60 * 1000);
function pastDeals(signals) {
  return only(signals, "DEAL_PAST_EXPECTED_CLOSE")[0].evidence.overdueDeals;
}

test("4F.8.7 #1 overdue deal + recent interaction LINKED to it -> RECENT", () => {
  const at = DAYS_AGO(2);
  const [entry] = pastDeals(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [{ dealId: "d-a", occurredAt: at }] }));
  assert.equal(entry.dealContactState, "RECENT");
  assert.equal(entry.lastDealInteractionAt.getTime(), at.getTime());
});

test("4F.8.7 #2 overdue deal + old interaction LINKED to it -> STALE", () => {
  const at = DAYS_AGO(45);
  const [entry] = pastDeals(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [{ dealId: "d-a", occurredAt: at }] }));
  assert.equal(entry.dealContactState, "STALE");
  assert.equal(entry.lastDealInteractionAt.getTime(), at.getTime());
});

test("4F.8.7 #3 overdue deal + recent GENERAL interaction (dealId null) -> RECENT (max variant)", () => {
  const at = DAYS_AGO(2);
  const [entry] = pastDeals(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [{ dealId: null, occurredAt: at }] }));
  assert.equal(entry.dealContactState, "RECENT");
  assert.equal(entry.lastDealInteractionAt.getTime(), at.getTime());
});

test("4F.8.7 #3b max of linked and general: a newer general beats an older linked, and vice versa", () => {
  const older = DAYS_AGO(45);
  const newer = DAYS_AGO(3);
  const a = pastDeals(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [{ dealId: "d-a", occurredAt: older }, { dealId: null, occurredAt: newer }] }))[0];
  const b = pastDeals(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [{ dealId: null, occurredAt: older }, { dealId: "d-a", occurredAt: newer }] }))[0];
  for (const entry of [a, b]) {
    assert.equal(entry.lastDealInteractionAt.getTime(), newer.getTime());
    assert.equal(entry.dealContactState, "RECENT");
  }
});

test("4F.8.7 #4 overdue deal + no interaction at all -> NONE_RECORDED", () => {
  const [entry] = pastDeals(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [] }));
  assert.strictEqual(entry.lastDealInteractionAt, null);
  assert.equal(entry.dealContactState, "NONE_RECORDED");
});

test("4F.8.7 #5 CRITICAL — deal A overdue, deal B active, recent interaction linked to B -> A NONE_RECORDED (not masked); prospect still RECENT_ACTIVITY", () => {
  const recent = DAYS_AGO(2);
  const signals = cal({
    deals: [deal("new", CAL_DAYS_AGO(10), "d-a"), deal("qualified", CAL_TOMORROW, "d-b")],
    interactions: [{ dealId: "d-b", occurredAt: recent }],
    lastInteractionAt: recent,
  });
  const entries = pastDeals(signals);
  assert.deepEqual(entries.map((e) => [e.dealId, e.dealContactState, e.lastDealInteractionAt]), [["d-a", "NONE_RECORDED", null]]);
  assert.ok(has(signals, "RECENT_ACTIVITY"), "prospect-level RECENT_ACTIVITY unchanged");
  assert.deepEqual(only(signals, "DEAL_ACTIVE")[0].evidence, { openDealCount: 1 }, "deal B stays an active (not overdue) deal");
});

test("4F.8.7 #5b an interaction linked to ANOTHER overdue deal never counts (each deal only sees its own + general)", () => {
  const signals = cal({
    deals: [deal("new", CAL_DAYS_AGO(10), "d-a"), deal("proposal", CAL_DAYS_AGO(20), "d-b")],
    interactions: [{ dealId: "d-b", occurredAt: DAYS_AGO(2) }, { dealId: "d-a", occurredAt: DAYS_AGO(50) }],
  });
  assert.deepEqual(pastDeals(signals).map((e) => [e.dealId, e.dealContactState]), [["d-b", "RECENT"], ["d-a", "STALE"]]);
});

test("4F.8.7 #6 several overdue deals without interaction -> all NONE_RECORDED, order expectedCloseDate ASC then dealId ASC", () => {
  const same = CAL_DAYS_AGO(10);
  const deals = [deal("new", CAL_DAYS_AGO(5), "d-5"), deal("new", same, "d-c"), deal("proposal", CAL_DAYS_AGO(40), "d-40"), deal("qualified", same, "d-a")];
  for (const order of [deals, [...deals].reverse()]) {
    const entries = pastDeals(cal({ deals: order, interactions: [] }));
    assert.deepEqual(entries.map((e) => e.dealId), ["d-40", "d-a", "d-c", "d-5"]);
    assert.ok(entries.every((e) => e.dealContactState === "NONE_RECORDED" && e.lastDealInteractionAt === null));
  }
});

test("4F.8.7 #7 two interactions with the same occurredAt -> deterministic result whatever the input order", () => {
  const at = DAYS_AGO(3);
  const rows = [{ dealId: "d-a", occurredAt: new Date(at) }, { dealId: null, occurredAt: new Date(at) }, { dealId: "d-a", occurredAt: new Date(at) }];
  const results = [rows, [...rows].reverse(), [rows[1], rows[0], rows[2]]].map((interactions) => pastDeals(cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions })));
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal(results[0][0].lastDealInteractionAt.getTime(), at.getTime());
});

test("4F.8.7 #8 an interaction whose dealId is not a deal of this prospect is never associated with any of its deals", () => {
  const signals = cal({ deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [{ dealId: "deal-of-another-client", occurredAt: DAYS_AGO(1) }] });
  const [entry] = pastDeals(signals);
  assert.equal(entry.dealContactState, "NONE_RECORDED");
  assert.strictEqual(entry.lastDealInteractionAt, null);
});

test("4F.8.7 #9 no mutation of inputs (deals, interactions)", () => {
  const input = base({ now: CAL_NOW, deals: [deal("new", CAL_DAYS_AGO(10), "d-a")], interactions: [{ dealId: "d-a", occurredAt: DAYS_AGO(2) }, { dealId: null, occurredAt: DAYS_AGO(40) }] });
  const snapshot = structuredClone(input);
  assessSignals(input);
  assert.deepEqual(input, snapshot);
});

test("4F.8.7 other signals unchanged: identical output except overdueDeals' contact fields whatever the interactions", () => {
  const common = { lastInteractionAt: DAYS_AGO(2), deals: [deal("new", CAL_DAYS_AGO(10), "d-a"), deal("qualified", CAL_TOMORROW, "d-b")], quotes: [quote("sent", { validUntil: CAL_DAYS_AGO(3), id: "q-1" })] };
  const strip = (signals) => signals.map((s) => (s.type === "DEAL_PAST_EXPECTED_CLOSE" ? { ...s, evidence: { ...s.evidence, overdueDeals: s.evidence.overdueDeals.map((entry) => {
    const copy = { ...entry };
    delete copy.lastDealInteractionAt;
    delete copy.dealContactState;
    return copy;
  }) } } : s));
  const a = cal({ ...common, interactions: [] });
  const b = cal({ ...common, interactions: [{ dealId: "d-b", occurredAt: DAYS_AGO(2) }, { dealId: null, occurredAt: DAYS_AGO(60) }] });
  assert.deepEqual(strip(b), strip(a));
});
