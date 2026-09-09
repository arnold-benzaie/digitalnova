// RADAR INTELLIGENCE V1 — Slice 2 — Anthropic end-to-end (no network).
//
// context -> gateway -> anthropic adapter -> FAKE transport -> normalized
// advisory -> RadarIntelligenceSnapshot. Plus the fallback matrix, bounded
// retry, circuit-breaker (deterministic fake clock), registry selection,
// and telemetry-carries-no-content.
//
// Run: npx tsx --test lib/radar-intelligence/adapters/anthropic-integration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRadarIntelligenceGateway } from "../gateway.ts";
import { buildRadarIntelligenceSnapshot } from "../snapshot.ts";
import { buildTelemetryEvent } from "../telemetry.ts";
import { sanitizeProspectContext } from "../sanitize-context.ts";
import { createRadarIntelligenceRegistry } from "./index.ts";
import { createAnthropicAdapter } from "./anthropic.ts";
import { createProviderRegistry } from "../provider-registry.ts";
import { deterministicFallbackAdapter } from "../deterministic-fallback.ts";

const FAKE_SECRET = "sk-ant-DO-NOT-LEAK-TEST";

const DET = {
  priority: "HIGH",
  confidence: "MEDIUM",
  reasons: [{ code: "DEAL_STAGE_PROPOSAL" }, { code: "INDUSTRY_RECORDED", value: "bakery" }],
  recommendedNextAction: "FOLLOW_UP_PROPOSAL",
  qualificationStatus: "QUALIFIED",
};
const DISPLAY = { prospectName: "Boulangerie Lefèvre", stage: "prospect", sector: "bakery", recentInteractionSummaries: ["Called re: proposal."], openFollowUpCount: 1 };
const CTX = sanitizeProspectContext({ ...DISPLAY, deterministicPriority: "HIGH", deterministicConfidence: "MEDIUM", deterministicReasonCodes: ["DEAL_STAGE_PROPOSAL"], recommendedNextActionCode: "FOLLOW_UP_PROPOSAL" });

let clockMs = Date.parse("2026-09-11T09:00:00.000Z");
const clock = () => new Date(clockMs);
const advance = (ms) => {
  clockMs += ms;
};
let n = 0;
const ids = () => `req-${(n += 1)}`;

function fakeTransport(script = {}) {
  const calls = [];
  let hits = 0;
  return {
    calls,
    get hits() {
      return hits;
    },
    async generate(payload) {
      calls.push(payload);
      hits += 1;
      const mode = typeof script.mode === "function" ? script.mode(hits) : script.mode;
      if (mode === "timeout") {
        const e = new Error(`t key=${FAKE_SECRET}`);
        e.name = "AbortError";
        throw e;
      }
      if (mode === "throw") throw Object.assign(new Error(`boom ${FAKE_SECRET}`), { name: "TypeError" });
      if (mode === "status") return { body: {}, status: script.status };
      if (mode === "malformed") return { body: "nope" };
      return { body: { summary: "Proposal stage; follow up soon.", usage: { input_tokens: 10, output_tokens: 20 } } };
    },
    describeHealth() {
      return script.health ?? { reachable: true, degraded: false };
    },
  };
}

function enabledRegistry(script, extra = {}) {
  return createRadarIntelligenceRegistry({
    config: { anthropic: { enabled: true, ...(extra.config ?? {}) } },
    anthropicTransport: fakeTransport(script),
    clock,
  });
}

// ---------------- disabled-by-default parity ----------------

test("registry: no config -> Slice-1 parity (only deterministic fallback)", () => {
  const reg = createRadarIntelligenceRegistry();
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
  const sel = reg.selectProvider({ requiredCapabilities: ["summarize"], now: clockMs });
  assert.equal(sel.error.code, "NO_CAPABLE_PROVIDER");
});

test("registry: anthropic.enabled=false -> still not registered", () => {
  const reg = createRadarIntelligenceRegistry({ config: { anthropic: { enabled: false } }, anthropicTransport: fakeTransport() });
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
});

