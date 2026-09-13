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
// advisory-core.ts imports provider-policy-store.ts (RADAR INTELLIGENCE
// V2.1 Phase B), which imports @/db at module scope. @/db's real module
// throws synchronously at import time when DATABASE_URL isn't set (see
// lib/rbac/require-staff-member.test.mjs for the same pattern). Almost
// every test below supplies its own `deps.loadProviderPolicy` (see
// deps() below), so the real store's function is never actually CALLED
// for them -- this fake only needs to exist so the static import
// doesn't throw. The "Phase B: real DB-backed store integration"
// section further down DOES exercise the real store against this same
// fake, via `dbPolicyRowState` (a mutable, per-test-controllable select
// result/error), proving the store <-> advisory-core wiring end-to-end.
let dbPolicyRowState = { rows: [] };
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          if (dbPolicyRowState.error) return Promise.reject(dbPolicyRowState.error);
          return Promise.resolve(dbPolicyRowState.rows ?? []);
        },
      }),
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { produceRadarAdvisory } = await import("./advisory-core.ts");
const { createRadarIntelligenceRegistry } = await import("./adapters/index.ts");
const { DEFAULT_PROVIDER_POLICY } = await import("./provider-policy.ts");

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
    ...(overrides.locale ? { locale: overrides.locale } : {}),
    // RADAR INTELLIGENCE V2.1 Phase B: always inject a `loadProviderPolicy`
    // fake (defaulting to DEFAULT_PROVIDER_POLICY, matching today's exact
    // Production routing) so no test ever touches the real DB-backed store.
    loadProviderPolicy: async () => overrides.providerPolicy ?? DEFAULT_PROVIDER_POLICY,
    // RADAR INTELLIGENCE V2.1 Phase G2: always inject a no-op
    // `recordProviderAttempt` fake by default (same convention as
    // loadProviderPolicy above) so no pre-G2 test touches the real
    // DB-backed telemetry store (whose own internal fail-safe swallow
    // would otherwise emit a stray console.warn on every single
    // attemptCount>=1 test in this file, polluting withCapturedWarn()'s
    // captured calls exactly like the bug already found and fixed once
    // in lib/actions/radar-intelligence.test.mjs). Phase G2's own tests
    // override this to observe what would have been recorded.
    recordProviderAttempt: overrides.recordProviderAttempt ?? (async () => {}),
    ...(overrides.actorUserId !== undefined ? { actorUserId: overrides.actorUserId } : {}),
    ...(overrides.generateAiRequestId ? { generateAiRequestId: overrides.generateAiRequestId } : {}),
    // RADAR INTELLIGENCE V2.1 Phase G4B-2: always inject an "enabled,
    // unlimited" quota policy and an "always admit" gate by default
    // (same convention as loadProviderPolicy/recordProviderAttempt
    // above) so every PRE-G4B-2 test in this file keeps its exact
    // byte-identical behavior -- no test above this section touches the
    // real quota policy/counter stores. Dedicated G4B-2 tests override
    // these to exercise disabled/limit/counter-failure paths.
    //
    // G4B-2 correction: loadQuotaPolicy now returns the status-aware
    // { status, policy } shape (quota-policy-store.ts::RadarAiQuotaPolicyReadResult).
    // `overrides.quotaPolicy` remains the simple way most tests override
    // the POLICY VALUES (wrapped here as status "ok"); a dedicated
    // handful of G4B-2-correction tests override `loadQuotaPolicy`
    // directly to exercise "missing"/"error".
    loadQuotaPolicy:
      overrides.loadQuotaPolicy ??
      (async () => ({ status: "ok", policy: overrides.quotaPolicy ?? { enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } })),
    readQuotaCounter: overrides.readQuotaCounter ?? (async () => null),
    admitRequestUnit: overrides.admitRequestUnit ?? (async () => true),
    incrementQuotaTokens: overrides.incrementQuotaTokens ?? (async () => ({ key: "global:test", requestCount: 0, tokenCount: 0, windowStart: new Date(0) })),
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

test("fake provider 200 -> ok; deterministic basis VERBATIM; provider identity ONLY inside providerMeta (SYSTEM_ADMIN-gated by the action, not this core); NO secret / usage / requestId", async () => {
  const t = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.equal(t.hits, 1, "exactly one gateway request");
  assert.equal(r.status, "ok");
  assert.match(r.summary, /proposal-stage prospect/);
  assert.equal(r.suggestedNextAction, "Send a recap email");
  assert.deepEqual(r.risks, []);
  assert.equal(r.reasoning, null);
  assert.equal(typeof r.generatedAt, "string");
  assert.deepEqual(r.deterministic, {
    priority: OPPORTUNITY.priority,
    confidence: OPPORTUNITY.confidence,
    recommendedNextAction: OPPORTUNITY.recommendedNextAction,
  });
  // provider identity is present, but ONLY inside providerMeta — the
  // action (lib/actions/radar-intelligence.ts), not this core, enforces
  // the SYSTEM_ADMIN-only exposure boundary.
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(typeof r.providerMeta.model, "string");
  const rest = { ...r };
  delete rest.providerMeta;
  assert.equal(/anthropic|claude/i.test(JSON.stringify(rest)), false, "no provider name outside providerMeta");
  const s = JSON.stringify(r);
  assert.equal(s.includes("requestId"), false);
  assert.equal(s.includes("usage"), false);
  assert.equal("errorCode" in r, false);
});

test("success result has EXACTLY the safe keys", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(fakeTransport({ status: 200 })) }));
  assert.deepEqual(
    Object.keys(r).sort(),
    ["deterministic", "generatedAt", "providerMeta", "reasoning", "risks", "status", "suggestedNextAction", "summary"].sort(),
  );
  assert.deepEqual(Object.keys(r.deterministic).sort(), ["confidence", "priority", "recommendedNextAction"].sort());
  assert.deepEqual(Object.keys(r.providerMeta).sort(), ["fallbackUsed", "model", "provider"].sort());
  assert.equal(r.providerMeta.fallbackUsed, false, "the primary succeeded — no fallback occurred");
});

// ---------------- V2: end-to-end multi-provider fallback ----------------
//
// The full produceRadarAdvisory -> createProviderRouter -> dual-adapter
// flow, with BOTH a real Anthropic adapter and a real OpenAI adapter
// registered (via createRadarIntelligenceRegistry — not the router unit
// directly), each backed by its own fake transport. Proves the router is
// correctly wired all the way through advisory-core, including
// providerMeta.fallbackUsed on a genuine end-to-end fallback success.

const dualRegistry = (anthropicTransport, openaiTransport) => () =>
  createRadarIntelligenceRegistry({
    config: { anthropic: { enabled: true }, openai: { enabled: true } },
    anthropicTransport,
    openaiTransport,
    clock,
  });

test("V2 e2e: Anthropic succeeds -> OpenAI is never dispatched, providerMeta.fallbackUsed is false", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(r.providerMeta.fallbackUsed, false);
  assert.equal(anthropicT.hits, 1);
  assert.equal(openaiHits, 0);
});

test("V2 e2e: Anthropic returns 503 (eligible) -> OpenAI is dispatched and its advisory is returned with providerMeta.fallbackUsed true", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  let openaiHits = 0;
  const openaiT = {
    async generate() {
      openaiHits += 1;
      return { body: { summary: "OpenAI saved the day.", suggestedNextAction: "Call now" }, status: 200 };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "ok");
  assert.match(r.summary, /OpenAI saved the day/);
  assert.equal(r.providerMeta.provider, "openai");
  assert.equal(r.providerMeta.fallbackUsed, true);
  assert.equal(anthropicT.hits, 1);
  assert.equal(openaiHits, 1);
  // deterministic RADAR is still authoritative, unaffected by which
  // provider ultimately served the advisory
  assert.deepEqual(r.deterministic, { priority: OPPORTUNITY.priority, confidence: OPPORTUNITY.confidence, recommendedNextAction: OPPORTUNITY.recommendedNextAction });
});

