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

import { createProviderRouter, isFallbackEligible, DEFAULT_ROUTING_POLICY, MAX_PROVIDER_ATTEMPTS } from "./provider-router.ts";
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

// ---------------- BUGFIX REGRESSION: primary ABSENT (not merely disabled) -> fallback ----------------
//
// The Production gap: a primary that is simply never REGISTERED (the
// real createConfiguredRadarIntelligenceRegistry shape when
// RADAR_INTELLIGENCE_ANTHROPIC_ENABLED=false — it never constructs a
// "disabled" adapter object at all) resolves, via the gateway's own
// NO_CAPABLE_PROVIDER -> deterministicOutcome() collapse, to
// `error: null`. Before the fix, `isFallbackEligible(null)` returning
// `false` meant the fallback was silently never attempted. These tests
// exercise createProviderRouter() directly end-to-end — never
// isFallbackEligible() in isolation — with a registry that TRULY never
// contains an "anthropic" entry (registryOf(openai) only, no fake
// anthropic adapter of any kind, disabled or otherwise).

test("BUGFIX A: Anthropic completely ABSENT (never registered, not merely disabled) + OpenAI registered -> OpenAI is attempted exactly once and its result is returned as the fallback", async () => {
  const openai = fakeAdapter("openai", { ok: true, summary: "OpenAI served this one." });
  const r = router(registryOf(openai)); // no anthropic entry in the registry at all
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory.provider, "openai");
  assert.match(outcome.advisory.summary, /OpenAI served this one/);
  assert.equal(outcome.fallbackUsed, true);
  assert.equal(outcome.attemptCount, 1, "the primary was never dispatched to (it doesn't exist) -- 0 + 1 fallback attempt");
  assert.equal(openai.calls(), 1);
  assert.equal(outcome.error, null);
});

test("BUGFIX B: neither Anthropic nor OpenAI registered -> deterministic-safe no-provider outcome, no crash, zero provider transport calls, fallbackUsed false", async () => {
  const r = router(createProviderRegistry()); // genuinely empty — no adapters of any kind
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error, null, "the designed no-provider state, not a fabricated error");
  assert.equal(outcome.providerUnavailable, true);
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(outcome.attemptCount, 0);
});

test("BUGFIX C: Anthropic absent + OpenAI registered but OpenAI itself fails -> OpenAI's normalized failure is returned, fallbackUsed true, no retry, no third attempt", async () => {
  const openai = fakeAdapter("openai", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "openai") });
  const r = router(registryOf(openai));
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error.code, "PROVIDER_UNAVAILABLE");
  assert.equal(outcome.error.providerId, "openai");
  assert.equal(outcome.fallbackUsed, true);
  assert.equal(outcome.attemptCount, 1);
  assert.equal(openai.calls(), 1, "OpenAI was called exactly once -- no retry, no third attempt");
});

test("BUGFIX D: Anthropic present and succeeds, OpenAI also registered -> Anthropic only, OpenAI never called, fallbackUsed false (unchanged by the fix)", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: true, summary: "Anthropic answered." });
  const openai = fakeAdapter("openai", { ok: true, summary: "must never run" });
  const r = router(registryOf(anthropic, openai));
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory.provider, "anthropic");
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(anthropic.calls(), 1);
  assert.equal(openai.calls(), 0);
});

test("BUGFIX regression guard: a REGISTERED-but-disabled primary is a DIFFERENT case from an ABSENT primary, and both still correctly reach OpenAI", async () => {
  // registered (disabled:true) -> gateway returns a REAL PROVIDER_DISABLED
  // error (not a null-collapse); this already worked before the fix and
  // must keep working identically now that primaryRegistered also feeds
  // the eligibility decision.
  const disabledAnthropic = fakeAdapter("anthropic", { disabled: true });
  const openai1 = fakeAdapter("openai", { ok: true, summary: "fallback via disabled adapter" });
  const outcome1 = await router(registryOf(disabledAnthropic, openai1)).run(REQUEST);
  assert.equal(outcome1.advisory.provider, "openai");
  assert.equal(outcome1.fallbackUsed, true);

  // absent (not registered at all) -> the bug this mission fixes.
  const openai2 = fakeAdapter("openai", { ok: true, summary: "fallback via absent primary" });
  const outcome2 = await router(registryOf(openai2)).run(REQUEST);
  assert.equal(outcome2.advisory.provider, "openai");
  assert.equal(outcome2.fallbackUsed, true);
});

test("BUGFIX E/F (re-confirmation): a REGISTERED primary's own eligibility rules are completely unaffected by the fix", async () => {
  // Non-fallbackable (E): 400/401/403/429/parse -> no OpenAI, exactly as
  // tests 6-9 above already assert; re-confirmed here as a single
  // consolidated guard against any accidental broadening.
  for (const status of [400, 401, 403]) {
    const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", status) });
    const openai = fakeAdapter("openai", { ok: true });
    const outcome = await router(registryOf(anthropic, openai)).run(REQUEST);
    assert.equal(outcome.fallbackUsed, false, `status ${status} must not fall back`);
    assert.equal(openai.calls(), 0);
  }
  // Fallbackable (F): 5xx/timeout/network/unavailable -> OpenAI, exactly
  // as tests 2-5 above already assert.
  for (const error of [
    makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_5XX", 503),
    makeIntelligenceError("PROVIDER_TIMEOUT", "anthropic", "PROVIDER_TIMEOUT"),
    makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_NETWORK"),
    makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic"),
  ]) {
    const anthropic = fakeAdapter("anthropic", { ok: false, error });
    const openai = fakeAdapter("openai", { ok: true, summary: "fallback ok" });
    const outcome = await router(registryOf(anthropic, openai)).run(REQUEST);
    assert.equal(outcome.fallbackUsed, true, `${error.code} must fall back`);
    assert.equal(openai.calls(), 1);
  }
});

