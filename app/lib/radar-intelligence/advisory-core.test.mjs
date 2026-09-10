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
      // A 200 with an arbitrary/unexpected body shape (no extractable summary).
      if (script.body !== undefined) return { body: script.body, status };
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
  assert.equal(r.status, "unavailable");
  // The designed no-provider state is NOT a failure — it carries no
  // operator diagnostic (byte-identical to the pre-patch result).
  assert.equal("diagnostic" in r, false);
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

for (const [label, script, expected, diagnostic] of [
  ["429", { status: 429 }, "rate_limited", "PROVIDER_4XX"],
  ["503", { status: 503 }, "unavailable", "PROVIDER_5XX"],
  ["AbortError", { reject: Object.assign(new Error(`t ${FAKE_KEY}`), { name: "AbortError" }) }, "timeout", "PROVIDER_TIMEOUT"],
  ["malformed body", { status: 200, invalidJson: true }, "error", "PROVIDER_PARSE"],
]) {
  test(`provider ${label} -> ${expected} (diagnostic ${diagnostic}); exactly one attempt; no secret / raw detail`, async () => {
    const t = fakeTransport(script);
    const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
    assert.equal(t.hits, 1, "one attempt, no core-level retry");
    assert.equal(r.status, expected);
    assert.equal(r.diagnostic, diagnostic);
    assert.equal(JSON.stringify(r).includes(FAKE_KEY), false);
  });
}

// ---------------- provider failures: the coarse diagnostic class ----------------
//
// The advisory core carries a coarse `diagnostic` bucket on a GENUINE
// provider transport/response failure only. RBAC (SYSTEM_ADMIN-only
// exposure) lives in the server action, not here — this proves the class
// is derived correctly and never smuggles a secret / status number / body.

const NET_ERR = Object.assign(new Error(`net ${FAKE_KEY}`), { name: "TransportNetworkError" });
const JSON_ERR = Object.assign(new Error(`json ${FAKE_KEY}`), { name: "InvalidJsonError" });

for (const [label, script, expectedStatus, expectedClass] of [
  ["HTTP 400", { status: 400 }, "error", "PROVIDER_4XX"],
  ["HTTP 401", { status: 401 }, "error", "PROVIDER_4XX"],
  ["HTTP 403", { status: 403 }, "error", "PROVIDER_4XX"],
  ["HTTP 429", { status: 429 }, "rate_limited", "PROVIDER_4XX"],
  ["HTTP 500", { status: 500 }, "error", "PROVIDER_5XX"],
  ["HTTP 502", { status: 502 }, "unavailable", "PROVIDER_5XX"],
  ["HTTP 503", { status: 503 }, "unavailable", "PROVIDER_5XX"],
  ["HTTP 504", { status: 504 }, "unavailable", "PROVIDER_5XX"],
  ["AbortError (timeout)", { reject: Object.assign(new Error("x"), { name: "AbortError" }) }, "timeout", "PROVIDER_TIMEOUT"],
  ["network fault", { reject: NET_ERR }, "error", "PROVIDER_NETWORK"],
  ["invalid JSON on 200", { reject: JSON_ERR }, "error", "PROVIDER_PARSE"],
  ["unexpected 200 body shape", { status: 200, body: { nonsense: true, note: "no summary here" } }, "error", "PROVIDER_PARSE"],
]) {
  test(`diagnostic: ${label} -> status ${expectedStatus}, diagnostic ${expectedClass}`, async () => {
    const t = fakeTransport(script);
    const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
    assert.equal(t.hits, 1, "exactly one provider attempt");
    assert.equal(r.status, expectedStatus);
    assert.equal(r.diagnostic, expectedClass);
    assert.equal(["PROVIDER_4XX", "PROVIDER_5XX", "PROVIDER_TIMEOUT", "PROVIDER_NETWORK", "PROVIDER_PARSE", "PROVIDER_UNKNOWN"].includes(r.diagnostic), true);
    const s = JSON.stringify(r);
    assert.equal(s.includes(FAKE_KEY), false, "no api key");
    assert.equal(s.includes("sk-ant-"), false);
    assert.equal(/x-api-key|authorization|bearer/i.test(s), false, "no auth header name/value");
    assert.equal(/\b(4\d\d|5\d\d)\b/.test(s.replace(/PROVIDER_[45]XX/g, "")), false, "no raw HTTP status number");
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s), false, "no UUID");
    assert.equal("errorCode" in r, false);
    assert.equal(s.includes("providerId"), false);
    assert.equal(/anthropic|claude/i.test(s), false, "no provider name");
  });
}

test("diagnostic: a SUCCESS result carries no diagnostic key at all", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(fakeTransport({ status: 200 })) }));
  assert.equal(r.status, "ok");
  assert.equal("diagnostic" in r, false);
});

test("diagnostic: a pre-gateway error (bad uuid / missing display) carries NO diagnostic — it is not a provider failure", async () => {
  const bad = await produceRadarAdvisory("not-a-uuid", deps());
  assert.deepEqual(bad, { status: "error" });

  const noDisplay = await produceRadarAdvisory(CLIENT, deps({ display: null }));
  assert.deepEqual(noDisplay, { status: "error" });
});

test("diagnostic: not_applicable (prospect not qualified) carries NO diagnostic", async () => {
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ qualification: { qualificationStatus: "INSUFFICIENT_DATA", eligibility: { contactable: true }, opportunity: null } }),
  );
  assert.deepEqual(r, { status: "not_applicable" });
});

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