test("V2 e2e: Anthropic returns 401 -> OpenAI is NEVER dispatched even though it is enabled+healthy; the auth mistake stays visible", async () => {
  const anthropicT = fakeTransport({ status: 401 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "error");
  assert.equal(r.diagnostic, "PROVIDER_4XX");
  assert.equal(r.httpStatus, 401);
  assert.equal("providerMeta" in r, false);
  assert.equal(anthropicT.hits, 1);
  assert.equal(openaiHits, 0, "OpenAI must never be called after a 401 — this would hide a real auth/config mistake");
});

test("V2 e2e: both Anthropic and OpenAI fail -> existing safe failure semantics, the fallback's own error surfaces", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = { async generate() { return { body: null, status: 500 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "unavailable");
  assert.equal(r.diagnostic, "PROVIDER_5XX");
  assert.equal("providerMeta" in r, false);
});

test("V2 e2e: a successful fallback logs exactly one FALLBACK_SUCCEEDED event with provider/fallbackUsed, no secret", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = { async generate() { return { body: { summary: "ok" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  // withCapturedWarn is a hoisted function declaration further below in
  // this same module — safe to call from here.
  const calls = await withCapturedWarn(() => produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) })));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "FALLBACK_SUCCEEDED", provider: "openai", fallbackUsed: true, status: "ok" });
});

// ---------------- V2: safe OpenAI provider-error metadata reaches the advisory_core log ----------------

test("V2 e2e: Anthropic unavailable -> OpenAI fallback ALSO fails with a realistic 400 -> the log carries safe providerErrorType/Code/Param, never error.message", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = {
    async generate() {
      return { body: null, status: 400, providerErrorType: "invalid_request_error", providerErrorCode: "unsupported_parameter", providerErrorParam: "max_tokens" };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  });
  assert.equal(result.status, "error");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], {
    source: "advisory_core",
    code: "PROVIDER_ERROR",
    failureClass: "PROVIDER_4XX",
    httpStatus: 400,
    provider: "openai",
    fallbackUsed: true,
    attempt: 2,
    providerErrorType: "invalid_request_error",
    providerErrorCode: "unsupported_parameter",
    providerErrorParam: "max_tokens",
    status: "error",
  });
});

test("V2 e2e: an unrecognized providerErrorType/Code from OpenAI's transport never reaches the log verbatim", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = {
    async generate() {
      return { body: null, status: 400, providerErrorType: "some_future_type", providerErrorCode: "some_future_code", providerErrorParam: "max_tokens" };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  const calls = await withCapturedWarn(() => produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) })));
  assert.equal("providerErrorType" in calls[0][1], false);
  assert.equal("providerErrorCode" in calls[0][1], false);
  assert.equal(calls[0][1].providerErrorParam, "max_tokens", "param independently validated and kept even when type/code are dropped");
  const s = JSON.stringify(calls[0][1]);
  assert.equal(s.includes("some_future"), false);
});

// ---------------- V2.1 Phase A: Provider Policy resolver integration ----------------
//
// produceRadarAdvisory now resolves its routing via
// resolveProviderPolicy(DEFAULT_PROVIDER_POLICY, ...) instead of a
// hardcoded {primary,fallback} pair. These tests prove that integration
// end-to-end WITHOUT changing any externally observable behavior: the
// default policy must reproduce exactly today's Anthropic-primary/
// OpenAI-fallback routing, and the new deps.providerPolicy test seam
// must correctly override it.

test("V2.1: default policy end-to-end -- Anthropic succeeds, OpenAI never dispatched (byte-identical to pre-Phase-A behavior)", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(r.providerMeta.fallbackUsed, false);
  assert.equal(anthropicT.hits, 1);
  assert.equal(openaiHits, 0);
});

test("V2.1: default policy end-to-end -- Anthropic fails eligible, OpenAI serves as fallback (byte-identical to pre-Phase-A behavior)", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = { async generate() { return { body: { summary: "fallback via resolver" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "ok");
  assert.match(r.summary, /fallback via resolver/);
  assert.equal(r.providerMeta.provider, "openai");
  assert.equal(r.providerMeta.fallbackUsed, true);
});

test("V2.1: a custom providerPolicy override (test seam) is honored -- e.g. fallbackEnabled:false suppresses the fallback entirely", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({
      createRegistry: dualRegistry(anthropicT, openaiT),
      providerPolicy: {
        mode: "AUTO",
        defaultProvider: "anthropic",
        fallbackOrder: ["anthropic", "openai"],
        enabledProviders: ["anthropic", "openai"],
        userSelectableProviders: [],
        allowUserSelection: false,
        fallbackEnabled: false,
      },
    }),
  );
  assert.equal(r.status, "unavailable");
  assert.equal(openaiHits, 0, "fallbackEnabled:false must suppress the fallback attempt entirely");
});

test("V2.1: a custom providerPolicy can globally disable a provider even though it is registered/configured (enabledProviders excludes it)", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run -- disabled by policy" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({
      createRegistry: dualRegistry(anthropicT, openaiT),
      providerPolicy: {
        mode: "AUTO",
        defaultProvider: "anthropic",
        fallbackOrder: ["anthropic", "openai"],
        enabledProviders: ["anthropic"], // openai is registered/configured but NOT owner-enabled
        userSelectableProviders: [],
        allowUserSelection: false,
        fallbackEnabled: true,
      },
    }),
  );
  assert.equal(r.status, "unavailable", "openai is registered but policy-disabled -- must never be attempted");
  assert.equal(openaiHits, 0);
});

test("V2.1: zero-provider invariant reproduced through the resolver -- both absent, deterministic-safe, no crash, no providerMeta", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps());
  assert.equal(r.status, "unavailable");
  assert.equal("providerMeta" in r, false);
  assert.equal("diagnostic" in r, false, "the resolver's no-provider-available case is not a failure to distinguish");
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

