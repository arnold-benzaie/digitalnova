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

// ---------------- V2: dual-provider registration ----------------
//
// `loadedConfig()` above (predating OpenAI) never includes an `openai` key
// at all — that is the EXACT fixture shape that forced configured-registry.ts
// to defensively optional-chain `config.openai?.effectiveEnabled` rather
// than assume the field exists. These new tests exercise the field
// deliberately, alongside anthropic, independently.

const OPENAI_FAKE_KEY = "sk-proj-THIS-MUST-NEVER-LEAK";

function openAiConfig({ enabled = true, hasKey = true, model = "gpt-4o-mini" } = {}) {
  const effective = enabled && hasKey;
  return {
    enabledFlag: enabled,
    hasCredential: hasKey,
    effectiveEnabled: effective,
    model,
    apiKey: hasKey ? OPENAI_FAKE_KEY : null,
    maxOutputTokens: 512,
    maxRequestBytes: 24000,
  };
}

function openAiChatCompletionsFetch(script = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (script.reject) throw script.reject;
    const status = script.status ?? 200;
    return {
      status,
      async json() {
        if (script.invalidJson) throw new SyntaxError("bad");
        return script.body ?? { choices: [{ message: { content: JSON.stringify({ summary: "OpenAI advisory." }) } }], usage: { prompt_tokens: 10, completion_tokens: 6 } };
      },
    };
  };
  fn.calls = calls;
  return fn;
}

test("V2: only anthropic key present (no openai field at all, the pre-V2 fixture shape) -> registry unaffected, no crash", async () => {
  const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig(), fetchImpl: fakeFetch(), clock });
  assert.deepEqual(reg.list().map((a) => a.id).sort(), ["anthropic", "deterministic"].sort());
});

test("V2: OpenAI-only enabled (anthropic absent from loadedConfig) -> openai registered, anthropic is not", async () => {
  const ff = openAiChatCompletionsFetch();
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: { openai: openAiConfig() },
    openaiFetchImpl: ff,
    clock,
  });
  assert.deepEqual(reg.list().map((a) => a.id).sort(), ["deterministic", "openai"].sort());
  const snap = await snapWith(reg);
  assert.equal(snap.intelligence.provider, "openai");
  assert.ok(!JSON.stringify(snap).includes(OPENAI_FAKE_KEY));
});

test("V2: both providers enabled+keyed -> both registered independently, each with its OWN fetch/key", async () => {
  const anthropicFetch = fakeFetch({ status: 200 });
  const openaiFetch = openAiChatCompletionsFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: { ...loadedConfig(), openai: openAiConfig() },
    anthropicFetchImpl: anthropicFetch,
    openaiFetchImpl: openaiFetch,
    clock,
  });
  assert.deepEqual(reg.list().map((a) => a.id).sort(), ["anthropic", "deterministic", "openai"].sort());
});

test("V2: both providers disabled -> neither registered, Slice-1 parity, zero fetch calls on either fake", async () => {
  const anthropicFetch = fakeFetch();
  const openaiFetch = openAiChatCompletionsFetch();
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: { anthropic: loadedConfig({ enabled: false }).anthropic, openai: openAiConfig({ enabled: false }) },
    anthropicFetchImpl: anthropicFetch,
    openaiFetchImpl: openaiFetch,
    clock,
  });
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
  await snapWith(reg);
  assert.equal(anthropicFetch.calls.length, 0);
  assert.equal(openaiFetch.calls.length, 0);
});

test("V2: end-to-end fallback at the configured-registry level — Anthropic 503 (eligible), OpenAI 200 -> the router serves the OpenAI advisory", async () => {
  const { createProviderRouter } = await import("./provider-router.ts");
  const { sanitizeProspectContext } = await import("./sanitize-context.ts");
  const anthropicFetch = fakeFetch({ status: 503 });
  const openaiFetch = openAiChatCompletionsFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: { ...loadedConfig(), openai: openAiConfig() },
    anthropicFetchImpl: anthropicFetch,
    openaiFetchImpl: openaiFetch,
    clock,
  });
  const router = createProviderRouter({ registry: reg, clock, timeoutMs: 8000 });
  const outcome = await router.run({
    kind: "summarize",
    requiredCapabilities: ["summarize"],
    context: sanitizeProspectContext({ prospectName: "X", stage: "prospect" }),
  });
  assert.equal(outcome.advisory.provider, "openai");
  assert.equal(outcome.fallbackUsed, true);
  assert.equal(outcome.attemptCount, 2);
  assert.equal(anthropicFetch.calls.length, 1);
  assert.equal(openaiFetch.calls.length, 1);
  assert.ok(!JSON.stringify(outcome).includes(FAKE_KEY));
  assert.ok(!JSON.stringify(outcome).includes(OPENAI_FAKE_KEY));
});