test("snapshot: disabled anthropic -> providerUnavailable, advisory null, source radar-core (identical to Slice 1)", async () => {
  const gw = createRadarIntelligenceGateway({ registry: createRadarIntelligenceRegistry({ config: { anthropic: { enabled: false } } }), clock, generateRequestId: ids });
  const snap = await buildRadarIntelligenceSnapshot({ deterministic: DET, display: DISPLAY }, { gateway: gw });
  assert.deepEqual(snap.deterministic, DET);
  assert.equal(snap.providerAvailable, false);
  assert.equal(snap.advisoryStatus, "NONE");
  assert.equal(snap.intelligence, null);
  assert.equal(snap.source, "radar-core");
});

// ---------------- full success path ----------------

test("snapshot: enabled anthropic + fake success -> provider advisory, deterministic UNCHANGED", async () => {
  const gw = createRadarIntelligenceGateway({ registry: enabledRegistry({ mode: "success" }), clock, generateRequestId: ids });
  const snap = await buildRadarIntelligenceSnapshot({ deterministic: DET, display: DISPLAY }, { gateway: gw });
  assert.deepEqual(snap.deterministic, DET, "deterministic basis is untouched");
  assert.equal(snap.providerAvailable, true);
  assert.equal(snap.advisoryStatus, "ADVISORY_AVAILABLE");
  assert.equal(snap.intelligence.advisory, true);
  assert.match(snap.intelligence.summary, /follow up soon/i);
  assert.equal(snap.source, "provider");
  // provider result carries no deterministic authority
  assert.equal("priority" in snap.intelligence, false);
  assert.equal(snap.intelligence.provider, "anthropic");
});

// ---------------- fallback matrix: provider failure NEVER breaks RADAR ----------------

for (const [label, script] of [
  ["timeout", { mode: "timeout" }],
  ["429", { mode: "status", status: 429 }],
  ["503", { mode: "status", status: 503 }],
  ["malformed", { mode: "malformed" }],
  ["throw", { mode: "throw" }],
]) {
  test(`fallback: anthropic ${label} -> deterministic RADAR result intact, no secret leak`, async () => {
    const gw = createRadarIntelligenceGateway({
      registry: enabledRegistry(script),
      clock,
      generateRequestId: ids,
      policy: { timeoutMs: 8000, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() },
    });
    const snap = await buildRadarIntelligenceSnapshot({ deterministic: DET, display: DISPLAY }, { gateway: gw });
    assert.deepEqual(snap.deterministic, DET);
    assert.equal(snap.intelligence, null);
    assert.equal(snap.providerAvailable, false);
    assert.ok(!JSON.stringify(snap).includes(FAKE_SECRET));
    // priority / confidence / reasons / recommendedNextAction / qualification all still present
    for (const k of ["priority", "confidence", "reasons", "recommendedNextAction", "qualificationStatus"]) {
      assert.ok(k in snap.deterministic, `deterministic.${k} preserved`);
    }
  });
}

// ---------------- bounded retry ----------------

test("retry: a retryable code retries up to maxRetries then stops (no infinite loop)", async () => {
  const transport = fakeTransport({ mode: () => "status", status: 503 });
  const reg = createProviderRegistry();
  reg.register(deterministicFallbackAdapter);
  reg.register(createAnthropicAdapter({ config: { enabled: true }, transport, clock }));
  const gw = createRadarIntelligenceGateway({
    registry: reg,
    clock,
    generateRequestId: ids,
    policy: { timeoutMs: 8000, maxRetries: 2, retryBaseDelayMs: 0, retryableCodes: new Set(["PROVIDER_UNAVAILABLE"]) },
  });
  const outcome = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: CTX });
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error.code, "PROVIDER_UNAVAILABLE");
  assert.equal(transport.hits, 3, "1 initial + 2 retries");
});

test("retry: a non-retryable code does NOT retry", async () => {
  const transport = fakeTransport({ mode: "status", status: 400 });
  const reg = createProviderRegistry();
  reg.register(deterministicFallbackAdapter);
  reg.register(createAnthropicAdapter({ config: { enabled: true }, transport, clock }));
  const gw = createRadarIntelligenceGateway({
    registry: reg,
    clock,
    generateRequestId: ids,
    policy: { timeoutMs: 8000, maxRetries: 3, retryBaseDelayMs: 0, retryableCodes: new Set(["PROVIDER_UNAVAILABLE"]) },
  });
  await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: CTX });
  assert.equal(transport.hits, 1);
});

// ---------------- circuit breaker ----------------