for (const [label, script, expectedStatus, expectedClass, expectedHttpStatus] of [
  ["HTTP 400", { status: 400 }, "error", "PROVIDER_4XX", 400],
  ["HTTP 401", { status: 401 }, "error", "PROVIDER_4XX", 401],
  ["HTTP 403", { status: 403 }, "error", "PROVIDER_4XX", 403],
  ["HTTP 429", { status: 429 }, "rate_limited", "PROVIDER_4XX", 429],
  ["HTTP 500", { status: 500 }, "error", "PROVIDER_5XX", 500],
  ["HTTP 502", { status: 502 }, "unavailable", "PROVIDER_5XX", 502],
  ["HTTP 503", { status: 503 }, "unavailable", "PROVIDER_5XX", 503],
  ["HTTP 504", { status: 504 }, "unavailable", "PROVIDER_5XX", 504],
  ["AbortError (timeout)", { reject: Object.assign(new Error("x"), { name: "AbortError" }) }, "timeout", "PROVIDER_TIMEOUT", undefined],
  ["network fault", { reject: NET_ERR }, "error", "PROVIDER_NETWORK", undefined],
  ["invalid JSON on 200", { reject: JSON_ERR }, "error", "PROVIDER_PARSE", undefined],
  ["unexpected 200 body shape", { status: 200, body: { nonsense: true, note: "no summary here" } }, "error", "PROVIDER_PARSE", undefined],
]) {
  test(`diagnostic: ${label} -> status ${expectedStatus}, diagnostic ${expectedClass}, httpStatus ${expectedHttpStatus}`, async () => {
    const t = fakeTransport(script);
    const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
    assert.equal(t.hits, 1, "exactly one provider attempt");
    assert.equal(r.status, expectedStatus);
    assert.equal(r.diagnostic, expectedClass);
    assert.equal(["PROVIDER_4XX", "PROVIDER_5XX", "PROVIDER_TIMEOUT", "PROVIDER_NETWORK", "PROVIDER_PARSE", "PROVIDER_UNKNOWN"].includes(r.diagnostic), true);
    assert.equal(r.httpStatus, expectedHttpStatus);
    if (expectedHttpStatus === undefined) {
      assert.equal("httpStatus" in r, false, "no fabricated httpStatus for a non-HTTP failure");
    }
    const s = JSON.stringify(r);
    assert.equal(s.includes(FAKE_KEY), false, "no api key");
    assert.equal(s.includes("sk-ant-"), false);
    assert.equal(/x-api-key|authorization|bearer/i.test(s), false, "no auth header name/value");
    // Strip the two INTENTIONAL, validated numeric fields (the coarse
    // class suffix and the exact httpStatus, if present) before checking
    // that no OTHER raw 3-digit HTTP-looking number snuck in anywhere.
    const stripped = s.replace(/PROVIDER_[45]XX/g, "").replace(/"httpStatus":\d+/, "");
    assert.equal(/\b(4\d\d|5\d\d)\b/.test(stripped), false, "no raw HTTP status number outside the validated httpStatus field");
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

test("the deps bag has no BUSINESS-STATE mutation capability — only loaders, a registry factory, (Phase G2) an isolated telemetry observer, and (Phase G4B-2) the AI quota gate", async () => {
  // RADAR INTELLIGENCE V2.1 Phase G2: this test's own name is deliberately
  // narrowed from "no mutation capability" to "no BUSINESS-STATE mutation
  // capability" -- a conscious, reviewed contract change. recordProviderAttempt
  // IS a write capability, but it is a narrowly-scoped, best-effort,
  // fail-safe TELEMETRY write (provider-attempt-telemetry-store.ts) that
  // can never throw, never influences routing/fallback, and has no path
  // to any CRM/RADAR/scoring/assignment table. actorUserId is plain string
  // data (never a function); generateAiRequestId returns an opaque
  // correlation string with no side effect of its own. The invariant this
  // test still enforces: nothing in this bag can reach deterministic
  // scoring, CRM, assignment, or queue state.
  //
  // RADAR INTELLIGENCE V2.1 Phase G4B-2 adds four more: loadQuotaPolicy
  // (read-only), readQuotaCounter (read-only), admitRequestUnit (a real
  // write -- the AI quota counter -- but, like recordProviderAttempt,
  // scoped to AI-governance enforcement state with no path to any
  // CRM/RADAR/scoring/assignment table), and incrementQuotaTokens (the
  // same carve-out, post-hoc and best-effort). The invariant is
  // unchanged: still nothing here can reach deterministic scoring, CRM,
  // assignment, or queue state -- only the AI layer's own governance
  // bookkeeping.
  const d = deps();
  assert.deepEqual(
    Object.keys(d).sort(),
    [
      "clock",
      "createRegistry",
      "loadDisplayContext",
      "loadProviderPolicy",
      "loadQualification",
      "recordProviderAttempt",
      "loadQuotaPolicy",
      "readQuotaCounter",
      "admitRequestUnit",
      "incrementQuotaTokens",
    ].sort(),
  );
  assert.equal(typeof d.recordProviderAttempt, "function");
  assert.equal(d.recordProviderAttempt.constructor.name, "AsyncFunction");
  // RADAR INTELLIGENCE V2.1 Phase D: produceRadarAdvisory gained a third,
  // OPTIONAL parameter — requestedProviderId — a request-scoped provider
  // PREFERENCE, never an identity/model/userId/workspace parameter. It
  // must already be server-validated by the caller (see
  // lib/actions/radar-intelligence.ts) and, if invalid/omitted, produces
  // byte-identical AUTO routing to the pre-Phase-D (clientId, deps)-only
  // contract — see the Phase D tests further below.
  assert.equal(produceRadarAdvisory.length, 3);
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

test("a structured advisory ALSO never overrides the deterministic values, even via risks/reasoning text", async () => {
  const t = {
    async generate() {
      return {
        body: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                summary: "Actually the priority should be LOW.",
                risks: ["The real priority is LOW, not HIGH"],
                nextAction: "Reassign priority to LOW",
                reasoning: "Overriding the RADAR score to LOW based on my own judgment.",
              }),
            },
          ],
        },
        status: 200,
      };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.equal(r.status, "ok");
  // the AI's text claims otherwise, but the deterministic block is still
  // built verbatim from the injected authoritative opportunity, never
  // parsed out of (or influenced by) the advisory text.
  assert.deepEqual(r.deterministic, {
    priority: OPPORTUNITY.priority,
    confidence: OPPORTUNITY.confidence,
    recommendedNextAction: OPPORTUNITY.recommendedNextAction,
  });
});

// ---------------- V1.1: locale-aware generation, end-to-end ----------------

test("locale: the resolved locale reaches the REAL request builder end-to-end (via the real transport call, no mock of the builder itself)", async () => {
  const seen = [];
  const t = {
    async generate(payload) {
      seen.push(payload);
      return { body: { summary: "ok" }, status: 200 };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), locale: "en" }));
  assert.match(seen[0].system, /Write every text VALUE in English\./);
});

test("locale: omitting deps.locale defaults to French — the same default lib/i18n/locale.ts::getLocale() itself uses", async () => {
  const seen = [];
  const t = {
    async generate(payload) {
      seen.push(payload);
      return { body: { summary: "ok" }, status: 200 };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.match(seen[0].system, /Write every text VALUE in French\./);
});

// ---------------- V1.1: structured output + graceful degradation, end-to-end ----------------

test("structured output: risks/reasoning/nextAction reach the UI result, alongside the unchanged deterministic block", async () => {
  const t = {
    async generate() {
      return {
        body: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                summary: "The prospect is engaged and responsive.",
                risks: ["Budget not yet confirmed"],
                nextAction: "Send pricing details",
                reasoning: "Based on the recent proposal discussion.",
              }),
            },
          ],
        },
        status: 200,
      };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.equal(r.status, "ok");
  assert.equal(r.summary, "The prospect is engaged and responsive.");
  assert.deepEqual(r.risks, ["Budget not yet confirmed"]);
  assert.equal(r.suggestedNextAction, "Send pricing details");
  assert.equal(r.reasoning, "Based on the recent proposal discussion.");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(typeof r.providerMeta.model, "string");
});

test("graceful degradation: malformed (non-JSON) model output still yields status 'ok' with a plain summary — advisory rendering never breaks", async () => {
  const t = {
    async generate() {
      return { body: { content: [{ type: "text", text: "Here is a plain-language advisory with no JSON at all." }] }, status: 200 };
    },
    describeHealth: () => ({ reachable: true, degraded: false }),
  };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.equal(r.status, "ok");
  assert.match(r.summary, /plain-language advisory/);
  assert.deepEqual(r.risks, []);
  assert.equal(r.reasoning, null);
  assert.equal(r.suggestedNextAction, null);
  // deterministic RADAR is completely unaffected by the degraded path
  assert.deepEqual(r.deterministic, {
    priority: OPPORTUNITY.priority,
    confidence: OPPORTUNITY.confidence,
    recommendedNextAction: OPPORTUNITY.recommendedNextAction,
  });
});

// ---------------- V1.1: zero-provider invariant ----------------

test("zero-provider invariant: with no configured/enabled provider, the deterministic basis is STILL fully derivable from the injected authoritative loader alone", async () => {
  // deps() with no createRegistry override -> the plain deterministic-only
  // registry (equivalent to RADAR_INTELLIGENCE_ANTHROPIC_ENABLED=false).
  const qualification = await deps().loadQualification(CLIENT);
  assert.equal(qualification.qualificationStatus, "QUALIFIED");
  assert.equal(qualification.opportunity.priority, "HIGH");
  const r = await produceRadarAdvisory(CLIENT, deps());
  assert.equal(r.status, "unavailable");
  assert.equal("risks" in r, false);
  assert.equal("reasoning" in r, false);
  assert.equal("providerMeta" in r, false);
});

// ---------------- server observability: safe, secret-free logging ----------------
//
// Every log line goes through logRadarIntelligenceEvent (observability.ts),
// which is proved secret-free in its own test file. Here we prove WHICH
// branch logs WHAT: distinguishable codes for every diagnostic-blind path,
// and the coarse class only for a genuine provider failure. Zero network.

async function withCapturedWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => {
    calls.push(args);
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

test("observability: an invalid clientId logs INVALID_CLIENT_ID and nothing else", async () => {
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory("not-a-uuid", deps());
  });
  assert.deepEqual(result, { status: "error" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[RADAR_INTELLIGENCE]");
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "INVALID_CLIENT_ID", status: "error" });
});

test("observability: loadQualification throwing logs PRE_GATEWAY_LOADER_FAILURE (user-facing result unchanged)", async () => {
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(CLIENT, {
      loadQualification: async () => {
        throw new Error(`db unreachable ${FAKE_KEY}`);
      },
      loadDisplayContext: async () => DISPLAY,
      createRegistry: () => createRadarIntelligenceRegistry({}),
      clock,
    });
  });
  assert.deepEqual(result, { status: "error" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "PRE_GATEWAY_LOADER_FAILURE", status: "error" });
});

test("observability: loadDisplayContext throwing ALSO logs PRE_GATEWAY_LOADER_FAILURE", async () => {
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(CLIENT, {
      loadQualification: async () => QUALIFIED,
      loadDisplayContext: async () => {
        throw new Error("db unreachable");
      },
      createRegistry: () => createRadarIntelligenceRegistry({}),
      clock,
    });
  });
  assert.deepEqual(result, { status: "error" });
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "PRE_GATEWAY_LOADER_FAILURE", status: "error" });
});