test("V2: end-to-end NON-fallback at the configured-registry level — Anthropic 401 -> OpenAI is never dispatched, even though it's configured", async () => {
  const { createProviderRouter } = await import("./provider-router.ts");
  const { sanitizeProspectContext } = await import("./sanitize-context.ts");
  const anthropicFetch = fakeFetch({ status: 401 });
  const openaiFetch = openAiChatCompletionsFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: { ...loadedConfig(), openai: openAiConfig() },
    anthropicFetchImpl: anthropicFetch,
    openaiFetchImpl: openaiFetch,
    clock,
  });
  const router = createProviderRouter({ registry: reg, clock, timeoutMs: 8000 });
  const outcome = await router.run({
    kind: "summarize",
    requiredCapabilities: ["summarize"],
    context: sanitizeProspectContext({ prospectName: "X", stage: "prospect" }),
  });
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error.code, "PROVIDER_ERROR");
  assert.equal(outcome.error.providerId, "anthropic");
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(openaiFetch.calls.length, 0);
});

// ---------------- BUGFIX: the exact Production gap, reproduced end-to-end ----------------
//
// The prior diagnostic found no test reproducing "Anthropic completely
// UNREGISTERED (RADAR_INTELLIGENCE_ANTHROPIC_ENABLED=false, so
// createConfiguredRadarIntelligenceRegistry never constructs it at all)
// + OpenAI registered" through the REAL createProviderRouter path — the
// two existing "OpenAI-only enabled" tests above only exercise the raw
// gateway directly (snapWith), never the router, which is what
// lib/actions/radar-intelligence.ts -> advisory-core.ts actually uses in
// Production. This test closes that gap: real loadRadarIntelligenceConfig
// shape (anthropic present in the config object but enabled:false, exactly
// like the Production env), real createConfiguredRadarIntelligenceRegistry,
// real createProviderRouter — only the fetch implementations are fakes.
// Zero network, zero real credentials.

test("BUGFIX (exact Production gap): Anthropic disabled (ENABLED=false, never registered) + OpenAI enabled+configured -> the REAL router still serves the OpenAI advisory as fallback", async () => {
  const { createProviderRouter } = await import("./provider-router.ts");
  const { sanitizeProspectContext } = await import("./sanitize-context.ts");
  const anthropicFetch = fakeFetch(); // must NEVER be called -- Anthropic isn't even registered
  const openaiFetch = openAiChatCompletionsFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    // Anthropic present in the loaded config, exactly as
    // loadRadarIntelligenceConfig() would shape it in Production with
    // RADAR_INTELLIGENCE_ANTHROPIC_ENABLED=false -- effectiveEnabled
    // false, so configured-registry.ts's `if (a?.effectiveEnabled...)`
    // gate skips constructing/registering it entirely (NOT a "disabled
    // adapter object" -- genuinely absent from reg.list()).
    loadedConfig: { anthropic: loadedConfig({ enabled: false }).anthropic, openai: openAiConfig() },
    anthropicFetchImpl: anthropicFetch,
    openaiFetchImpl: openaiFetch,
    clock,
  });
  // Confirms the premise: anthropic is genuinely absent, not merely disabled.
  assert.deepEqual(reg.list().map((a) => a.id).sort(), ["deterministic", "openai"].sort());
  assert.equal(reg.has("anthropic"), false);

  const router = createProviderRouter({ registry: reg, clock, timeoutMs: 8000 });
  const outcome = await router.run({
    kind: "summarize",
    requiredCapabilities: ["summarize"],
    context: sanitizeProspectContext({ prospectName: "X", stage: "prospect" }),
  });

  assert.equal(outcome.advisory.provider, "openai");
  assert.equal(outcome.fallbackUsed, true);
  assert.equal(outcome.attemptCount, 1, "the primary was never dispatched to (absent) -- 0 + 1 fallback attempt");
  assert.equal(anthropicFetch.calls.length, 0, "Anthropic's transport must never be reached -- it isn't registered");
  assert.equal(openaiFetch.calls.length, 1);
  assert.ok(!JSON.stringify(outcome).includes(FAKE_KEY));
  assert.ok(!JSON.stringify(outcome).includes(OPENAI_FAKE_KEY));
});

test("BUGFIX (exact Production gap), both disabled: Anthropic disabled + OpenAI ALSO disabled -> the REAL router returns the safe no-provider outcome, zero fetch calls, no crash", async () => {
  const { createProviderRouter } = await import("./provider-router.ts");
  const { sanitizeProspectContext } = await import("./sanitize-context.ts");
  const anthropicFetch = fakeFetch();
  const openaiFetch = openAiChatCompletionsFetch();
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: { anthropic: loadedConfig({ enabled: false }).anthropic, openai: openAiConfig({ enabled: false }) },
    anthropicFetchImpl: anthropicFetch,
    openaiFetchImpl: openaiFetch,
    clock,
  });
  const router = createProviderRouter({ registry: reg, clock, timeoutMs: 8000 });
  const outcome = await router.run({
    kind: "summarize",
    requiredCapabilities: ["summarize"],
    context: sanitizeProspectContext({ prospectName: "X", stage: "prospect" }),
  });
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error, null);
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(anthropicFetch.calls.length, 0);
  assert.equal(openaiFetch.calls.length, 0);
});