test("circuit: repeated failures OPEN the provider breaker, which then BLOCKS the transport", async () => {
  const transport = fakeTransport({ mode: "throw" });
  const reg = createProviderRegistry();
  reg.register(deterministicFallbackAdapter);
  reg.register(createAnthropicAdapter({ config: { enabled: true }, transport, clock }));
  const gw = createRadarIntelligenceGateway({
    registry: reg,
    clock,
    generateRequestId: ids,
    circuitConfig: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxProbes: 1 },
    policy: { timeoutMs: 8000, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() },
  });
  const run = () => gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: CTX });

  await run();
  await run();
  await run(); // 3rd failure -> breaker OPEN
  const hitsAfterOpen = transport.hits;
  assert.equal(hitsAfterOpen, 3);

  // breaker OPEN: gateway selection now rejects before dispatch -> deterministic fallback, transport NOT called
  const blocked = await run();
  assert.equal(transport.hits, hitsAfterOpen, "transport was NOT called while the breaker is OPEN");
  assert.equal(blocked.advisory, null);

  // after cooldown, one HALF_OPEN probe is allowed; make it succeed -> CLOSED
  advance(61_000);
  transport.calls.length = 0;
  const probe = fakeTransport({ mode: "success" });
  // swap the transport by re-registering a fresh adapter in a fresh registry
  const reg2 = createProviderRegistry();
  reg2.register(deterministicFallbackAdapter);
  reg2.register(createAnthropicAdapter({ config: { enabled: true }, transport: probe, clock }));
  const gw2 = createRadarIntelligenceGateway({ registry: reg2, clock, generateRequestId: ids });
  const recovered = await gw2.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: CTX });
  assert.equal(recovered.advisory?.advisory, true);
});

// ---------------- registry selection matrix ----------------

test("selection: preferred anthropic chosen when eligible; disabled/unhealthy/missing-capability skipped", () => {
  // enabled + healthy
  const ok = enabledRegistry({ mode: "success" });
  assert.equal(ok.selectProvider({ requiredCapabilities: ["summarize"], preferredProviderId: "anthropic", now: clockMs }).adapter.id, "anthropic");
  // capability the adapter lacks
  assert.equal(ok.selectProvider({ requiredCapabilities: ["generate"], now: clockMs }).ok, false);
  // unhealthy transport -> not selected
  const unhealthy = createRadarIntelligenceRegistry({ config: { anthropic: { enabled: true } }, anthropicTransport: fakeTransport({ health: { reachable: false, degraded: false } }), clock });
  assert.equal(unhealthy.selectProvider({ requiredCapabilities: ["summarize"], now: clockMs }).error.code, "NO_CAPABLE_PROVIDER");
  // duplicate registration rejected
  const dup = enabledRegistry({ mode: "success" });
  assert.equal(dup.register(createAnthropicAdapter({ config: { enabled: true }, transport: fakeTransport(), clock })).ok, false);
});

// ---------------- telemetry ----------------

test("telemetry: a provider-success event carries usage + status but NO prompt / context / prospect name", async () => {
  const gw = createRadarIntelligenceGateway({ registry: enabledRegistry({ mode: "success" }), clock, generateRequestId: ids });
  const outcome = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: CTX });
  const ev = buildTelemetryEvent(outcome, { capability: "summarize", latencyMs: 42 });
  assert.equal(ev.status, "ok");
  assert.equal(ev.provider, "anthropic");
  assert.equal(ev.usage.totalTokens, 30);
  const s = JSON.stringify(ev).toLowerCase();
  assert.ok(!s.includes("boulangerie"));
  assert.ok(!s.includes("evidence"));
  assert.ok(!s.includes("follow up soon"));
  assert.ok(!s.includes(FAKE_SECRET.toLowerCase()));
});

test("telemetry: a provider-failure event carries the error code only", async () => {
  const gw = createRadarIntelligenceGateway({
    registry: enabledRegistry({ mode: "timeout" }),
    clock,
    generateRequestId: ids,
    policy: { timeoutMs: 8000, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() },
  });
  const outcome = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: CTX });
  const ev = buildTelemetryEvent(outcome, { capability: "summarize", latencyMs: 10 });
  assert.equal(ev.status, "error");
  assert.equal(ev.errorCode, "PROVIDER_TIMEOUT");
  assert.equal(ev.usage, null);
});