test("observability: a null display context logs the DISTINCT code DISPLAY_CONTEXT_NOT_FOUND", async () => {
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(CLIENT, deps({ display: null }));
  });
  assert.deepEqual(result, { status: "error" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "DISPLAY_CONTEXT_NOT_FOUND", status: "error" });
});

test("observability: a synchronous registry/gateway throw logs REGISTRY_GATEWAY_THROW, no raw exception text", async () => {
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(
      CLIENT,
      deps({
        createRegistry: () => {
          throw new Error(`registry construction failed ${FAKE_KEY}`);
        },
      }),
    );
  });
  assert.deepEqual(result, { status: "error" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "REGISTRY_GATEWAY_THROW", status: "error" });
});

test("observability: a provider HTTP 4xx failure logs code + failureClass + httpStatus + status ONLY", async () => {
  const t = fakeTransport({ status: 400 });
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  });
  assert.deepEqual(result, { status: "error", diagnostic: "PROVIDER_4XX", httpStatus: 400 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], {
    source: "advisory_core",
    code: "PROVIDER_ERROR",
    failureClass: "PROVIDER_4XX",
    httpStatus: 400,
    provider: "anthropic",
    status: "error",
  });
});

test("observability: a provider failure with NO genuine HTTP response (network fault) logs no httpStatus", async () => {
  const t = fakeTransport({ reject: Object.assign(new Error(`net ${FAKE_KEY}`), { name: "TransportNetworkError" }) });
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  });
  assert.deepEqual(result, { status: "error", diagnostic: "PROVIDER_NETWORK" });
  assert.equal("httpStatus" in result, false);
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "PROVIDER_ERROR", failureClass: "PROVIDER_NETWORK", provider: "anthropic", status: "error" });
  assert.equal("httpStatus" in calls[0][1], false);
});

test("observability: a network fault logs PROVIDER_NETWORK as the class, PROVIDER_ERROR as the code", async () => {
  const t = fakeTransport({ reject: Object.assign(new Error(`net ${FAKE_KEY}`), { name: "TransportNetworkError" }) });
  let result;
  const calls = await withCapturedWarn(async () => {
    result = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  });
  assert.deepEqual(result, { status: "error", diagnostic: "PROVIDER_NETWORK" });
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "PROVIDER_ERROR", failureClass: "PROVIDER_NETWORK", provider: "anthropic", status: "error" });
});

test("observability: the designed no-provider state (no adapter configured) logs NOTHING — it is not a failure to distinguish", async () => {
  // The gateway collapses NO_CAPABLE_PROVIDER to deterministicOutcome()
  // (error: null) precisely BECAUSE it is the ubiquitous, non-error
  // "AI not configured" state — advisory-core's `if (outcome.error)`
  // guard correctly treats it the same as a success: no log noise.
  const calls = await withCapturedWarn(() => produceRadarAdvisory(CLIENT, deps()));
  assert.equal(calls.length, 0);
});

test("observability: a successful advisory logs nothing", async () => {
  const calls = await withCapturedWarn(() =>
    produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(fakeTransport({ status: 200 })) })),
  );
  assert.equal(calls.length, 0);
});

test("observability: not_applicable (unqualified prospect) logs nothing", async () => {
  const calls = await withCapturedWarn(() =>
    produceRadarAdvisory(
      CLIENT,
      deps({ qualification: { qualificationStatus: "INSUFFICIENT_DATA", eligibility: { contactable: true }, opportunity: null } }),
    ),
  );
  assert.equal(calls.length, 0);
});

test("observability: no log line, across every failure path above, ever contains the api key, the clientId, the prospect name, or a UUID", async () => {
  const scenarios = [
    () => produceRadarAdvisory("not-a-uuid", deps()),
    () => produceRadarAdvisory(CLIENT, deps({ display: null })),
    () =>
      produceRadarAdvisory(
        CLIENT,
        deps({
          createRegistry: () => {
            throw new Error(`boom ${FAKE_KEY}`);
          },
        }),
      ),
    () =>
      produceRadarAdvisory(
        CLIENT,
        deps({ createRegistry: enabledRegistry(fakeTransport({ reject: Object.assign(new Error(`x ${FAKE_KEY}`), { name: "TransportNetworkError" }) })) }),
      ),
    () => produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(fakeTransport({ status: 401 })) })),
  ];
  const allCalls = [];
  for (const scenario of scenarios) {
    const calls = await withCapturedWarn(scenario);
    allCalls.push(...calls);
  }
  const s = JSON.stringify(allCalls);
  assert.equal(s.includes(FAKE_KEY), false, "api key leaked into a log line");
  assert.equal(s.includes(CLIENT), false, "clientId leaked into a log line");
  assert.equal(s.includes(DISPLAY.name), false, "prospect name leaked into a log line");
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s), false, "a UUID-shaped string is in a log line");
  assert.equal(/x-api-key|authorization|bearer|sk-ant-/i.test(s), false, "an auth header name/value is in a log line");
  // every log line carries only the allowlisted keys
  for (const call of allCalls) {
    assert.deepEqual(
      Object.keys(call[1]).sort(),
      Object.keys(call[1])
        .filter((k) => ["source", "code", "failureClass", "httpStatus", "provider", "fallbackUsed", "attempt", "status"].includes(k))
        .sort(),
    );
  }
  // the one scenario with a genuine HTTP response (401) logs a validated httpStatus
  const withHttpStatus = allCalls.filter((c) => "httpStatus" in c[1]);
  assert.equal(withHttpStatus.length, 1);
  assert.equal(withHttpStatus[0][1].httpStatus, 401);
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase B: real DB-backed store integration
//
// Mandatory test matrix (mission Step 24, 7 numbered scenarios). Unlike
// every test above (which injects `deps.loadProviderPolicy` directly),
// these tests deliberately OMIT it so produceRadarAdvisory falls through
// to its real default — provider-policy-store.ts::loadProviderPolicy —
// against the shared `fakeDb` above, proving the store <-> resolver
// <-> router wiring end-to-end without ever touching a live database.
// =====================================================================

function depsRealStore(overrides = {}) {
  const d = deps(overrides);
  delete d.loadProviderPolicy; // force advisory-core's own real-store default
  return d;
}

