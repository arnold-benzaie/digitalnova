// Pure unit tests for lib/radar/priority.ts's assessPriority() — MICRO-STEP 4A.
// Zero I/O, zero database, zero AI — plain function over fixtures.
// Run with: npx tsx --test lib/radar/priority.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assessPriority,
  PRIORITY_ADJUSTMENT_DIRECTIONS,
  PRIORITY_ADJUSTMENT_REASON_CODES,
} from "./priority.ts";

const NOW = new Date("2026-08-28T12:00:00Z");
const SOURCE = readFileSync(fileURLToPath(new URL("./priority.ts", import.meta.url)), "utf8");

function signal(type) {
  return { type, color: "blue", severity: "info", reason: "FIXTURE_REASON", evidence: {}, detectedAt: NOW };
}

function websiteOpportunity() {
  return {
    type: "WEBSITE",
    service: "website_creation",
    reason: "NO_WEBSITE_DETECTED",
    evidence: { website: null },
    sourceSignals: ["NO_WEBSITE"],
  };
}

function run(basePriority, { signals = [], opportunities = [] } = {}) {
  return assessPriority({ basePriority, signals, opportunities });
}

// ---- 1 / 5 / 20. no signal, no opportunity ----
test("1. LOW with no signal and no opportunity stays LOW with no adjustment", () => {
  assert.deepEqual(run("LOW"), { basePriority: "LOW", finalPriority: "LOW", priorityAdjustments: [] });
});

test("20. empty arrays produce no adjustment at any base tier", () => {
  for (const base of ["LOW", "MEDIUM", "HIGH"]) {
    const result = run(base);
    assert.equal(result.finalPriority, base);
    assert.deepEqual(result.priorityAdjustments, []);
  }
});

