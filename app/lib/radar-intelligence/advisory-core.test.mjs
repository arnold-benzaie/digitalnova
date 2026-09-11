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
    ...(overrides.locale ? { locale: overrides.locale } : {}),
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