function dbRow(overrides = {}) {
  return {
    id: "global",
    mode: "AUTO",
    defaultProvider: "anthropic",
    fallbackOrder: ["anthropic", "openai"],
    enabledProviders: ["anthropic", "openai"],
    selectableProviders: [],
    allowUserSelection: false,
    fallbackEnabled: true,
    updatedByStaffMemberId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test.beforeEach(() => {
  dbPolicyRowState = { rows: [] };
});

// ---- 1: empty table (no row) -> DEFAULT_PROVIDER_POLICY, today's exact routing ----

test("Phase B #1: no policy row in the DB -> default AUTO routing (Anthropic primary, OpenAI fallback) via the REAL store", async () => {
  dbPolicyRowState = { rows: [] };
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, depsRealStore({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(openaiHits, 0, "empty policy table must not change Production routing at all");
});

// ---- 2: DB unavailable, Anthropic configured -> default still works ----

test("Phase B #2: DB read throws -> loadProviderPolicy() falls back to DEFAULT_PROVIDER_POLICY, advisory still succeeds (no crash)", async () => {
  dbPolicyRowState = { error: new Error("connection refused") };
  const anthropicT = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, depsRealStore({ createRegistry: enabledRegistry(anthropicT) }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
});

// ---- 3: valid stored policy, OpenAI-first -> resolver sends OpenAI first ----

test("Phase B #3: a valid stored policy with OpenAI as defaultProvider -> OpenAI is dispatched first, Anthropic only as fallback", async () => {
  dbPolicyRowState = { rows: [dbRow({ defaultProvider: "openai", fallbackOrder: ["openai", "anthropic"] })] };
  const anthropicT = { async generate() { throw new Error("must not be primary"); }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const openaiT = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, depsRealStore({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "openai");
  assert.equal(r.providerMeta.fallbackUsed, false);
});

// ---- 4: fallbackEnabled=false in the stored policy -> no cross-provider fallback ----

test("Phase B #4: a stored policy with fallbackEnabled=false -> Anthropic failure never falls back to OpenAI", async () => {
  dbPolicyRowState = { rows: [dbRow({ fallbackEnabled: false })] };
  const anthropicT = fakeTransport({ status: 503 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, depsRealStore({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "unavailable");
  assert.equal(openaiHits, 0);
});

// ---- 5: stored policy disables OpenAI -> never attempted even though registered ----

test("Phase B #5: a stored policy excluding OpenAI from enabledProviders -> OpenAI never attempted even though it is registered/configured", async () => {
  dbPolicyRowState = { rows: [dbRow({ enabledProviders: ["anthropic"], fallbackOrder: ["anthropic"] })] };
  const anthropicT = fakeTransport({ status: 503 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run -- disabled by stored policy" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, depsRealStore({ createRegistry: dualRegistry(anthropicT, openaiT) }));
  assert.equal(r.status, "unavailable");
  assert.equal(openaiHits, 0);
});

// ---- 6: malformed stored row -> full fallback to DEFAULT_PROVIDER_POLICY, default routing still works ----

test("Phase B #6: a malformed stored row (invalid mode) -> falls back to DEFAULT_PROVIDER_POLICY, default AUTO routing still works", async () => {
  dbPolicyRowState = { rows: [dbRow({ mode: "bogus" })] };
  const anthropicT = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, depsRealStore({ createRegistry: enabledRegistry(anthropicT) }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
});

// ---- 7: zero configured/registered providers -> deterministic-safe unavailable, never throws ----

test("Phase B #7: zero registered providers, even with a valid stored policy -> deterministic-safe 'unavailable', never throws", async () => {
  dbPolicyRowState = { rows: [dbRow()] };
  const r = await produceRadarAdvisory(CLIENT, depsRealStore({ createRegistry: () => createRadarIntelligenceRegistry({}) }));
  assert.equal(r.status, "unavailable");
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase D: per-request user provider selection
//
// produceRadarAdvisory(clientId, deps, requestedProviderId) — the third,
// OPTIONAL positional argument. Every test below exercises the FULL
// integration (resolver -> router -> adapters), proving there is exactly
// ONE authoritative resolution path (resolveProviderPolicy) and that a
// forged/stale/unauthorized requestedProviderId can never reach an
// adapter, never throws, and never distinguishably signals its own
// invalidity to the caller.
// =====================================================================

const selectionPolicy = (overrides = {}) => ({
  mode: "AUTO",
  defaultProvider: "anthropic",
  fallbackOrder: ["anthropic", "openai"],
  enabledProviders: ["anthropic", "openai"],
  userSelectableProviders: ["anthropic", "openai"],
  allowUserSelection: true,
  fallbackEnabled: true,
  ...overrides,
});

// ---- automatic routing preservation (requestedProviderId omitted/null) ----

test("Phase D #1: requestedProviderId omitted -> byte-identical AUTO routing (Anthropic primary), even with a selection-enabled policy", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(r.providerMeta.fallbackUsed, false);
  assert.equal(openaiHits, 0);
});

test("Phase D #2: requestedProviderId explicitly null -> identical to omitted (still AUTO)", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(anthropicT), providerPolicy: selectionPolicy() }), null);
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
});

// ---- explicit Anthropic routing ----

test("Phase D #3: explicit 'anthropic' + healthy -> Anthropic exactly once, no OpenAI call, fallbackUsed false", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), "anthropic");
  assert.equal(r.status, "ok");
  assert.equal(anthropicT.hits, 1);
  assert.equal(openaiHits, 0);
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(r.providerMeta.fallbackUsed, false);
});

test("Phase D #4: explicit 'anthropic' + eligible failure (503) -> Anthropic then OpenAI, fallbackUsed true", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = { async generate() { return { body: { summary: "fallback via explicit anthropic selection" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), "anthropic");
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "openai");
  assert.equal(r.providerMeta.fallbackUsed, true);
});

// ---- explicit OpenAI routing ----

test("Phase D #5: explicit 'openai' + healthy -> OpenAI exactly once, no Anthropic call, fallbackUsed false", async () => {
  let anthropicHits = 0;
  const anthropicT = { async generate() { anthropicHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const openaiT = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), "openai");
  assert.equal(r.status, "ok");
  assert.equal(anthropicHits, 0);
  assert.equal(openaiT.hits, 1);
  assert.equal(r.providerMeta.provider, "openai");
  assert.equal(r.providerMeta.fallbackUsed, false);
});

test("Phase D #6: explicit 'openai' + eligible failure -> OpenAI then Anthropic (fallback enabled, Anthropic enabled)", async () => {
  const anthropicT = { async generate() { return { body: { summary: "fallback via explicit openai selection" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const openaiT = fakeTransport({ status: 503 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), "openai");
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(r.providerMeta.fallbackUsed, true);
});

test("Phase D #7: explicit 'openai' + 429 -> OpenAI only, no Anthropic fallback (429 is never fallback-eligible)", async () => {
  let anthropicHits = 0;
  const anthropicT = { async generate() { anthropicHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const openaiT = fakeTransport({ status: 429 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), "openai");
  assert.equal(r.status, "rate_limited");
  assert.equal(anthropicHits, 0);
});

test("Phase D #8: explicit 'openai' + 400 -> OpenAI only, no Anthropic fallback (4xx is never fallback-eligible)", async () => {
  let anthropicHits = 0;
  const anthropicT = { async generate() { anthropicHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const openaiT = fakeTransport({ status: 400 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), "openai");
  assert.equal(r.status, "error");
  assert.equal(anthropicHits, 0);
});

// ---- forged / stale / unauthorized requests: safe fallback to Automatic, never a throw, never granted ----

for (const forged of ["gemini", "deepseek", "kimi", "local", "drop-table", "", "anthropic; openai"]) {
  test(`Phase D #9: forged/unsupported requestedProviderId (${JSON.stringify(forged)}) -> falls back to Automatic (Anthropic), never throws, never reaches an adapter`, async () => {
    const anthropicT = fakeTransport({ status: 200 });
    let openaiHits = 0;
    const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
    const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), forged);
    assert.equal(r.status, "ok");
    assert.equal(r.providerMeta.provider, "anthropic", `forged id ${JSON.stringify(forged)} must resolve to the safe AUTO default`);
    assert.equal(openaiHits, 0);
  });
}

test("Phase D #10: a technically-valid-but-disabled provider requested ('openai' excluded from enabledProviders) -> falls back to Automatic", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run -- disabled" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy({ enabledProviders: ["anthropic"], userSelectableProviders: [], allowUserSelection: false }) }),
    "openai",
  );
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(openaiHits, 0);
});

test("Phase D #11: a provider requested that is NOT in userSelectableProviders (but IS enabled) -> falls back to Automatic", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run -- not user-selectable" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy({ userSelectableProviders: ["anthropic"] }) }),
    "openai",
  );
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(openaiHits, 0);
});

test("Phase D #12: allowUserSelection=false with a provider explicitly requested -> ignored entirely, OWNER default wins", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run -- selection globally off" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy({ allowUserSelection: false }) }),
    "openai",
  );
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(openaiHits, 0);
});

test("Phase D #13: stale UI safety -- OWNER disables OpenAI selectability AFTER page load; a stale 'openai' request is safely rejected using FRESH policy, no OpenAI call", async () => {
  // Simulates: user's browser still shows OpenAI as selectable (loaded
  // before the OWNER change), but the server always re-loads the policy
  // fresh on every request -- there is no client-cached authorization.
  const freshPolicyAfterOwnerChange = selectionPolicy({ userSelectableProviders: ["anthropic"] }); // OpenAI removed
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run -- stale selection" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: freshPolicyAfterOwnerChange }), "openai");
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(openaiHits, 0, "the stale client-side selection must never reach the disabled provider");
});

test("Phase D #14: requested provider is selectable+enabled but NOT actually registered (e.g. missing API key) -> falls back to Automatic", async () => {
  // Only Anthropic is registered; OpenAI is policy-selectable but absent
  // from the technical registry (mirrors "provider not configured").
  const anthropicT = fakeTransport({ status: 200 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(anthropicT), providerPolicy: selectionPolicy() }), "openai");
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
});

test("Phase D #15: empty registry + explicit request -> deterministic-safe 'unavailable', never throws", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: () => createRadarIntelligenceRegistry({}), providerPolicy: selectionPolicy() }), "openai");
  assert.equal(r.status, "unavailable");
});

test("Phase D #16: no policy row (DEFAULT_PROVIDER_POLICY, allowUserSelection=false) + explicit request -> ignored, Automatic (Anthropic)", async () => {
  const anthropicT = fakeTransport({ status: 200 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT) }), "openai"); // no providerPolicy override -> DEFAULT_PROVIDER_POLICY
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(openaiHits, 0);
});

