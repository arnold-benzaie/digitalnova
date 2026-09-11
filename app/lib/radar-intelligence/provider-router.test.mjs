// RADAR INTELLIGENCE V2 — provider router tests (mission test matrix items
// 1-14: ROUTING + CALL LIMIT).
//
// Everything here uses hand-built FAKE adapters — zero network, zero real
// Anthropic/OpenAI code. The router's OWN decision logic
// (isFallbackEligible + createProviderRouter.run) is what's under test:
// which failures trigger a fallback attempt, which don't, and that at
// most two provider dispatches EVER happen.
//
// Run: npx tsx --test lib/radar-intelligence/provider-router.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { createProviderRouter, isFallbackEligible, DEFAULT_ROUTING_POLICY } from "./provider-router.ts";
import { createProviderRegistry } from "./provider-registry.ts";
import { makeIntelligenceError } from "./errors.ts";
import { sanitizeProspectContext } from "./sanitize-context.ts";

const CLOCK = () => new Date("2026-09-11T09:00:00.000Z");

const CTX = sanitizeProspectContext({
  prospectName: "Boulangerie Lefèvre",
  company: null,
  sector: "bakery",
  location: "Lyon, FR",
  stage: "prospect",
  deterministicPriority: "HIGH",
  deterministicConfidence: "MEDIUM",
  deterministicReasonCodes: ["DEAL_STAGE_PROPOSAL"],
  recommendedNextActionCode: "FOLLOW_UP_PROPOSAL",
  recentInteractionSummaries: ["Called yesterday."],
  openFollowUpCount: 1,
  nextFollowUpDueOn: null,
});

const REQUEST = { kind: "summarize", requiredCapabilities: ["summarize"], context: CTX };

/** A minimal, fully-controllable fake IntelligenceProviderAdapter. Counts
 * every run() call so a test can assert exact dispatch counts. */
function fakeAdapter(id, script) {
  let calls = 0;
  return {
    id,
    disabled: script.disabled ?? false,
    calls: () => calls,
    health() {
      return script.disabled
        ? { id, connection: "DISABLED", health: "HEALTHY", capabilities: [], lastCheckedAt: null }
        : { id, connection: "CONNECTED", health: "HEALTHY", capabilities: ["summarize"], lastCheckedAt: null };
    },
    capabilities() {
      return ["summarize"];
    },
    async run() {
      calls += 1;
      if (script.throw) throw script.throw;
      if (script.ok) {
        return { ok: true, advisory: { advisory: true, provider: id, status: "CONNECTED", generatedAt: CLOCK().toISOString(), summary: script.summary ?? `${id} summary`, model: script.model ?? `${id}-model` } };
      }
      return { ok: false, error: script.error };
    },
  };
}

function registryOf(...adapters) {
  const registry = createProviderRegistry();
  for (const a of adapters) registry.register(a);
  return registry;
}

function router(registry, policy = DEFAULT_ROUTING_POLICY) {
  return createProviderRouter({ registry, policy, clock: CLOCK, timeoutMs: 5_000 });
}

// ---------------- isFallbackEligible: the exact rule ----------------

test("isFallbackEligible: null (success) is never eligible", () => {
  assert.equal(isFallbackEligible(null), false);
});

test("isFallbackEligible: allowed conditions — unavailable, timeout, 5xx, network, disabled/disconnected/no-capable", () => {
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic")), true);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_TIMEOUT", "anthropic", "PROVIDER_TIMEOUT")), true);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_5XX", 503)), true);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_NETWORK")), true);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_DISABLED", null)), true);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_DISCONNECTED", null)), true);
  assert.equal(isFallbackEligible(makeIntelligenceError("NO_CAPABLE_PROVIDER", "deterministic")), true);
});

test("isFallbackEligible: NEVER for 4xx/400/401/403, rate limit (429), local validation, or parse errors", () => {
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", 400)), false);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", 401)), false);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", 403)), false);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_RATE_LIMITED", "anthropic", "PROVIDER_4XX", 429)), false);
  assert.equal(isFallbackEligible(makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", null)), false);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_PARSE")), false);
  assert.equal(isFallbackEligible(makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_UNKNOWN")), false);
});

// ---------------- 1. Anthropic success -> OpenAI never called ----------------

test("1. primary (Anthropic) success -> fallback (OpenAI) is never dispatched", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: true, summary: "Primary worked." });
  const openai = fakeAdapter("openai", { ok: true, summary: "Should never run." });
  const r = router(registryOf(anthropic, openai));
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory.provider, "anthropic");
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(outcome.attemptCount, 1);
  assert.equal(anthropic.calls(), 1);
  assert.equal(openai.calls(), 0);
});

// ---------------- 2-5. eligible primary failures -> fallback runs ----------------