test("BUGFIX G: attempt cap is structurally unaffected -- absent-primary fallback still dispatches at most two providers total, never a loop", async () => {
  const openai = fakeAdapter("openai", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "openai") });
  const r = router(registryOf(openai));
  await r.run(REQUEST);
  await r.run(REQUEST);
  // one OpenAI dispatch per run() call, never accumulating and never a
  // third attempt within a single run() (there is no third provider to
  // try, and the router has no retry loop regardless).
  assert.equal(openai.calls(), 2, "exactly one OpenAI call per run(), across two independent run() calls");
});

// ---------------- REGRESSION: an empty fallbackChain disables routing entirely ----------------

test("a routing policy with an EMPTY fallbackChain never attempts a second provider, however the primary fails", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: true });
  const r = router(registryOf(anthropic, openai), { primary: "anthropic", fallbackChain: [] });
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(openai.calls(), 0);
});

test("DEFAULT_ROUTING_POLICY is frozen and is exactly {primary: anthropic, fallbackChain: [openai]}", () => {
  assert.deepEqual(DEFAULT_ROUTING_POLICY, { primary: "anthropic", fallbackChain: ["openai"] });
  assert.throws(() => {
    DEFAULT_ROUTING_POLICY.primary = "openai";
  }, TypeError);
});

// ---------------- V2.1: N-provider generalization (Phase A) ----------------

test("V2.1: primary === null (the resolver's 'no provider usable at all' case) -> deterministic-safe outcome, zero dispatches, zero throws", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: true, summary: "must never run" });
  const openai = fakeAdapter("openai", { ok: true, summary: "must never run" });
  const r = router(registryOf(anthropic, openai), { primary: null, fallbackChain: [] });
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error, null, "the designed no-provider state, not a fabricated error");
  assert.equal(outcome.providerUnavailable, true);
  assert.equal(outcome.fallbackUsed, false);
  assert.equal(outcome.attemptCount, 0);
  assert.equal(anthropic.calls(), 0);
  assert.equal(openai.calls(), 0);
});

test("V2.1: a 3-entry fallbackChain (anthropic -> openai -> a third, test-only provider double) is capped at MAX_PROVIDER_ATTEMPTS=2 -- the third entry is NEVER dispatched to", async () => {
  // "gemini" is already a first-class member of IntelligenceProviderId
  // (types.ts's own documented future-provider list) -- using a FAKE
  // test-only adapter registered under it here is a pure, isolated unit
  // test of the router's attempt cap, not an integration of a real
  // Gemini provider (no adapter, no config, no env var, no real
  // registration anywhere outside this one test).
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "openai") });
  const geminiDouble = fakeAdapter("gemini", { ok: true, summary: "must never run -- beyond the attempt cap" });
  const r = router(registryOf(anthropic, openai, geminiDouble), { primary: "anthropic", fallbackChain: ["openai", "gemini"] });
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.attemptCount, MAX_PROVIDER_ATTEMPTS);
  assert.equal(anthropic.calls(), 1);
  assert.equal(openai.calls(), 1);
  assert.equal(geminiDouble.calls(), 0, "the third provider must never be dispatched to -- the cap is 2");
  assert.equal(outcome.advisory, null); // both attempted providers failed
});

test("V2.1: duplicate ids in fallbackChain are de-duplicated -- never attempted twice, never consuming an extra cap slot", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "openai") });
  const r = router(registryOf(anthropic, openai), { primary: "anthropic", fallbackChain: ["openai", "openai", "openai"] });
  const outcome = await r.run(REQUEST);
  assert.equal(openai.calls(), 1, "openai is attempted exactly once despite appearing three times in fallbackChain");
  assert.equal(outcome.attemptCount, 2);
});

test("V2.1: the primary repeated inside fallbackChain is never attempted a second time", async () => {
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const openai = fakeAdapter("openai", { ok: true, summary: "fallback ok" });
  const r = router(registryOf(anthropic, openai), { primary: "anthropic", fallbackChain: ["anthropic", "openai"] });
  const outcome = await r.run(REQUEST);
  assert.equal(anthropic.calls(), 1, "the primary is never re-attempted via its own presence in fallbackChain");
  assert.equal(outcome.advisory.provider, "openai");
  assert.equal(outcome.attemptCount, 2);
});

test("V2.1: a 3-provider chain where the middle entry is unregistered skips it for free (zero cap cost) and still reaches the third", async () => {
  // anthropic fails eligible -> "openai" is NOT registered (skipped, no
  // cap cost) -> the third entry ("gemini" test double) IS registered
  // and is attempted as the 2nd real dispatch.
  const anthropic = fakeAdapter("anthropic", { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", "anthropic") });
  const geminiDouble = fakeAdapter("gemini", { ok: true, summary: "third-in-chain fallback" });
  const r = router(registryOf(anthropic, geminiDouble), { primary: "anthropic", fallbackChain: ["openai", "gemini"] });
  const outcome = await r.run(REQUEST);
  assert.equal(outcome.advisory.provider, "gemini");
  assert.equal(outcome.attemptCount, 2, "the unregistered middle entry cost nothing; only anthropic + gemini were real dispatches");
  assert.equal(outcome.fallbackUsed, true);
});

test("V2.1: MAX_PROVIDER_ATTEMPTS is exactly 2", () => {
  assert.equal(MAX_PROVIDER_ATTEMPTS, 2);
});