test("Phase D #17: fallback disabled (fallbackEnabled=false) + explicit selection + eligible failure -> no fallback, failure returned as-is", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  let openaiHits = 0;
  const openaiT = { async generate() { openaiHits += 1; return { body: { summary: "must not run -- fallback disabled" }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy({ fallbackEnabled: false }) }),
    "anthropic",
  );
  assert.equal(r.status, "unavailable");
  assert.equal(openaiHits, 0);
});

test("Phase D #18: max provider attempts remains 2 even for an explicit selection -- exactly one primary + one fallback attempt, never more", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = fakeTransport({ status: 503 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy() }), "anthropic");
  assert.equal(r.status, "unavailable");
  assert.equal(anthropicT.hits, 1);
  assert.equal(openaiT.hits, 1);
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G2: provider-attempt telemetry
// (observation only — never influences routing/fallback/eligibility).
// =====================================================================

function capturingRecorder() {
  const calls = [];
  return {
    calls,
    fn: async (input) => {
      calls.push(input);
    },
  };
}

function throwingRecorder() {
  return async () => {
    throw new Error("telemetry sink unavailable");
  };
}

/** A clock that advances by `stepMs` on every call, starting at `startMs`
 * — needed because the file's own shared `clock` fixture always returns
 * the SAME fixed Date (fine for every other test, but a latency test
 * needs elapsed time). */
function advancingClock(startMs, stepMs) {
  let t = startMs;
  return () => {
    const d = new Date(t);
    t += stepMs;
    return d;
  };
}

// ---- 1. successful attempt recorded ----

test("G2 #1: a successful attempt is recorded with status=success", async () => {
  const t = fakeTransport();
  const rec = capturingRecorder();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(r.status, "ok");
  assert.equal(rec.calls.length, 1);
  assert.equal(rec.calls[0].status, "success");
});

// ---- 2. failed attempt recorded ----

test("G2 #2: a final failure (no fallback available) is recorded with status=failure", async () => {
  const t = fakeTransport({ status: 500 });
  const rec = capturingRecorder();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(r.status, "error");
  assert.equal(rec.calls.length, 1);
  assert.equal(rec.calls[0].status, "failure");
  assert.equal(rec.calls[0].attemptCount, 1);
  assert.equal(rec.calls[0].fallbackUsed, false);
});

// ---- 3. aiRequestId correlation: request-scoped, distinct from the gateway's per-attempt id ----

test("G2 #3: aiRequestId is minted once per produceRadarAdvisory() call and differs from the gateway's own per-attempt requestId", async () => {
  const t = fakeTransport();
  const rec = capturingRecorder();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls.length, 1);
  assert.equal(typeof rec.calls[0].aiRequestId, "string");
  assert.ok(rec.calls[0].aiRequestId.length > 0);
  // r.providerMeta is stripped by the action layer for non-admin callers
  // in production, but advisory-core.ts's own result never exposes
  // aiRequestId at all -- it is a telemetry-only correlation id, never
  // part of RadarAdvisoryUiResult.
  assert.equal("aiRequestId" in r, false);
});

test("G2 #3b: two separate advisory requests get two DIFFERENT aiRequestId values", async () => {
  const t1 = fakeTransport();
  const t2 = fakeTransport();
  const rec = capturingRecorder();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t1), recordProviderAttempt: rec.fn }));
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t2), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls.length, 2);
  assert.notEqual(rec.calls[0].aiRequestId, rec.calls[1].aiRequestId);
});

test("G2 #3c: an injected generateAiRequestId is used verbatim", async () => {
  const t = fakeTransport();
  const rec = capturingRecorder();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn, generateAiRequestId: () => "air_fixed_for_test" }));
  assert.equal(rec.calls[0].aiRequestId, "air_fixed_for_test");
});

// ---- 4. attemptCount reflects real dispatch count ----

test("G2 #4: attemptCount=1 for a primary-only success, attemptCount=2 for a fallback", async () => {
  const rec = capturingRecorder();
  const t1 = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t1), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].attemptCount, 1);
  assert.equal(rec.calls[0].fallbackUsed, false);

  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[1].attemptCount, 2);
  assert.equal(rec.calls[1].fallbackUsed, true);
});

// ---- 5. provider/model recorded ----

test("G2 #5: provider and model are recorded on success; the FALLBACK provider/model on a successful fallback", async () => {
  const rec = capturingRecorder();
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].providerId, "openai");
  assert.equal(typeof rec.calls[0].modelId, "string");
});

test("G2 #5b: modelId is null on a failed attempt (no successful advisory to read a model from)", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport({ status: 500 });
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].modelId, null);
});

// ---- 6. selectionMode recorded ----

test("G2 #6: selectionMode is 'automatic' when requestedProviderId is omitted/null", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].selectionMode, "automatic");
});

test("G2 #6b: selectionMode is 'explicit' when a requestedProviderId is supplied", async () => {
  const rec = capturingRecorder();
  const anthropicT = fakeTransport();
  const openaiT = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy(), recordProviderAttempt: rec.fn }), "anthropic");
  assert.equal(rec.calls[0].selectionMode, "explicit");
  assert.equal(rec.calls[0].providerId, "anthropic");
});

// ---- 7. latency recorded ----

test("G2 #7: latencyMs is a non-negative integer, derived from the injected clock, never negative/impossible", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport();
  const slowClock = advancingClock(new Date("2026-09-13T10:00:00.000Z").getTime(), 250);
  await produceRadarAdvisory(CLIENT, { ...deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }), clock: slowClock });
  assert.equal(typeof rec.calls[0].latencyMs, "number");
  assert.ok(Number.isInteger(rec.calls[0].latencyMs));
  assert.ok(rec.calls[0].latencyMs >= 0);
});

// ---- 8. token counts recorded ----

test("G2 #8: input/output token counts are recorded on success (from the provider's own usage field)", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport(); // default body includes usage: { input_tokens: 20, output_tokens: 12 }
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].inputTokens, 20);
  assert.equal(rec.calls[0].outputTokens, 12);
});

test("G2 #8b: token counts are null on a failed attempt", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport({ status: 500 });
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].inputTokens, null);
  assert.equal(rec.calls[0].outputTokens, null);
});

// ---- 9. providerRequestId recorded when available ----

test("G2 #9: providerRequestId is recorded when the provider's usage body carries one, null otherwise", async () => {
  const rec = capturingRecorder();
  const tWith = fakeTransport({ body: { summary: "ok", usage: { input_tokens: 1, output_tokens: 1, providerRequestId: "req_test123" } } });
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(tWith), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].providerRequestId, "req_test123");

  const tWithout = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(tWithout), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[1].providerRequestId, null);
});

// ---- 10/11/12/13. no raw prompt / advisory text / raw provider error / credential ----

test("G2 #10-13: the recorded telemetry input carries EXACTLY the allowlisted fields -- no prompt, advisory text, raw error, or credential-shaped field", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  const input = rec.calls[0];
  assert.deepEqual(
    Object.keys(input).sort(),
    [
      "aiRequestId",
      "actorUserId",
      "providerId",
      "modelId",
      "selectionMode",
      "status",
      "errorCode",
      "failureClass",
      "httpStatus",
      "latencyMs",
      "attemptCount",
      "fallbackUsed",
      "inputTokens",
      "outputTokens",
      "providerRequestId",
    ].sort(),
  );
  assert.equal(/summary|advisory|prompt|apiKey|Authorization|Bearer/i.test(JSON.stringify(input)), false);
});

test("G2 #12b: on failure, errorCode/failureClass are safe enum values, never the raw IntelligenceError object or a message", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport({ status: 503 });
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  const input = rec.calls[0];
  assert.equal(typeof input.errorCode, "string");
  assert.equal("message" in input, false);
  assert.equal("providerId" in input && typeof input.providerId, "string"); // the STRING id, never an object
});

// ---- 14/15. telemetry failure never fails the advisory or the fallback ----

test("G2 #14: a throwing telemetry recorder never changes the returned advisory result", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: throwingRecorder() }));
  assert.equal(r.status, "ok");
});

test("G2 #15: a throwing telemetry recorder never prevents or alters a real fallback outcome", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), recordProviderAttempt: throwingRecorder() }));
  assert.equal(r.status, "ok");
  assert.equal(r.providerMeta.provider, "openai");
  assert.equal(r.providerMeta.fallbackUsed, true);
});

// ---- 16/17/18/19. deterministic RADAR / routing behavior unchanged with telemetry wired in ----

test("G2 #16: the deterministic block is still byte-identical to the input opportunity with telemetry recording active", async () => {
  const t = fakeTransport();
  const rec = capturingRecorder();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.deepEqual(r.deterministic, { priority: OPPORTUNITY.priority, confidence: OPPORTUNITY.confidence, recommendedNextAction: OPPORTUNITY.recommendedNextAction });
});