// ---- 2 / 3 / 4. one opportunity ----
test("2. LOW + WEBSITE opportunity -> MEDIUM, with one UP / OPPORTUNITY_PRESENT adjustment", () => {
  const result = run("LOW", { opportunities: [websiteOpportunity()] });
  assert.equal(result.basePriority, "LOW");
  assert.equal(result.finalPriority, "MEDIUM");
  assert.deepEqual(result.priorityAdjustments, [
    { direction: "UP", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
  ]);
});

test("3. MEDIUM + WEBSITE opportunity stays MEDIUM (never reaches HIGH); recorded as NONE", () => {
  const result = run("MEDIUM", { opportunities: [websiteOpportunity()] });
  assert.equal(result.finalPriority, "MEDIUM");
  assert.deepEqual(result.priorityAdjustments, [
    { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
  ]);
});

test("4. HIGH + WEBSITE opportunity stays HIGH; recorded as NONE", () => {
  const result = run("HIGH", { opportunities: [websiteOpportunity()] });
  assert.equal(result.finalPriority, "HIGH");
  assert.deepEqual(result.priorityAdjustments, [
    { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
  ]);
});

// ---- 5. several opportunities ----
test("5. LOW + several opportunities -> MEDIUM, never HIGH, with exactly one UP adjustment", () => {
  const result = run("LOW", { opportunities: [websiteOpportunity(), websiteOpportunity()] });
  assert.equal(result.finalPriority, "MEDIUM");
  assert.equal(result.priorityAdjustments.length, 1);
  assert.equal(result.priorityAdjustments[0].direction, "UP");
  assert.deepEqual(result.priorityAdjustments[0].sourceOpportunities, ["WEBSITE"], "opportunity types are de-duplicated");
});

// ---- 6 / 7 / 8. BUSINESS_CLOSED never lowers basePriority (4C.3, S3) ----
// Opportunities in BUSINESS_CLOSED tests are passed DIRECTLY to
// assessPriority(); they are never derived from BUSINESS_CLOSED + NO_WEBSITE
// (the Opportunity Engine blocks that combination since 4C.1), so no
// NO_WEBSITE signal is ever paired with BUSINESS_CLOSED below.
const REVIEW = { direction: "NONE", reasonCode: "BUSINESS_CLOSED_REVIEW", sourceSignals: ["BUSINESS_CLOSED"] };

test("6. BUSINESS_CLOSED + LOW -> LOW with a BUSINESS_CLOSED_REVIEW adjustment", () => {
  const result = run("LOW", { signals: [signal("BUSINESS_CLOSED")] });
  assert.equal(result.finalPriority, "LOW");
  assert.deepEqual(result.priorityAdjustments, [REVIEW]);
});

test("7. BUSINESS_CLOSED + MEDIUM -> MEDIUM (never lowered)", () => {
  const result = run("MEDIUM", { signals: [signal("BUSINESS_CLOSED")] });
  assert.equal(result.basePriority, "MEDIUM");
  assert.equal(result.finalPriority, "MEDIUM");
  assert.deepEqual(result.priorityAdjustments, [REVIEW]);
});

test("8. BUSINESS_CLOSED + HIGH -> HIGH (never lowered)", () => {
  const result = run("HIGH", { signals: [signal("BUSINESS_CLOSED")] });
  assert.equal(result.basePriority, "HIGH");
  assert.equal(result.finalPriority, "HIGH");
  assert.deepEqual(result.priorityAdjustments, [REVIEW]);
});

// ---- 9. BUSINESS_CLOSED neutralizes an opportunity promotion ----
test("9. LOW + direct opportunity: MEDIUM without BUSINESS_CLOSED, neutralized back to LOW with it", () => {
  const withoutClosed = run("LOW", { opportunities: [websiteOpportunity()] });
  assert.equal(withoutClosed.finalPriority, "MEDIUM", "the opportunity would normally promote LOW -> MEDIUM");

  const withClosed = run("LOW", { signals: [signal("BUSINESS_CLOSED")], opportunities: [websiteOpportunity()] });
  assert.equal(withClosed.finalPriority, "LOW", "the promotion is neutralized");
  assert.deepEqual(withClosed.priorityAdjustments, [
    { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
    REVIEW,
  ]);
  assert.ok(!withClosed.priorityAdjustments.some((a) => a.direction === "UP"), "no UP survives BUSINESS_CLOSED");
});

test("9b. MEDIUM + BUSINESS_CLOSED + opportunity -> MEDIUM", () => {
  const result = run("MEDIUM", { signals: [signal("BUSINESS_CLOSED")], opportunities: [websiteOpportunity()] });
  assert.equal(result.finalPriority, "MEDIUM");
  assert.equal(result.priorityAdjustments.at(-1).reasonCode, "BUSINESS_CLOSED_REVIEW");
});

test("9c. HIGH + BUSINESS_CLOSED + opportunity -> HIGH", () => {
  const result = run("HIGH", { signals: [signal("BUSINESS_CLOSED")], opportunities: [websiteOpportunity()] });
  assert.equal(result.finalPriority, "HIGH");
  assert.equal(result.priorityAdjustments.at(-1).reasonCode, "BUSINESS_CLOSED_REVIEW");
});

test("9d. BUSINESS_CLOSED never produces BUSINESS_CLOSED_CAP nor a CAP direction", () => {
  for (const base of ["LOW", "MEDIUM", "HIGH"]) {
    for (const opportunities of [[], [websiteOpportunity()]]) {
      const result = run(base, { signals: [signal("BUSINESS_CLOSED")], opportunities });
      assert.ok(!result.priorityAdjustments.some((a) => a.reasonCode === "BUSINESS_CLOSED_CAP"));
      assert.ok(!result.priorityAdjustments.some((a) => a.direction === "CAP"));
    }
  }
  assert.ok(!PRIORITY_ADJUSTMENT_REASON_CODES.includes("BUSINESS_CLOSED_CAP"), "BUSINESS_CLOSED_CAP is gone from the closed set");
});

test("9e. monotonicity: finalPriority >= basePriority for every base x opportunity x BUSINESS_CLOSED combination", () => {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  for (const base of ["LOW", "MEDIUM", "HIGH"]) {
    for (const opportunities of [[], [websiteOpportunity()], [websiteOpportunity(), websiteOpportunity()]]) {
      for (const signals of [[], [signal("BUSINESS_CLOSED")], [signal("BUSINESS_CLOSED"), signal("RECENT_ACTIVITY")]]) {
        const result = run(base, { signals, opportunities });
        assert.ok(rank[result.finalPriority] >= rank[result.basePriority], `${base} dropped to ${result.finalPriority}`);
        if (signals.length > 0) assert.equal(result.finalPriority, base, "BUSINESS_CLOSED keeps finalPriority at base");
      }
    }
  }
});

// ---- 10-13. informational signals alone ----
for (const [n, type] of [
  [10, "NO_WEBSITE"],
  [11, "DISCOVERY_NEW"],
  [12, "NO_RECENT_INTERACTION"],
  [13, "RECENT_ACTIVITY"],
]) {
  test(`${n}. ${type} alone never changes priority at any base tier and records no adjustment`, () => {
    for (const base of ["LOW", "MEDIUM", "HIGH"]) {
      const result = run(base, { signals: [signal(type)] });
      assert.equal(result.finalPriority, base);
      assert.deepEqual(result.priorityAdjustments, []);
    }
  });
}

// ---- 14. opportunity is the only path for UP ----
test("14. a WEBSITE opportunity without any NO_WEBSITE signal still raises LOW -> MEDIUM", () => {
  const result = run("LOW", { signals: [], opportunities: [websiteOpportunity()] });
  assert.equal(result.finalPriority, "MEDIUM");
});

test("14b. NO_WEBSITE signal + WEBSITE opportunity produces ONE adjustment, not two (no double counting)", () => {
  const result = run("LOW", { signals: [signal("NO_WEBSITE")], opportunities: [websiteOpportunity()] });
  assert.equal(result.finalPriority, "MEDIUM");
  assert.equal(result.priorityAdjustments.length, 1);
});

test("14c. structural: priority.ts never reads the NO_WEBSITE signal type directly", () => {
  assert.ok(!SOURCE.includes('"NO_WEBSITE"'), "no quoted NO_WEBSITE literal in the engine source");
});

// ---- 15. determinism ----
test("15. identical input always produces an identical result", () => {
  const input = { basePriority: "LOW", signals: [signal("BUSINESS_CLOSED"), signal("DISCOVERY_NEW")], opportunities: [websiteOpportunity()] };
  assert.deepEqual(assessPriority(input), assessPriority(input));
});

// ---- 16. no mutation ----
test("16. inputs are never mutated", () => {
  const input = { basePriority: "LOW", signals: [signal("BUSINESS_CLOSED")], opportunities: [websiteOpportunity()] };
  const snapshot = structuredClone(input);
  assessPriority(input);
  assert.deepEqual(input, snapshot);
});

test("16b. frozen inputs are accepted without throwing", () => {
  const input = Object.freeze({
    basePriority: "LOW",
    signals: Object.freeze([Object.freeze(signal("BUSINESS_CLOSED"))]),
    opportunities: Object.freeze([Object.freeze(websiteOpportunity())]),
  });
  assert.doesNotThrow(() => assessPriority(input));
});

// ---- 17. explainability ----
test("17. every adjustment uses only the closed direction / reason-code sets", () => {
  const directions = new Set(PRIORITY_ADJUSTMENT_DIRECTIONS);
  const reasons = new Set(PRIORITY_ADJUSTMENT_REASON_CODES);
  const cases = [
    run("LOW", { opportunities: [websiteOpportunity()] }),
    run("MEDIUM", { opportunities: [websiteOpportunity()] }),
    run("HIGH", { signals: [signal("BUSINESS_CLOSED")], opportunities: [websiteOpportunity()] }),
  ];
  for (const result of cases) {
    for (const adjustment of result.priorityAdjustments) {
      assert.ok(directions.has(adjustment.direction));
      assert.ok(reasons.has(adjustment.reasonCode));
    }
  }
});

test("17b. basePriority is always returned verbatim, whatever the adjustments", () => {
  for (const base of ["LOW", "MEDIUM", "HIGH"]) {
    const result = run(base, { signals: [signal("BUSINESS_CLOSED")], opportunities: [websiteOpportunity()] });
    assert.equal(result.basePriority, base);
  }
});

// ---- 18. sources ----
test("18. OPPORTUNITY_PRESENT carries sourceOpportunities only; BUSINESS_CLOSED_REVIEW carries sourceSignals only", () => {
  const result = run("LOW", { signals: [signal("BUSINESS_CLOSED")], opportunities: [websiteOpportunity()] });
  const [opportunity, review] = result.priorityAdjustments;
  assert.deepEqual(opportunity.sourceOpportunities, ["WEBSITE"]);
  assert.equal(opportunity.sourceSignals, undefined);
  assert.equal(review.reasonCode, "BUSINESS_CLOSED_REVIEW");
  assert.deepEqual(review.sourceSignals, ["BUSINESS_CLOSED"]);
  assert.equal(review.sourceOpportunities, undefined);
});

// ---- 19. several signals at once ----
test("19. BUSINESS_CLOSED + informational signals + direct opportunity from LOW -> promotion neutralized, ending LOW", () => {
  // NO_WEBSITE deliberately excluded: BUSINESS_CLOSED + NO_WEBSITE never
  // yields an opportunity (4C.1); the opportunity here is passed directly.
  const result = run("LOW", {
    signals: ["DISCOVERY_NEW", "BUSINESS_CLOSED", "NO_RECENT_INTERACTION", "RECENT_ACTIVITY"].map(signal),
    opportunities: [websiteOpportunity()],
  });
  assert.equal(result.finalPriority, "LOW");
  assert.deepEqual(
    result.priorityAdjustments.map((a) => [a.direction, a.reasonCode]),
    [
      ["NONE", "OPPORTUNITY_PRESENT"],
      ["NONE", "BUSINESS_CLOSED_REVIEW"],
    ],
  );
});

test("19a. all informational signals + direct opportunity WITHOUT BUSINESS_CLOSED: existing LOW -> MEDIUM rule unchanged", () => {
  const result = run("LOW", {
    signals: ["DISCOVERY_NEW", "NO_WEBSITE", "NO_RECENT_INTERACTION", "RECENT_ACTIVITY"].map(signal),
    opportunities: [websiteOpportunity()],
  });
  assert.equal(result.finalPriority, "MEDIUM");
  assert.deepEqual(result.priorityAdjustments, [
    { direction: "UP", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
  ]);
});

test("19b. several informational signals without BUSINESS_CLOSED or opportunity leave priority untouched", () => {
  const result = run("MEDIUM", { signals: ["DISCOVERY_NEW", "NO_WEBSITE", "RECENT_ACTIVITY"].map(signal) });
  assert.equal(result.finalPriority, "MEDIUM");
  assert.deepEqual(result.priorityAdjustments, []);
});

// =========================================================
// MICRO-STEP 4F.2-C — promotion is explicit per opportunity type:
// WEBSITE promotes LOW -> MEDIUM, PROPOSAL_RENEWAL never does.
// =========================================================

function renewalOpportunity() {
  return {
    type: "PROPOSAL_RENEWAL",
    service: null,
    reason: "QUOTE_VALIDITY_EXPIRED_UNANSWERED",
    evidence: { expiredQuoteCount: 1 },
    sourceSignals: ["QUOTE_PAST_VALIDITY"],
  };
}

test("4F.2-C: LOW + PROPOSAL_RENEWAL stays LOW, recorded as a NONE / OPPORTUNITY_PRESENT entry", () => {
  const result = run("LOW", { opportunities: [renewalOpportunity()] });
  assert.equal(result.basePriority, "LOW");
  assert.equal(result.finalPriority, "LOW");
  assert.deepEqual(result.priorityAdjustments, [
    { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["PROPOSAL_RENEWAL"] },
  ]);
});

test("4F.2-C: LOW + WEBSITE still promotes to MEDIUM (unchanged)", () => {
  const result = run("LOW", { opportunities: [websiteOpportunity()] });
  assert.equal(result.finalPriority, "MEDIUM");
  assert.deepEqual(result.priorityAdjustments, [
    { direction: "UP", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
  ]);
});

test("4F.2-C: LOW + no opportunity stays LOW with no adjustment", () => {
  assert.deepEqual(run("LOW"), { basePriority: "LOW", finalPriority: "LOW", priorityAdjustments: [] });
});

test("4F.2-C: LOW + WEBSITE + PROPOSAL_RENEWAL promotes once (WEBSITE), in either order", () => {
  for (const opportunities of [
    [websiteOpportunity(), renewalOpportunity()],
    [renewalOpportunity(), websiteOpportunity()],
  ]) {
    const result = run("LOW", { opportunities });
    assert.equal(result.finalPriority, "MEDIUM");
    assert.equal(result.priorityAdjustments.length, 1);
    assert.equal(result.priorityAdjustments[0].direction, "UP");
  }
});

test("4F.2-C: MEDIUM / HIGH + PROPOSAL_RENEWAL are unchanged (NONE entry, same tier)", () => {
  for (const base of ["MEDIUM", "HIGH"]) {
    const result = run(base, { opportunities: [renewalOpportunity()] });
    assert.equal(result.finalPriority, base);
    assert.deepEqual(result.priorityAdjustments, [
      { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["PROPOSAL_RENEWAL"] },
    ]);
  }
});

test("4F.2-C: LOW + PROPOSAL_RENEWAL + BUSINESS_CLOSED stays LOW with the S3 review entry (unchanged)", () => {
  const result = run("LOW", { signals: [signal("BUSINESS_CLOSED")], opportunities: [renewalOpportunity()] });
  assert.equal(result.finalPriority, "LOW");
  assert.deepEqual(result.priorityAdjustments, [
    { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["PROPOSAL_RENEWAL"] },
    REVIEW,
  ]);
});

test("4F.2-C: PROPOSAL_RENEWAL is ranking-neutral — finalPriority === basePriority at every tier, with or without other signals", () => {
  for (const base of ["LOW", "MEDIUM", "HIGH"]) {
    for (const signals of [[], [signal("RECENT_ACTIVITY")], [signal("BUSINESS_CLOSED")], [signal("NO_RECENT_INTERACTION"), signal("DEAL_ACTIVE")]]) {
      const result = run(base, { signals, opportunities: [renewalOpportunity(), renewalOpportunity()] });
      assert.equal(result.finalPriority, base, `${base} with ${signals.map((s) => s.type).join(",")}`);
      assert.ok(!result.priorityAdjustments.some((a) => a.direction === "UP"));
    }
  }
});

test("4F.2-C: monotonicity still holds for every base x {none, WEBSITE, RENEWAL, both} x {no BC, BC}", () => {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  for (const base of ["LOW", "MEDIUM", "HIGH"]) {
    for (const opportunities of [[], [websiteOpportunity()], [renewalOpportunity()], [websiteOpportunity(), renewalOpportunity()]]) {
      for (const signals of [[], [signal("BUSINESS_CLOSED")]]) {
        const result = run(base, { signals, opportunities });
        assert.ok(rank[result.finalPriority] >= rank[result.basePriority]);
        assert.ok(rank[result.finalPriority] - rank[result.basePriority] <= 1);
      }
    }
  }
});

test("4F.2-C: deterministic and inputs are never mutated with a PROPOSAL_RENEWAL", () => {
  const input = { basePriority: "LOW", signals: [signal("BUSINESS_CLOSED")], opportunities: [renewalOpportunity(), websiteOpportunity()] };
  const snapshot = structuredClone(input);
  assert.deepEqual(assessPriority(input), assessPriority(input));
  assert.deepEqual(input, snapshot);
});

test("4F.2-C: structural — the promotion condition names WEBSITE explicitly and no longer relies on opportunities.length alone", () => {
  assert.match(SOURCE, /o\.type === "WEBSITE"/);
  assert.match(SOURCE, /finalPriority === "LOW" && hasPromotingOpportunity && !businessClosed/);
  assert.ok(!SOURCE.includes('"DEAL_STALLED"'), "no anticipated DEAL_STALLED behaviour");
});
