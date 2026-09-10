// RADAR INTELLIGENCE V1 — Slice 5 — advisory core tests.
//
// produceRadarAdvisory with fully injected deps: NO DB, NO network. Proves:
//   - clientId validation
//   - not-QUALIFIED prospect -> not_applicable
//   - zero provider -> unavailable (RADAR not broken)
//   - fake provider success -> ok, deterministic basis VERBATIM, no secret
//   - 429 / 503 / AbortError / malformed -> safe status, deterministic
//     values still derivable, no raw provider detail
//   - exactly one gateway request (maxRetries = 0)
//   - the result carries NO provider name / api key / model / requestId /
//     usage / raw error
//   - no mutation path is reachable
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/advisory-core.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { produceRadarAdvisory } = await import("./advisory-core.ts");
const { createRadarIntelligenceRegistry } = await import("./adapters/index.ts");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const FAKE_KEY = "sk-ant-ADVISORY-MUST-NOT-LEAK";
const clock = () => new Date("2026-09-13T10:00:00.000Z");

const OPPORTUNITY = {
  priority: "HIGH",
  confidence: "MEDIUM",
  reasons: [{ code: "DEAL_STAGE_PROPOSAL" }, { code: "INDUSTRY_RECORDED", value: "bakery" }],
  recommendedNextAction: "FOLLOW_UP_PROPOSAL",
};
const QUALIFIED = { qualificationStatus: "QUALIFIED", eligibility: { contactable: true }, opportunity: OPPORTUNITY };

const DISPLAY = {
  name: "Boulangerie Lefèvre",
  sector: "bakery",
  location: "Lyon, FR",
  stage: "prospect",
  recentInteractionSummaries: ["Discussed the proposal."],
  openFollowUpCount: 1,
};

function deps(overrides = {}) {
  return {
    loadQualification: async () => overrides.qualification ?? QUALIFIED,
    loadDisplayContext: async () => (overrides.display === undefined ? DISPLAY : overrides.display),
    createRegistry: overrides.createRegistry ?? (() => createRadarIntelligenceRegistry({})),
    clock,
  };
}

function fakeTransport(script = {}) {
  let hits = 0;
  return {
    get hits() {
      return hits;
    },
    async generate() {
      hits += 1;
      if (script.reject) throw script.reject;
      const status = script.status ?? 200;
      if (status !== 200) return { body: null, status };
      if (script.invalidJson) return { body: "not-json" };
      return { body: { summary: "Advisory for a proposal-stage prospect.", suggestedNextAction: "Send a recap email", usage: { input_tokens: 20, output_tokens: 12 } }, status };
    },
    describeHealth() {
      return { reachable: true, degraded: false };
    },
  };
}

const enabledRegistry = (transport) => () => createRadarIntelligenceRegistry({ config: { anthropic: { enabled: true } }, anthropicTransport: transport, clock });

// ---------------- validation / applicability ----------------

test("invalid clientId -> error, no qualification load", async () => {
  let qLoads = 0;
  const r = await produceRadarAdvisory("not-a-uuid", { ...deps(), loadQualification: async () => { qLoads += 1; return QUALIFIED; } });
  assert.deepEqual(r, { status: "error" });
  assert.equal(qLoads, 0);
});

test("prospect not QUALIFIED -> not_applicable (no provider call)", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ qualification: { qualificationStatus: "INSUFFICIENT_DATA", eligibility: { contactable: true }, opportunity: null }, createRegistry: enabledRegistry(t) }));
  assert.deepEqual(r, { status: "not_applicable" });
  assert.equal(t.hits, 0);
});

test("display context missing -> error", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ display: null }));
  assert.deepEqual(r, { status: "error" });
});

// ---------------- zero provider ----------------

test("no configured provider -> unavailable, NOT an error, deterministic still available upstream", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps());
  assert.deepEqual(r, { status: "unavailable" });
});

// ---------------- success ----------------

test("fake provider 200 -> ok; deterministic basis VERBATIM; NO provider name / secret / usage / requestId", async () => {
  const t = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.equal(t.hits, 1, "exactly one gateway request");
  assert.equal(r.status, "ok");
  assert.match(r.summary, /proposal-stage prospect/);
  assert.equal(r.suggestedNextAction, "Send a recap email");
  assert.equal(typeof r.generatedAt, "string");
  assert.deepEqual(r.deterministic, {
    priority: OPPORTUNITY.priority,
    confidence: OPPORTUNITY.confidence,
    recommendedNextAction: OPPORTUNITY.recommendedNextAction,
  });
  const s = JSON.stringify(r);
  assert.equal(/anthropic|claude/i.test(s), false, "no provider name in the UI result");
  assert.equal(s.includes("requestId"), false);
  assert.equal(s.includes("usage"), false);
  assert.equal("errorCode" in r, false);
});

test("success result has EXACTLY the safe keys", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(fakeTransport({ status: 200 })) }));
  assert.deepEqual(Object.keys(r).sort(), ["deterministic", "generatedAt", "status", "suggestedNextAction", "summary"].sort());
  assert.deepEqual(Object.keys(r.deterministic).sort(), ["confidence", "priority", "recommendedNextAction"].sort());
});

// ---------------- provider failures ----------------

for (const [label, script, expected] of [
  ["429", { status: 429 }, "rate_limited"],
  ["503", { status: 503 }, "unavailable"],
  ["AbortError", { reject: Object.assign(new Error(`t ${FAKE_KEY}`), { name: "AbortError" }) }, "timeout"],
  ["malformed body", { status: 200, invalidJson: true }, "error"],
]) {
  test(`provider ${label} -> ${expected}; exactly one attempt; no secret / raw detail`, async () => {
    const t = fakeTransport(script);
    const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
    assert.equal(t.hits, 1, "one attempt, no core-level retry");
    assert.deepEqual(r, { status: expected });
    assert.equal(JSON.stringify(r).includes(FAKE_KEY), false);
  });
}

// ---------------- non-authoritative / no mutation ----------------

test("the deps bag has no mutation capability — only loaders + a registry factory", async () => {
  const d = deps();
  assert.deepEqual(Object.keys(d).sort(), ["clock", "createRegistry", "loadDisplayContext", "loadQualification"].sort());
  // produceRadarAdvisory itself takes only (clientId, deps) — no provider,
  // model, userId, or workspace parameter.
  assert.equal(produceRadarAdvisory.length, 2);
});

test("a success advisory never overrides the deterministic values (they mirror the input opportunity)", async () => {
  // provider tries to claim a different priority in its summary — the
  // result's deterministic block is still the authoritative opportunity.
  const t = {
    async generate() {
      return { body: { summary: "priority: LOW, score: 0" }, status: 200 };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.equal(r.deterministic.priority, "HIGH");
  assert.equal(r.deterministic.recommendedNextAction, "FOLLOW_UP_PROPOSAL");
});
