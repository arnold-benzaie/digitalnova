// RADAR INTELLIGENCE V2.1 — Phase G4C-1 — pure quota status computation
// tests. computeRadarAiQuotaStatus takes an already-resolved policy read
// (RadarAiQuotaPolicyReadResult) and an already-resolved counter read
// (RadarAiQuotaCounterReadResult) and returns one of five statuses. No
// DB, no mocks needed — this is a pure function.
//
// Run: npx tsx --test lib/radar-intelligence/quota-status.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRadarAiQuotaStatus } from "./quota-status.ts";

const WINDOW_START = new Date("2026-09-13T00:00:00.000Z");

function policyOk(overrides = {}) {
  return {
    status: "ok",
    policy: {
      enabled: true,
      dailyRequestLimit: null,
      dailyTokenLimit: null,
      warningThresholdPercent: 80,
      ...overrides,
    },
  };
}

const POLICY_ERROR = { status: "error", policy: null };
const COUNTER_ERROR = { status: "error" };

function counterOk(requestCount = 0, tokenCount = 0) {
  return { status: "ok", counter: { key: "global:2026-09-13", requestCount, tokenCount, windowStart: WINDOW_START } };
}
const COUNTER_NONE = { status: "ok", counter: null };

// ---------------- UNAVAILABLE ----------------

test("policy unavailable -> UNAVAILABLE, regardless of counter", () => {
  assert.equal(computeRadarAiQuotaStatus(POLICY_ERROR, counterOk(0, 0)), "UNAVAILABLE");
  assert.equal(computeRadarAiQuotaStatus(POLICY_ERROR, COUNTER_ERROR), "UNAVAILABLE");
  assert.equal(computeRadarAiQuotaStatus(POLICY_ERROR, COUNTER_NONE), "UNAVAILABLE");
});

test("counter unavailable, at least one limit configured -> UNAVAILABLE, never silently NORMAL", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100 }), COUNTER_ERROR), "UNAVAILABLE");
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 5000 }), COUNTER_ERROR), "UNAVAILABLE");
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100, dailyTokenLimit: 5000 }), COUNTER_ERROR), "UNAVAILABLE");
});

test("counter unavailable BUT no limit configured at all -> NORMAL (the counter can never matter, so its own failure is a non-issue, not a hidden default)", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: null, dailyTokenLimit: null }), COUNTER_ERROR), "NORMAL");
});

test("counter unavailable BUT policy disabled -> DISABLED (the counter is never even consulted once disabled is known)", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ enabled: false, dailyRequestLimit: 10 }), COUNTER_ERROR), "DISABLED");
});

// ---------------- DISABLED ----------------

test("policy.enabled = false -> DISABLED, regardless of limits or usage", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ enabled: false }), COUNTER_NONE), "DISABLED");
  assert.equal(computeRadarAiQuotaStatus(policyOk({ enabled: false, dailyRequestLimit: 10 }), counterOk(999, 0)), "DISABLED");
});

// ---------------- unlimited policy ----------------

test("both limits null -> NORMAL, never WARNING, regardless of usage", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk(), counterOk(0, 0)), "NORMAL");
  assert.equal(computeRadarAiQuotaStatus(policyOk(), counterOk(1_000_000, 1_000_000)), "NORMAL");
  assert.equal(computeRadarAiQuotaStatus(policyOk(), COUNTER_NONE), "NORMAL");
});

// ---------------- daily request limit: under / at / over ----------------

test("daily request limit: usage under the limit -> NORMAL (below warning threshold)", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100, warningThresholdPercent: 80 }), counterOk(50, 0)), "NORMAL");
});

test("request quota reached: requestCount === limit -> LIMITED", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100 }), counterOk(100, 0)), "LIMITED");
});

test("request quota over: requestCount > limit -> LIMITED", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100 }), counterOk(150, 0)), "LIMITED");
});

// ---------------- daily token limit: under / at / over ----------------

test("daily token limit: usage under the limit -> NORMAL (below warning threshold)", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 10_000, warningThresholdPercent: 80 }), counterOk(0, 1_000)), "NORMAL");
});

test("token quota reached: tokenCount === limit -> LIMITED", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 10_000 }), counterOk(0, 10_000)), "LIMITED");
});

test("token quota over: tokenCount > limit -> LIMITED", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 10_000 }), counterOk(0, 12_000)), "LIMITED");
});

// ---------------- warning threshold: exact / over ----------------

test("warning threshold: exact match (usage% === warningThresholdPercent) -> WARNING (inclusive)", () => {
  // 80/100 = 80% exactly, threshold 80 -> WARNING, not NORMAL, not LIMITED
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100, warningThresholdPercent: 80 }), counterOk(80, 0)), "WARNING");
});

test("warning threshold: over threshold but below the limit -> WARNING", () => {
  // 90/100 = 90% >= 80% threshold, but 90 < 100 so not yet LIMITED
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100, warningThresholdPercent: 80 }), counterOk(90, 0)), "WARNING");
});