for (const [label, error] of [
  ["PROVIDER_UNAVAILABLE", makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic")],
  ["PROVIDER_TIMEOUT", makeIntelligenceError("PROVIDER_TIMEOUT", "anthropic", "PROVIDER_TIMEOUT")],
  ["a provider 5xx", makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_5XX", 503)],
  ["a network fault", makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_NETWORK")],
]) {
  test(`2-5. Anthropic fails with ${label} -> OpenAI is called once and its success is returned`, async () => {
    const anthropic = fakeAdapter("anthropic", { ok: false, error });
    const openai = fakeAdapter("openai", { ok: true, summary: "Fallback saved the day." });
    const r = router(registryOf(anthropic, openai));
    const outcome = await r.run(REQUEST);
    assert.equal(outcome.advisory.provider, "openai");
    assert.equal(outcome.fallbackUsed, true);
    assert.equal(outcome.attemptCount, 2);
    assert.equal(anthropic.calls(), 1);
    assert.equal(openai.calls(), 1);
  });
}

// ---------------- 6-8. non-fallback-eligible primary failures ----------------

for (const [label, error] of [
  ["400", makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", 400)],
  ["401", makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", 401)],
  ["403", makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", 403)],
]) {
  test(`6-8. Anthropic returns ${label} -> OpenAI is NEVER called; the auth/config mistake stays visible`, async () => {
    const anthropic = fakeAdapter("anthropic", { ok: false, error });
    const openai = fakeAdapter("openai", { ok: true, summary: "Must never be reached." });
    const r = router(registryOf(anthropic, openai));
    const outcome = await r.run(REQUEST);
    assert.equal(outcome.advisory, null);
    assert.equal(outcome.error.code, "PROVIDER_ERROR");
    assert.equal(outcome.error.httpStatus, Number(label));
    assert.equal(outcome.fallbackUsed, false);
    assert.equal(outcome.attemptCount, 1);
    assert.equal(anthropic.calls(), 1);
    assert.equal(openai.calls(), 0);
  });
}

test("9. Anthropic returns 429 (rate limited) -> stays non-fallback in V2, OpenAI never called", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_RATE_LIMITED", "anthropic", "PROVIDER_4XX", 429) });
  const openai = fakeAdapter("openai", { ok: true, summary: "Must never be reached." });
  const r = router(registryOf(anthropic, openai));
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.error.code, "PROVIDER_RATE_LIMITED");
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(outcome.attemptCount, 1);
  assert.equal(openai.calls(), 0);
});

test("10. both Anthropic and OpenAI fail -> the existing safe failure semantics are returned (fallback's own error), no throw", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: false, error: makeIntelligenceError("PROVIDER_TIMEOUT", "openai", "PROVIDER_TIMEOUT") });
  const r = router(registryOf(anthropic, openai));
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error.code, "PROVIDER_TIMEOUT");
  assert.equal(outcome.error.providerId, "openai");
  assert.equal(outcome.fallbackUsed, true);
  assert.equal(outcome.attemptCount, 2);
  assert.equal(anthropic.calls(), 1);
  assert.equal(openai.calls(), 1);
});

// ---------------- CALL LIMIT (11-14) ----------------

test("11. primary is called AT MOST once, even on a genuine transport throw", async () => {
  const anthropic = fakeAdapter("anthropic", { throw: Object.assign(new Error("boom"), { name: "TransportNetworkError" }) });
  const openai = fakeAdapter("openai", { ok: true });
  const r = router(registryOf(anthropic, openai));
  await r.run(REQUEST);
  assert.equal(anthropic.calls(), 1);
});

test("12. fallback is called AT MOST once, even when it also fails", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "openai") });
  const r = router(registryOf(anthropic, openai));
  await r.run(REQUEST);
  assert.equal(openai.calls(), 1);
});

test("13. total provider dispatches across a whole run() never exceed two", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "openai") });
  const r = router(registryOf(anthropic, openai));
  await r.run(REQUEST);
  assert.equal(anthropic.calls() + openai.calls(), 2);
});

test("14. no retry loop: calling run() twice in a row still dispatches exactly 1 (or 2) calls PER run, never accumulating extra attempts from a shared/leaked state", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: true });
  const openai = fakeAdapter("openai", { ok: true });
  const r = router(registryOf(anthropic, openai));
  await r.run(REQUEST);
  await r.run(REQUEST);
  assert.equal(anthropic.calls(), 2, "one call per run(), no hidden accumulation");
  assert.equal(openai.calls(), 0);
});

// ---------------- ZERO PROVIDER MODE (29-30, verified here at the router level too) ----------------

test("29. neither provider registered -> safe NO_CAPABLE_PROVIDER outcome, zero throws, zero calls", async () => {
  const r = router(createProviderRegistry());
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.providerUnavailable, true);
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(outcome.attemptCount, 0);
});

test("30. primary disabled, fallback not registered at all -> clean unavailable result, no fallback attempted (fallback isn't eligible target)", async () => {
  const anthropic = fakeAdapter("anthropic", { disabled: true });
  const r = router(registryOf(anthropic));
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.fallbackUsed, false);
});

// ---------------- REGRESSION: policy.fallback === null disables routing entirely ----------------

test("a routing policy with fallback:null never attempts a second provider, however the primary fails", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: true });
  const r = router(registryOf(anthropic, openai), { primary: "anthropic", fallback: null });
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(openai.calls(), 0);
});

test("DEFAULT_ROUTING_POLICY is frozen and is exactly {primary: anthropic, fallback: openai}", () => {
  assert.deepEqual(DEFAULT_ROUTING_POLICY, { primary: "anthropic", fallback: "openai" });
  assert.throws(() => {
    DEFAULT_ROUTING_POLICY.primary = "openai";
  }, TypeError);
});
