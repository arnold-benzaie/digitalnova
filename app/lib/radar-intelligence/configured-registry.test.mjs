// RADAR INTELLIGENCE V1 — Slice 3 — configured-registry end-to-end (no network).
//
// loaded config -> createConfiguredRadarIntelligenceRegistry -> real HTTP
// transport (with an injected FAKE fetch) -> anthropic adapter -> gateway
// -> RadarIntelligenceSnapshot.
//
// Proves: disabled-by-default parity, enabled+key success path, enabled
// with NO key fails closed (fetch hit count 0), disabled+key not registered
// (fetch hit 0), every HTTP failure keeps the deterministic RADAR snapshot
// usable, and a hostile fake key never leaks into any returned structure.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/configured-registry.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { createConfiguredRadarIntelligenceRegistry } = await import("./configured-registry.ts");
const { createRadarIntelligenceGateway } = await import("./gateway.ts");
const { buildRadarIntelligenceSnapshot } = await import("./snapshot.ts");
const { buildTelemetryEvent } = await import("./telemetry.ts");

const FAKE_KEY = "sk-ant-THIS-MUST-NEVER-LEAK";
const clock = () => new Date("2026-09-12T09:00:00.000Z");
let n = 0;
const ids = () => `s3-${(n += 1)}`;

const DET = {
  priority: "HIGH",
  confidence: "MEDIUM",
  reasons: [{ code: "DEAL_STAGE_PROPOSAL" }, { code: "INDUSTRY_RECORDED", value: "bakery" }],
  recommendedNextAction: "FOLLOW_UP_PROPOSAL",
  qualificationStatus: "QUALIFIED",
};
const DISPLAY = { prospectName: "Boulangerie Lefèvre", stage: "prospect", sector: "bakery", recentInteractionSummaries: ["Called re: proposal."], openFollowUpCount: 1 };

function loadedConfig({ enabled = true, hasKey = true, model = "claude-sonnet-4-5" } = {}) {
  const effective = enabled && hasKey;
  return {
    anthropic: {
      enabledFlag: enabled,
      hasCredential: hasKey,
      effectiveEnabled: effective,
      model,
      apiKey: hasKey ? FAKE_KEY : null,
      maxOutputTokens: 512,
      maxRequestBytes: 24000,
    },
  };
}

function fakeFetch(script = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (script.reject) throw script.reject;
    const status = script.status ?? 200;
    return {
      status,
      async json() {
        if (script.invalidJson) throw new SyntaxError("bad");
        return script.body ?? { content: [{ type: "text", text: "Proposal stage; a follow-up is advisable." }], usage: { input_tokens: 12, output_tokens: 8 } };
      },
    };
  };
  fn.calls = calls;
  return fn;
}

const snapWith = async (registry) => {
  const gw = createRadarIntelligenceGateway({ registry, clock, generateRequestId: ids, policy: { timeoutMs: 8000, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() } });
  return buildRadarIntelligenceSnapshot({ deterministic: DET, display: DISPLAY }, { gateway: gw });
};

// ---------------- disabled-by-default ----------------

test("disabled config -> Slice-1 parity: only deterministic, no fetch, snapshot deterministic", async () => {
  const ff = fakeFetch();
  const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig({ enabled: false }), fetchImpl: ff, clock });
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
  const snap = await snapWith(reg);
  assert.deepEqual(snap.deterministic, DET);
  assert.equal(snap.providerAvailable, false);
  assert.equal(snap.source, "radar-core");
  assert.equal(ff.calls.length, 0);
});

test("enabled flag but NO key -> fails closed: anthropic NOT registered, fetch hit count 0", async () => {
  const ff = fakeFetch();
  const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig({ enabled: true, hasKey: false }), fetchImpl: ff, clock });
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
  await snapWith(reg);
  assert.equal(ff.calls.length, 0);
});

test("live switch OFF wins even when a key exists (enabled:false + hasKey:true)", async () => {
  const ff = fakeFetch();
  const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig({ enabled: false, hasKey: true }), fetchImpl: ff, clock });
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
  await snapWith(reg);
  assert.equal(ff.calls.length, 0);
});

// ---------------- success path ----------------

test("enabled + key + fake 200 -> provider advisory, deterministic UNCHANGED, x-api-key sent but never leaks", async () => {
  const ff = fakeFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig(), fetchImpl: ff, clock });
  assert.deepEqual(reg.list().map((a) => a.id).sort(), ["anthropic", "deterministic"].sort());
  const snap = await snapWith(reg);
  assert.deepEqual(snap.deterministic, DET);
  assert.equal(snap.providerAvailable, true);
  assert.equal(snap.advisoryStatus, "ADVISORY_AVAILABLE");
  assert.equal(snap.intelligence.advisory, true);
  assert.equal(snap.intelligence.provider, "anthropic");
  assert.equal(snap.source, "provider");
  // the fake key WAS sent on the wire...
  assert.equal(ff.calls.length, 1);
  assert.equal(ff.calls[0].init.headers["x-api-key"], FAKE_KEY);
  // ...but never in any returned application structure
  assert.ok(!JSON.stringify(snap).includes(FAKE_KEY));
  const ev = buildTelemetryEvent({ ...snap, requestId: "r", providerId: "anthropic", error: null, connection: "CONNECTED" }, { capability: "summarize", latencyMs: 3 });
  assert.ok(!JSON.stringify(ev).includes(FAKE_KEY));
});

// ---------------- failure paths: deterministic RADAR stays usable ----------------

for (const [label, script] of [
  ["401", { status: 401 }],
  ["429", { status: 429 }],
  ["503", { status: 503 }],
  ["invalid JSON", { status: 200, invalidJson: true }],
  ["AbortError", { reject: Object.assign(new Error(`x ${FAKE_KEY}`), { name: "AbortError" }) }],
  ["network throw", { reject: Object.assign(new Error(`ECONNRESET ${FAKE_KEY}`), { name: "FetchError" }) }],
]) {
  test(`failure: anthropic ${label} -> deterministic snapshot intact, no key leak`, async () => {
    const ff = fakeFetch(script);
    const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig(), fetchImpl: ff, clock });
    const snap = await snapWith(reg);
    assert.deepEqual(snap.deterministic, DET);
    assert.equal(snap.intelligence, null);
    assert.equal(snap.providerAvailable, false);
    for (const k of ["priority", "confidence", "reasons", "recommendedNextAction", "qualificationStatus"]) {
      assert.ok(k in snap.deterministic);
    }
    assert.ok(!JSON.stringify(snap).includes(FAKE_KEY));
  });
}

// ---------------- error-code mapping through the real transport ----------------

test("error mapping: 429 -> PROVIDER_RATE_LIMITED, 503 -> PROVIDER_UNAVAILABLE, 401 -> PROVIDER_ERROR", async () => {
  const run = async (status) => {
    const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig(), fetchImpl: fakeFetch({ status }), clock });
    const gw = createRadarIntelligenceGateway({ registry: reg, clock, generateRequestId: ids, policy: { timeoutMs: 8000, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() } });
    return gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: (await import("./sanitize-context.ts")).sanitizeProspectContext({ prospectName: "X", stage: "s" }) });
  };
  assert.equal((await run(429)).error.code, "PROVIDER_RATE_LIMITED");
  assert.equal((await run(503)).error.code, "PROVIDER_UNAVAILABLE");
  assert.equal((await run(401)).error.code, "PROVIDER_ERROR");
});