test("warning threshold: one tick below the threshold -> NORMAL, not WARNING", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100, warningThresholdPercent: 80 }), counterOk(79, 0)), "NORMAL");
});

test("warning threshold applies independently to the token limit too", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 1000, warningThresholdPercent: 50 }), counterOk(0, 500)), "WARNING");
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 1000, warningThresholdPercent: 50 }), counterOk(0, 499)), "NORMAL");
});

// ---------------- null limits ----------------

test("null dailyRequestLimit alone never produces WARNING/LIMITED from request usage, however high", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: null, dailyTokenLimit: 1000 }), counterOk(999_999, 0)), "NORMAL");
});

test("null dailyTokenLimit alone never produces WARNING/LIMITED from token usage, however high", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 1000, dailyTokenLimit: null }), counterOk(0, 999_999)), "NORMAL");
});

// ---------------- limit = 0 ----------------

test("dailyRequestLimit = 0 -> LIMITED immediately, even with a null/zero counter", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 0 }), COUNTER_NONE), "LIMITED");
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 0 }), counterOk(0, 0)), "LIMITED");
});

test("dailyTokenLimit = 0 -> LIMITED immediately, even with a null/zero counter", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 0 }), COUNTER_NONE), "LIMITED");
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyTokenLimit: 0 }), counterOk(0, 0)), "LIMITED");
});

// ---------------- mixed configuration ----------------

test("mixed: request limited / token unlimited -> LIMITED (request side alone is enough)", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 10, dailyTokenLimit: null }), counterOk(10, 999_999)), "LIMITED");
});

test("mixed: request unlimited / token limited -> LIMITED (token side alone is enough)", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: null, dailyTokenLimit: 5000 }), counterOk(999_999, 5000)), "LIMITED");
});

test("mixed: request under threshold / token over threshold -> WARNING (worst of the two wins)", () => {
  assert.equal(
    computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100, dailyTokenLimit: 1000, warningThresholdPercent: 80 }), counterOk(10, 900)),
    "WARNING",
  );
});

// ---------------- precedence ----------------

test("precedence: UNAVAILABLE wins over every other would-be outcome", () => {
  // Even a counter that looks catastrophically over any limit does not
  // matter once the policy itself could not be read.
  assert.equal(computeRadarAiQuotaStatus(POLICY_ERROR, counterOk(999_999_999, 999_999_999)), "UNAVAILABLE");
});

test("precedence: DISABLED wins over LIMITED and WARNING", () => {
  // Usage is already past the limit AND past the warning threshold, but
  // the policy is disabled -- DISABLED must still be the result.
  assert.equal(computeRadarAiQuotaStatus(policyOk({ enabled: false, dailyRequestLimit: 10, warningThresholdPercent: 1 }), counterOk(1000, 0)), "DISABLED");
});

test("precedence: LIMITED wins over WARNING when both conditions are technically met", () => {
  // requestCount (100) is >= limit (100) -> LIMITED. A warning threshold
  // of 1% would also "match" if warning were evaluated first, proving
  // LIMITED is checked and returned before WARNING logic ever runs.
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 100, warningThresholdPercent: 1 }), counterOk(100, 0)), "LIMITED");
});

// ---------------- NORMAL fallback ----------------

test("NORMAL: the fallback when nothing else applies -- enabled, limits configured, usage well under threshold", () => {
  assert.equal(computeRadarAiQuotaStatus(policyOk({ dailyRequestLimit: 1000, dailyTokenLimit: 100_000, warningThresholdPercent: 80 }), counterOk(1, 1)), "NORMAL");
});

// ---------------- "missing" policy status (G4B-2 contract: not an error) ----------------

test("policy status 'missing' (never configured yet) is treated exactly like 'ok' with the default policy -- NOT an UNAVAILABLE condition", () => {
  const missing = {
    status: "missing",
    policy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 },
  };
  assert.equal(computeRadarAiQuotaStatus(missing, COUNTER_ERROR), "NORMAL");
});

// ---------------- purity / no side effects ----------------

test("purity: calling the function twice with identical inputs returns the identical result (deterministic)", () => {
  const policy = policyOk({ dailyRequestLimit: 100, warningThresholdPercent: 80 });
  const counter = counterOk(85, 0);
  const first = computeRadarAiQuotaStatus(policy, counter);
  const second = computeRadarAiQuotaStatus(policy, counter);
  assert.equal(first, second);
  assert.equal(first, "WARNING");
});

test("purity: does not mutate its inputs", () => {
  const policy = policyOk({ dailyRequestLimit: 100 });
  const counter = counterOk(50, 0);
  const policySnapshot = JSON.stringify(policy);
  const counterSnapshot = JSON.stringify(counter);
  computeRadarAiQuotaStatus(policy, counter);
  assert.equal(JSON.stringify(policy), policySnapshot);
  assert.equal(JSON.stringify(counter), counterSnapshot);
});