test("G2 #17: automatic routing (no requestedProviderId) is unaffected -- still selects the primary, records selectionMode=automatic", async () => {
  const rec = capturingRecorder();
  const anthropicT = fakeTransport();
  const openaiT = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), recordProviderAttempt: rec.fn }));
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(rec.calls[0].selectionMode, "automatic");
  assert.equal(openaiT.hits, 0);
});

test("G2 #18: an explicit Anthropic selection is unaffected -- still routes to Anthropic, records providerId=anthropic + selectionMode=explicit", async () => {
  const rec = capturingRecorder();
  const anthropicT = fakeTransport();
  const openaiT = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy(), recordProviderAttempt: rec.fn }), "anthropic");
  assert.equal(r.providerMeta.provider, "anthropic");
  assert.equal(rec.calls[0].providerId, "anthropic");
  assert.equal(rec.calls[0].selectionMode, "explicit");
});

test("G2 #19: an explicit OpenAI selection is unaffected -- still routes to OpenAI, records providerId=openai + selectionMode=explicit", async () => {
  const rec = capturingRecorder();
  const anthropicT = fakeTransport();
  const openaiT = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: dualRegistry(anthropicT, openaiT), providerPolicy: selectionPolicy(), recordProviderAttempt: rec.fn }), "openai");
  assert.equal(r.providerMeta.provider, "openai");
  assert.equal(rec.calls[0].providerId, "openai");
  assert.equal(rec.calls[0].selectionMode, "explicit");
  assert.equal(anthropicT.hits, 0, "an explicit OpenAI selection must never dispatch to Anthropic at all");
});

// ---- extra rigor: cases that must NOT produce a telemetry row at all ----

test("G2 extra: a not_applicable result (non-QUALIFIED prospect) never reaches the router -- zero telemetry rows", async () => {
  const rec = capturingRecorder();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ qualification: { qualificationStatus: "INSUFFICIENT_DATA", eligibility: { contactable: true }, opportunity: null }, recordProviderAttempt: rec.fn }),
  );
  assert.equal(r.status, "not_applicable");
  assert.equal(rec.calls.length, 0);
});

test("G2 extra: zero providers configured (attemptCount=0, the designed no-op state) records NO telemetry row -- not a real 'attempt'", async () => {
  const rec = capturingRecorder();
  const r = await produceRadarAdvisory(CLIENT, deps({ recordProviderAttempt: rec.fn })); // enabledRegistry not used -> empty registry
  assert.equal(r.status, "unavailable");
  assert.equal(rec.calls.length, 0);
});

test("G2 extra: an invalid clientId never reaches telemetry recording either", async () => {
  const rec = capturingRecorder();
  await produceRadarAdvisory("not-a-uuid", deps({ recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls.length, 0);
});

// ---- actorUserId wiring ----

test("G2: actorUserId flows from deps into the recorded row when supplied", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport();
  await produceRadarAdvisory(CLIENT, { ...deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }), actorUserId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(rec.calls[0].actorUserId, "22222222-2222-4222-8222-222222222222");
});

test("G2: actorUserId is null when omitted -- never throws, never fabricated", async () => {
  const rec = capturingRecorder();
  const t = fakeTransport();
  await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls[0].actorUserId, null);
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G4B-2 — the AI quota gate.
//
// The store-level primitives (quota-counter-store.ts::admitGlobalRequestUnit/
// tryAdmitGlobalRequest/readGlobalQuotaCounter/incrementGlobalTokenCount)
// are unit- and concurrency-tested in their OWN files
// (quota-counter-store.test.mjs / .concurrency.integration.test.mjs) --
// this section treats them as an injected black box and tests ONLY
// advisory-core.ts's own orchestration: when the gate is called, what it
// passes to each primitive, and how it interprets each primitive's
// result. No test below touches a real DB.
// =====================================================================

test("G4B-2: enabled=true, no limits configured -> ok, admitRequestUnit called with dailyRequestLimit=null", async () => {
  let seenLimit;
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({
      createRegistry: enabledRegistry(t),
      quotaPolicy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 },
      admitRequestUnit: async (limit) => {
        seenLimit = limit;
        return true;
      },
    }),
  );
  assert.equal(r.status, "ok");
  assert.equal(seenLimit, null);
});

test("G4B-2: enabled=false -> limited, zero provider HTTP calls, deterministic block present", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), quotaPolicy: { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } }));
  assert.equal(r.status, "limited");
  assert.deepEqual(r.deterministic, { priority: "HIGH", confidence: "MEDIUM", recommendedNextAction: "FOLLOW_UP_PROPOSAL" });
  assert.equal(t.hits, 0, "the AI layer being OWNER-disabled must produce zero provider HTTP calls -- the router is never even constructed, only the (side-effect-free) registry lookup that already existed for policy resolution");
});

test("G4B-2: admitRequestUnit returning false (request limit reached) -> limited, zero provider HTTP calls", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: enabledRegistry(t), quotaPolicy: { enabled: true, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 }, admitRequestUnit: async () => false }),
  );
  assert.equal(r.status, "limited");
  assert.deepEqual(r.deterministic, { priority: "HIGH", confidence: "MEDIUM", recommendedNextAction: "FOLLOW_UP_PROPOSAL" });
  assert.equal(t.hits, 0);
});

test("G4B-2: admitRequestUnit returning true -> proceeds to the router (ok)", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: enabledRegistry(t), quotaPolicy: { enabled: true, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 }, admitRequestUnit: async () => true }),
  );
  assert.equal(r.status, "ok");
  assert.equal(t.hits, 1);
});

test("G4B-2: admitRequestUnit is called with the EXACT configured dailyRequestLimit, whatever it is (0, null, or N)", async () => {
  const seenLimits = [];
  const recorder = async (limit) => {
    seenLimits.push(limit);
    return true;
  };
  for (const limit of [0, null, 5, 1000]) {
    await produceRadarAdvisory(CLIENT, deps({ quotaPolicy: { enabled: true, dailyRequestLimit: limit, dailyTokenLimit: null, warningThresholdPercent: 80 }, admitRequestUnit: recorder }));
  }
  assert.deepEqual(seenLimits, [0, null, 5, 1000]);
});

test("G4B-2: dailyTokenLimit already reached (tokenCount >= limit) -> limited, zero provider HTTP calls, admitRequestUnit never even called", async () => {
  let admitCalls = 0;
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({
      createRegistry: enabledRegistry(t),
      quotaPolicy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 1000, warningThresholdPercent: 80 },
      readQuotaCounter: async () => ({ key: "global:test", requestCount: 5, tokenCount: 1000, windowStart: new Date(0) }),
      admitRequestUnit: async () => {
        admitCalls += 1;
        return true;
      },
    }),
  );
  assert.equal(r.status, "limited");
  assert.equal(t.hits, 0);
  assert.equal(admitCalls, 0, "the request-quota primitive must never even be reached once the token budget is already exhausted");
});

test("G4B-2: dailyTokenLimit=0 with no counter row yet (tokenCount defaults to 0) -> limited (0 >= 0)", async () => {
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({
      quotaPolicy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 0, warningThresholdPercent: 80 },
      readQuotaCounter: async () => null,
    }),
  );
  assert.equal(r.status, "limited");
});

test("G4B-2: tokenCount under the limit -> proceeds to the router (ok)", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({
      createRegistry: enabledRegistry(t),
      quotaPolicy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 1000, warningThresholdPercent: 80 },
      readQuotaCounter: async () => ({ key: "global:test", requestCount: 5, tokenCount: 999, windowStart: new Date(0) }),
    }),
  );
  assert.equal(r.status, "ok");
});

test("G4B-2: an explicit provider selection cannot bypass a denied gate", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ quotaPolicy: { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } }), "openai");
  assert.equal(r.status, "limited");
});

test("G4B-2: automatic (no requestedProviderId) is denied identically to an explicit selection", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ quotaPolicy: { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } }));
  assert.equal(r.status, "limited");
});

test("G4B-2: a fallback (primary fails, secondary succeeds) still consumes EXACTLY ONE request-quota unit", async () => {
  const anthropicT = fakeTransport({ status: 503 });
  const openaiT = { async generate() { return { body: { summary: "ok", usage: { input_tokens: 5, output_tokens: 5 } }, status: 200 }; }, describeHealth: () => ({ reachable: true, degraded: false }) };
  let admitCalls = 0;
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: dualRegistry(anthropicT, openaiT), admitRequestUnit: async () => { admitCalls += 1; return true; } }),
  );
  assert.equal(r.status, "ok");
  assert.equal(admitCalls, 1, "the gate runs ONCE before the router -- the router's own internal fallback dispatch never re-enters it");
});