// ---------------- RADAR INTELLIGENCE V2.1 Phase E: model overrides ----------------
//
// `deps.modelOverrides` is plain, already-loaded data -- never a DB read
// performed by this function itself (see ConfiguredRegistryDeps's own
// docstring). Re-validated again here via isKnownModelId(): an
// unknown/mismatched/absent override for a provider must never change
// that provider's wire model away from its env-configured value.

test("Phase E: a validated anthropic model override changes the model actually sent on the wire", async () => {
  const ff = fakeFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: loadedConfig({ model: "claude-sonnet-4-5" }),
    fetchImpl: ff,
    clock,
    modelOverrides: { anthropic: "claude-sonnet-5" },
  });
  await snapWith(reg);
  assert.equal(ff.calls.length, 1);
  const sentModel = JSON.parse(ff.calls[0].init.body).model;
  assert.equal(sentModel, "claude-sonnet-5");
});

test("Phase E: an UNKNOWN anthropic model override is ignored -- the env-configured model is still sent on the wire", async () => {
  const ff = fakeFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: loadedConfig({ model: "claude-sonnet-4-5" }),
    fetchImpl: ff,
    clock,
    modelOverrides: { anthropic: "claude-opus-9000-does-not-exist" },
  });
  await snapWith(reg);
  const sentModel = JSON.parse(ff.calls[0].init.body).model;
  assert.equal(sentModel, "claude-sonnet-4-5");
});

test("Phase E: an OpenAI model id supplied as the anthropic override (provider/model mismatch) is ignored", async () => {
  const ff = fakeFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: loadedConfig({ model: "claude-sonnet-4-5" }),
    fetchImpl: ff,
    clock,
    modelOverrides: { anthropic: "gpt-4o-mini" },
  });
  await snapWith(reg);
  const sentModel = JSON.parse(ff.calls[0].init.body).model;
  assert.equal(sentModel, "claude-sonnet-4-5");
});

test("Phase E: no modelOverrides at all (undefined) -> byte-identical to pre-Phase-E behavior", async () => {
  const ff = fakeFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({ loadedConfig: loadedConfig({ model: "claude-sonnet-4-5" }), fetchImpl: ff, clock });
  await snapWith(reg);
  const sentModel = JSON.parse(ff.calls[0].init.body).model;
  assert.equal(sentModel, "claude-sonnet-4-5");
});

test("Phase E: an empty modelOverrides object -> byte-identical to pre-Phase-E behavior", async () => {
  const ff = fakeFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: loadedConfig({ model: "claude-sonnet-4-5" }),
    fetchImpl: ff,
    clock,
    modelOverrides: {},
  });
  await snapWith(reg);
  const sentModel = JSON.parse(ff.calls[0].init.body).model;
  assert.equal(sentModel, "claude-sonnet-4-5");
});

test("Phase E: a validated openai model override changes the model sent on the wire, independent of anthropic", async () => {
  const { createProviderRouter } = await import("./provider-router.ts");
  const { sanitizeProspectContext } = await import("./sanitize-context.ts");
  const anthropicFetch = fakeFetch({ status: 200 });
  const openaiFetch = openAiChatCompletionsFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: { anthropic: loadedConfig({ model: "claude-sonnet-4-5" }).anthropic, openai: openAiConfig({ model: "gpt-4o-mini" }) },
    anthropicFetchImpl: anthropicFetch,
    openaiFetchImpl: openaiFetch,
    clock,
    modelOverrides: { openai: "gpt-5.6-terra" },
  });
  const router = createProviderRouter({ registry: reg, policy: { primary: "openai", fallbackOrder: [], fallbackEnabled: false }, clock, timeoutMs: 8000 });
  await router.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: sanitizeProspectContext({ prospectName: "X", stage: "prospect" }) });
  assert.equal(anthropicFetch.calls.length, 0, "anthropic must be untouched by an openai-only override");
  assert.equal(openaiFetch.calls.length, 1);
  const sentModel = JSON.parse(openaiFetch.calls[0].init.body).model;
  assert.equal(sentModel, "gpt-5.6-terra");
});

test("Phase E: a validated override for a DISABLED/unregistered provider has no effect (that provider is still simply absent)", async () => {
  const ff = fakeFetch({ status: 200 });
  const reg = createConfiguredRadarIntelligenceRegistry({
    loadedConfig: loadedConfig({ enabled: false }),
    fetchImpl: ff,
    clock,
    modelOverrides: { anthropic: "claude-sonnet-5" },
  });
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
  assert.equal(ff.calls.length, 0);
});