test("G4B-2: a provider failure (no fallback available) still consumed its one request-quota unit -- never refunded", async () => {
  let admitCalls = 0;
  const t = fakeTransport({ status: 503 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), admitRequestUnit: async () => { admitCalls += 1; return true; } }));
  assert.equal(r.status, "unavailable");
  assert.equal(admitCalls, 1);
});

test("G4B-2: a successful provider response triggers exactly one token increment, with the sum of input+output tokens", async () => {
  const calls = [];
  const t = fakeTransport(); // default body: usage { input_tokens: 20, output_tokens: 12 }
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), incrementQuotaTokens: async (delta, now) => { calls.push({ delta, now }); return { key: "global:test", requestCount: 1, tokenCount: delta, windowStart: now }; } }));
  assert.equal(r.status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delta, 32);
});

test("G4B-2: a failed provider response triggers ZERO token increments (G3A convention: only success produces tokens)", async () => {
  let incrementCalls = 0;
  const t = fakeTransport({ status: 503 });
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), incrementQuotaTokens: async () => { incrementCalls += 1; return { key: "global:test", requestCount: 1, tokenCount: 0, windowStart: new Date(0) }; } }));
  assert.equal(r.status, "unavailable");
  assert.equal(incrementCalls, 0);
});

test("G4B-2: a token increment failure NEVER takes back an already-successful advisory (best-effort, unlike the pre-dispatch gate)", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), incrementQuotaTokens: async () => { throw new Error("simulated counter-store outage"); } }));
  assert.equal(r.status, "ok", "the user-facing advisory must still succeed even though the post-hoc token bookkeeping failed");
});

test("G4B-2: admitRequestUnit throwing (counter store outage) -> limited, fail-closed, zero provider HTTP calls", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: enabledRegistry(t), quotaPolicy: { enabled: true, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 }, admitRequestUnit: async () => { throw new Error("connection refused"); } }),
  );
  assert.equal(r.status, "limited");
  assert.equal(t.hits, 0, "a counter-store outage must fail CLOSED -- never fail open into a real provider dispatch");
});

test("G4B-2: readQuotaCounter throwing (counter store outage during the token pre-check) -> limited, fail-closed", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({
      createRegistry: enabledRegistry(t),
      quotaPolicy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 1000, warningThresholdPercent: 80 },
      readQuotaCounter: async () => { throw new Error("connection refused"); },
    }),
  );
  assert.equal(r.status, "limited");
  assert.equal(t.hits, 0);
});

test("G4B-2: loadQuotaPolicy throwing (defensive-only -- the real store never does) -> limited, fail-closed", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), loadQuotaPolicy: async () => { throw new Error("simulated"); } }));
  assert.equal(r.status, "limited");
  assert.equal(t.hits, 0);
});

test("G4B-2: a 'limited' result never reaches provider-attempt telemetry recording", async () => {
  const rec = capturingRecorder();
  await produceRadarAdvisory(CLIENT, deps({ quotaPolicy: { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 }, recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls.length, 0);
});

test("G4B-2: RADAR CORE FIRST -- the 'limited' deterministic block is byte-identical to what a successful advisory would have carried", async () => {
  const rLimited = await produceRadarAdvisory(CLIENT, deps({ quotaPolicy: { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } }));
  const t = fakeTransport();
  const rOk = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t) }));
  assert.equal(rOk.status, "ok");
  assert.deepEqual(rLimited.deterministic, rOk.deterministic);
});

test("G4B-2: no secret/provider/model value ever appears in a 'limited' result", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ quotaPolicy: { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } }));
  assert.equal(r.status, "limited");
  assert.deepEqual(Object.keys(r).sort(), ["status", "deterministic"].sort());
  const s = JSON.stringify(r);
  assert.equal(/anthropic|openai|apiKey|sk-ant-|sk-proj-|secret|credential|Bearer/i.test(s), false);
});

test("G4B-2: the gate's `now` comes from the injected clock, never a fresh Date() -- admitRequestUnit/readQuotaCounter/incrementQuotaTokens all see the SAME injected time", async () => {
  const seenTimes = [];
  const t = fakeTransport();
  await produceRadarAdvisory(
    CLIENT,
    deps({
      createRegistry: enabledRegistry(t),
      quotaPolicy: { enabled: true, dailyRequestLimit: 10, dailyTokenLimit: 1000, warningThresholdPercent: 80 },
      readQuotaCounter: async (now) => { seenTimes.push(now); return null; },
      admitRequestUnit: async (limit, now) => { seenTimes.push(now); return true; },
      incrementQuotaTokens: async (delta, now) => { seenTimes.push(now); return { key: "global:test", requestCount: 1, tokenCount: delta, windowStart: now }; },
    }),
  );
  assert.equal(seenTimes.length, 3);
  for (const t2 of seenTimes) assert.equal(t2.getTime(), clock().getTime());
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G4B-2 CORRECTION — "missing" vs
// "error" must produce genuinely different behavior: "missing" (no
// policy row yet -- a legitimate, expected first-install state) must
// behave EXACTLY like an "ok" default policy; "error" (a genuine
// policy-store outage) must fail closed, distinctly from a
// counter-store outage.
// =====================================================================

test("G4B-2 correction: loadQuotaPolicy status='missing' behaves EXACTLY like status='ok' with the default policy -- proceeds to the router", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(
    CLIENT,
    deps({ createRegistry: enabledRegistry(t), loadQuotaPolicy: async () => ({ status: "missing", policy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } }) }),
  );
  assert.equal(r.status, "ok");
  assert.equal(t.hits, 1);
});

test("G4B-2 correction: loadQuotaPolicy status='error' -> limited, fail-closed, ZERO provider HTTP calls -- this is the exact defect being corrected (an outage must never be silently treated as 'enabled, unlimited')", async () => {
  const t = fakeTransport();
  const r = await produceRadarAdvisory(CLIENT, deps({ createRegistry: enabledRegistry(t), loadQuotaPolicy: async () => ({ status: "error", policy: null }) }));
  assert.equal(r.status, "limited");
  assert.deepEqual(r.deterministic, { priority: "HIGH", confidence: "MEDIUM", recommendedNextAction: "FOLLOW_UP_PROPOSAL" });
  assert.equal(t.hits, 0, "a policy-store outage must fail CLOSED -- it must NEVER fall through to 'enabled, unlimited' and dispatch to a real provider");
});

test("G4B-2 correction: a policy-store error is logged with AI_QUOTA_POLICY_UNAVAILABLE, distinct from AI_QUOTA_COUNTER_UNAVAILABLE", async () => {
  const calls = await withCapturedWarn(() =>
    produceRadarAdvisory(CLIENT, deps({ loadQuotaPolicy: async () => ({ status: "error", policy: null }) })),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].code, "AI_QUOTA_POLICY_UNAVAILABLE");
});

test("G4B-2 correction: a COUNTER-store error is still logged with AI_QUOTA_COUNTER_UNAVAILABLE -- the two outage types remain distinguishable in logs", async () => {
  const calls = await withCapturedWarn(() =>
    produceRadarAdvisory(CLIENT, deps({ quotaPolicy: { enabled: true, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 }, admitRequestUnit: async () => { throw new Error("connection refused"); } })),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].code, "AI_QUOTA_COUNTER_UNAVAILABLE");
});

test("G4B-2 correction: a policy-store error never reaches provider-attempt telemetry recording", async () => {
  const rec = capturingRecorder();
  await produceRadarAdvisory(CLIENT, deps({ loadQuotaPolicy: async () => ({ status: "error", policy: null }), recordProviderAttempt: rec.fn }));
  assert.equal(rec.calls.length, 0);
});

test("G4B-2 correction: a policy-store error result never leaks a DB error message or any secret-shaped value", async () => {
  const r = await produceRadarAdvisory(CLIENT, deps({ loadQuotaPolicy: async () => ({ status: "error", policy: null }) }));
  assert.equal(r.status, "limited");
  assert.deepEqual(Object.keys(r).sort(), ["status", "deterministic"].sort());
  const s = JSON.stringify(r);
  assert.equal(/password|DATABASE_URL|secret|credential|connection refused/i.test(s), false);
});
