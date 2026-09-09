// RADAR INTELLIGENCE PLATFORM V1 — Slice 1 — foundation unit tests.
//
// Pure logic only: no DB, no network, no provider. Proves the provider-
// agnostic architecture holds:
//   - registry: rejects duplicates / invalid adapters; lists in order
//   - deterministic fallback: no capabilities, DISCONNECTED, no fabrication
//   - selection policy: preferred / fallback order / capability / disabled /
//     health / circuit gating
//   - error model: stable codes, safe messages, raw errors normalized
//   - policy: finite timeout, bounded retries, retryable set
//   - circuit breaker: CLOSED -> OPEN -> HALF_OPEN transitions (pure)
//   - gateway: always resolves a safe IntelligenceOutcome; no-provider is
//     a clean non-error state; a well-formed request never throws
//   - snapshot: deterministic basis preserved verbatim; advisory=null;
//     advisoryStatus="NONE"; providerAvailable=false
//   - an unavailable/failing provider NEVER breaks the RADAR result
//
// Run: npx tsx --test lib/radar-intelligence/foundation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INTELLIGENCE_ERROR_CODES,
  SAFE_ERROR_MESSAGES,
  RETRYABLE_ERROR_CODES,
  makeIntelligenceError,
  toIntelligenceError,
} from "./errors.ts";
import {
  DEFAULT_POLICY,
  DEFAULT_TIMEOUT_MS,
  MAX_ALLOWED_RETRIES,
  resolvePolicy,
  isRetryable,
  retryDelayMs,
} from "./policy.ts";
import { initCircuit, canAttempt, beginProbe, recordFailure, recordSuccess } from "./circuit-breaker.ts";
import { createProviderRegistry } from "./provider-registry.ts";
import { deterministicFallbackAdapter, deterministicOutcome } from "./deterministic-fallback.ts";
import { createRadarIntelligenceGateway, createDefaultRegistry } from "./gateway.ts";
import { buildRadarIntelligenceSnapshot } from "./snapshot.ts";
import { sanitizeProspectContext } from "./sanitize-context.ts";
import { buildTelemetryEvent } from "./telemetry.ts";
import { INTEGRATION_DOMAINS, assertIntelligenceDomain } from "./integration-domains.ts";

const FIXED_NOW = new Date("2026-09-10T12:00:00.000Z");
const clock = () => FIXED_NOW;
const ids = (() => {
  let n = 0;
  return () => `req-${(n += 1)}`;
})();

const SANITIZED = sanitizeProspectContext({
  prospectName: "Boulangerie Lefèvre",
  company: "Lefèvre SARL",
  sector: "bakery",
  location: "Lyon, FR",
  stage: "prospect",
  deterministicPriority: "HIGH",
  deterministicConfidence: "MEDIUM",
  deterministicReasonCodes: ["DEAL_STAGE_PROPOSAL", "INTERACTION_RECENT"],
  recommendedNextActionCode: "FOLLOW_UP_PROPOSAL",
  recentInteractionSummaries: ["Called about the proposal."],
  openFollowUpCount: 1,
  nextFollowUpDueOn: "2026-09-15",
});

// ======================= errors =======================

test("errors: every code has a safe, non-empty, interpolation-free message", () => {
  for (const code of INTELLIGENCE_ERROR_CODES) {
    const msg = SAFE_ERROR_MESSAGES[code];
    assert.equal(typeof msg, "string");
    assert.ok(msg.length > 0);
    assert.ok(!/\$\{|%s|undefined|\bkey\b|token|secret/i.test(msg), `message for ${code} looks unsafe: ${msg}`);
  }
});

test("errors: makeIntelligenceError carries the safe message + retryable flag", () => {
  const e = makeIntelligenceError("PROVIDER_TIMEOUT", "openai");
  assert.deepEqual(e, {
    code: "PROVIDER_TIMEOUT",
    providerId: "openai",
    retryable: true,
    message: SAFE_ERROR_MESSAGES.PROVIDER_TIMEOUT,
  });
  assert.equal(makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST").retryable, false);
});

test("errors: toIntelligenceError normalizes ANY thrown value — no raw text leaks", () => {
  const abort = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443 sk_live_deadbeef"), { name: "AbortError" });
  assert.equal(toIntelligenceError(abort, "anthropic").code, "PROVIDER_TIMEOUT");

  const rateLimited = { status: 429, body: "Retry-After: 60; org_abc; key=sk_live_x" };
  assert.equal(toIntelligenceError(rateLimited, "gemini").code, "PROVIDER_RATE_LIMITED");

  const unavailable = { status: 503 };
  assert.equal(toIntelligenceError(unavailable).code, "PROVIDER_UNAVAILABLE");

  const weird = { message: "DATABASE_URL=postgres://u:p@h/db", stack: "at secretThing()" };
  const mapped = toIntelligenceError(weird, "deepseek");
  assert.equal(mapped.code, "PROVIDER_ERROR");
  assert.equal(mapped.message, SAFE_ERROR_MESSAGES.PROVIDER_ERROR);
  assert.ok(!JSON.stringify(mapped).includes("DATABASE_URL"));
  assert.ok(!JSON.stringify(mapped).includes("secretThing"));
});

test("errors: RETRYABLE_ERROR_CODES is exactly the transient set", () => {
  assert.deepEqual([...RETRYABLE_ERROR_CODES].sort(), ["PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE"]);
});

// ======================= policy =======================

test("policy: DEFAULT_POLICY has a finite timeout and a small bounded retry count", () => {
  assert.equal(DEFAULT_POLICY.timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.ok(Number.isFinite(DEFAULT_POLICY.timeoutMs) && DEFAULT_POLICY.timeoutMs > 0);
  assert.ok(DEFAULT_POLICY.maxRetries >= 0 && DEFAULT_POLICY.maxRetries <= MAX_ALLOWED_RETRIES);
  assert.equal(Object.isFrozen(DEFAULT_POLICY), true);
});

test("policy: resolvePolicy clamps hostile values — never unbounded", () => {
  const p = resolvePolicy({ timeoutMs: Number.POSITIVE_INFINITY, maxRetries: 9999, retryBaseDelayMs: -5 });
  assert.ok(Number.isFinite(p.timeoutMs) && p.timeoutMs <= 60_000);
  assert.equal(p.maxRetries, MAX_ALLOWED_RETRIES);
  assert.equal(p.retryBaseDelayMs, 0);
  const z = resolvePolicy({ timeoutMs: 0, maxRetries: -3 });
  assert.ok(z.timeoutMs >= 250);
  assert.equal(z.maxRetries, 0);
});

test("policy: isRetryable / retryDelayMs", () => {
  assert.equal(isRetryable("PROVIDER_TIMEOUT"), true);
  assert.equal(isRetryable("NO_CAPABLE_PROVIDER"), false);
  assert.equal(retryDelayMs(0), DEFAULT_POLICY.retryBaseDelayMs);
  assert.ok(retryDelayMs(2) >= retryDelayMs(1));
  assert.ok(retryDelayMs(50) <= 60_000);
});

// ======================= circuit breaker =======================

test("circuit: starts CLOSED and allows attempts", () => {
  const c = initCircuit();
  assert.equal(c.state, "CLOSED");
  assert.equal(canAttempt(c, 0), true);
});

test("circuit: CLOSED -> OPEN at the failure threshold, then blocks until cooldown", () => {
  const cfg = { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxProbes: 1 };
  let c = initCircuit();
  c = recordFailure(c, 0, cfg);
  c = recordFailure(c, 0, cfg);
  assert.equal(c.state, "CLOSED");
  c = recordFailure(c, 100, cfg);
  assert.equal(c.state, "OPEN");
  assert.equal(c.openedAt, 100);
  assert.equal(canAttempt(c, 500, cfg), false); // within cooldown
  assert.equal(canAttempt(c, 1100, cfg), true); // cooldown elapsed
});

test("circuit: OPEN(cooled) -> HALF_OPEN on beginProbe; success -> CLOSED; failure -> OPEN", () => {
  const cfg = { failureThreshold: 2, cooldownMs: 1000, halfOpenMaxProbes: 1 };
  let c = recordFailure(recordFailure(initCircuit(), 0, cfg), 0, cfg);
  assert.equal(c.state, "OPEN");
  c = beginProbe(c, 2000, cfg);
  assert.equal(c.state, "HALF_OPEN");
  assert.equal(canAttempt(c, 2000, cfg), false, "one probe already consumed");
  // half-open failure re-opens immediately
  const reopened = recordFailure(c, 2500, cfg);
  assert.equal(reopened.state, "OPEN");
  assert.equal(reopened.openedAt, 2500);
  // half-open success closes
  const closed = recordSuccess();
  assert.equal(closed.state, "CLOSED");
  assert.equal(closed.consecutiveFailures, 0);
});

// ======================= registry =======================

test("registry: seeds nothing by default; createDefaultRegistry seeds only the deterministic fallback", () => {
  const empty = createProviderRegistry();
  assert.deepEqual(empty.list(), []);

  const reg = createDefaultRegistry();
  assert.deepEqual(reg.list().map((a) => a.id), ["deterministic"]);
  assert.equal(reg.has("openai"), false);
  assert.equal(reg.get("deterministic")?.capabilities().length, 0);
});

test("registry: rejects a duplicate id", () => {
  const reg = createDefaultRegistry();
  const again = reg.register(deterministicFallbackAdapter);
  assert.equal(again.ok, false);
  assert.match(again.reason, /already registered/);
});

test("registry: rejects an invalid adapter (bad id / missing methods)", () => {
  const reg = createProviderRegistry();
  assert.equal(reg.register({ id: "not-a-provider", health() {}, capabilities() {}, run() {} }).ok, false);
  assert.equal(reg.register({ id: "openai" }).ok, false);
  assert.equal(reg.register({ id: "openai", health() {}, capabilities: () => ["telepathy"], run: async () => {} }).ok, false);
});

test("registry: selection returns NO_CAPABLE_PROVIDER when only the deterministic fallback is present", () => {
  const reg = createDefaultRegistry();
  const sel = reg.selectProvider({ requiredCapabilities: ["summarize"], now: 0 });
  assert.equal(sel.ok, false);
  assert.equal(sel.error.code, "NO_CAPABLE_PROVIDER");
});

test("registry: selection honors preferred, fallback order, capability, disabled and health", () => {
  const reg = createProviderRegistry();
  const mk = (id, caps, { disabled = false, health = "HEALTHY", connection = "CONNECTED" } = {}) => ({
    id,
    disabled,
    health: () => ({ id, connection, health, capabilities: caps, lastCheckedAt: null }),
    capabilities: () => caps,
    run: async () => ({ ok: false, error: makeIntelligenceError("PROVIDER_ERROR", id) }),
  });
  reg.register(mk("openai", ["summarize", "generate"]));
  reg.register(mk("anthropic", ["summarize"]));
  reg.register(mk("gemini", ["summarize"], { disabled: true }));
  reg.register(mk("deepseek", ["summarize"], { health: "UNHEALTHY" }));

  // default (registration) order -> openai
  assert.equal(reg.selectProvider({ requiredCapabilities: ["summarize"], now: 0 }).adapter.id, "openai");
  // preferred wins if eligible
  assert.equal(
    reg.selectProvider({ requiredCapabilities: ["summarize"], preferredProviderId: "anthropic", now: 0 }).adapter.id,
    "anthropic",
  );
  // explicit fallback order
  assert.equal(
    reg.selectProvider({ requiredCapabilities: ["summarize"], fallbackOrder: ["anthropic", "openai"], now: 0 }).adapter.id,
    "anthropic",
  );
  // capability requirement filters
  assert.equal(reg.selectProvider({ requiredCapabilities: ["generate"], now: 0 }).adapter.id, "openai");
  assert.equal(reg.selectProvider({ requiredCapabilities: ["classify"], now: 0 }).ok, false);
  // disabled + unhealthy are skipped; with only those eligible -> DISABLED wins the reason
  const only = createProviderRegistry();
  only.register(mk("gemini", ["summarize"], { disabled: true }));
  assert.equal(only.selectProvider({ requiredCapabilities: ["summarize"], now: 0 }).error.code, "PROVIDER_DISABLED");
  // empty requiredCapabilities -> INVALID
  assert.equal(reg.selectProvider({ requiredCapabilities: [], now: 0 }).error.code, "INVALID_INTELLIGENCE_REQUEST");
});

// ======================= gateway (no provider) =======================

test("gateway: a well-formed request resolves the clean no-provider outcome — never throws, never an error", async () => {
  const gw = createRadarIntelligenceGateway({ clock, generateRequestId: ids });
  const outcome = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: SANITIZED });
  assert.equal(outcome.providerId, "deterministic");
  assert.equal(outcome.connection, "DISCONNECTED");
  assert.equal(outcome.providerUnavailable, true);
  assert.equal(outcome.source, "radar-core");
  assert.equal(outcome.advisory, null); // NEVER fabricated
  assert.equal(outcome.error, null); // no-provider is NOT an error
  assert.equal(outcome.generatedAt, FIXED_NOW.toISOString());
});

test("gateway: an invalid request maps to a safe INVALID_INTELLIGENCE_REQUEST error (no throw)", async () => {
  const gw = createRadarIntelligenceGateway({ clock, generateRequestId: ids });
  const bad = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: { prospectName: "x" } });
  assert.equal(bad.error?.code, "INVALID_INTELLIGENCE_REQUEST");
  assert.equal(bad.advisory, null);

  const badKind = await gw.run({ kind: "telepathy", requiredCapabilities: ["telepathy"], context: SANITIZED });
  assert.equal(badKind.error?.code, "INVALID_INTELLIGENCE_REQUEST");
});

test("gateway: fallbackOutcome() is the pure no-provider outcome", () => {
  const gw = createRadarIntelligenceGateway({ clock, generateRequestId: ids });
  const o = gw.fallbackOutcome();
  assert.equal(o.providerUnavailable, true);
  assert.equal(o.advisory, null);
  assert.equal(o.error, null);
  assert.deepEqual(deterministicOutcome("r", FIXED_NOW.toISOString()).source, "radar-core");
});

test("gateway: a future provider that FAILS never yields an advisory and never throws", async () => {
  const reg = createDefaultRegistry();
  reg.register({
    id: "openai",
    health: () => ({ id: "openai", connection: "CONNECTED", health: "HEALTHY", capabilities: ["summarize"], lastCheckedAt: null }),
    capabilities: () => ["summarize"],
    run: async () => {
      throw Object.assign(new Error("boom sk_live_leak"), { name: "AbortError" });
    },
  });
  const gw = createRadarIntelligenceGateway({
    registry: reg,
    clock,
    generateRequestId: ids,
    policy: { ...DEFAULT_POLICY, maxRetries: 1, retryBaseDelayMs: 0 },
  });
  const outcome = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: SANITIZED });
  assert.equal(outcome.advisory, null);
  assert.equal(outcome.error?.code, "PROVIDER_TIMEOUT");
  assert.ok(!JSON.stringify(outcome).includes("sk_live_leak"));
  assert.equal(outcome.providerUnavailable, true);
});

test("gateway: a future provider that SUCCEEDS is forced to advisory:true", async () => {
  const reg = createDefaultRegistry();
  reg.register({
    id: "openai",
    health: () => ({ id: "openai", connection: "CONNECTED", health: "HEALTHY", capabilities: ["summarize"], lastCheckedAt: null }),
    capabilities: () => ["summarize"],
    // adapter tries to claim a non-advisory result — gateway overrides it
    run: async () => ({ ok: true, advisory: { advisory: false, provider: "openai", status: "CONNECTED", generatedAt: "x", summary: "hi" } }),
  });
  const gw = createRadarIntelligenceGateway({ registry: reg, clock, generateRequestId: ids });
  const outcome = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: SANITIZED });
  assert.equal(outcome.advisory?.advisory, true);
  assert.equal(outcome.source, "provider");
});

// ======================= snapshot =======================

const DET = {
  priority: "HIGH",
  confidence: "MEDIUM",
  reasons: [{ code: "DEAL_STAGE_PROPOSAL" }, { code: "INDUSTRY_RECORDED", value: "bakery" }],
  recommendedNextAction: "FOLLOW_UP_PROPOSAL",
  qualificationStatus: "QUALIFIED",
};

test("snapshot: deterministic basis is preserved VERBATIM, deep-copied (no aliasing)", async () => {
  const snap = await buildRadarIntelligenceSnapshot({
    deterministic: DET,
    display: { prospectName: "Boulangerie Lefèvre", stage: "prospect", sector: "bakery" },
  });
  assert.deepEqual(snap.deterministic, DET);
  assert.notEqual(snap.deterministic.reasons, DET.reasons, "reasons array must be a copy");
  assert.notEqual(snap.deterministic.reasons[0], DET.reasons[0], "reason objects must be copies");
  // mutating the snapshot cannot reach the source
  snap.deterministic.priority = "LOW";
  snap.deterministic.reasons.push({ code: "PAID_INVOICE" });
  assert.equal(DET.priority, "HIGH");
  assert.equal(DET.reasons.length, 2);
});

test("snapshot: no provider -> advisoryStatus NONE, intelligence null, providerAvailable false", async () => {
  const snap = await buildRadarIntelligenceSnapshot({
    deterministic: DET,
    display: { prospectName: "X", stage: "lead" },
  });
  assert.equal(snap.providerAvailable, false);
  assert.equal(snap.advisoryStatus, "NONE");
  assert.equal(snap.intelligence, null);
  assert.equal(snap.providerUnavailable, true);
  assert.equal(snap.source, "radar-core");
});

test("snapshot: an unavailable/broken gateway NEVER breaks the RADAR result", async () => {
  // gateway whose registry has a provider that always throws
  const reg = createDefaultRegistry();
  reg.register({
    id: "openai",
    health: () => ({ id: "openai", connection: "CONNECTED", health: "HEALTHY", capabilities: ["summarize"], lastCheckedAt: null }),
    capabilities: () => ["summarize"],
    run: async () => {
      throw new Error("total meltdown");
    },
  });
  const gw = createRadarIntelligenceGateway({ registry: reg, clock, generateRequestId: ids, policy: { ...DEFAULT_POLICY, maxRetries: 0 } });
  const snap = await buildRadarIntelligenceSnapshot({ deterministic: DET, display: { prospectName: "X", stage: "lead" } }, { gateway: gw });
  // deterministic values still intact and authoritative
  assert.deepEqual(snap.deterministic, DET);
  assert.equal(snap.intelligence, null);
  assert.equal(snap.providerAvailable, false);
});

// ======================= telemetry & domains =======================

test("telemetry: event carries only correlation/timing/status — never a summary or context", async () => {
  const gw = createRadarIntelligenceGateway({ clock, generateRequestId: ids });
  const outcome = await gw.run({ kind: "summarize", requiredCapabilities: ["summarize"], context: SANITIZED });
  const ev = buildTelemetryEvent(outcome, { capability: "summarize", latencyMs: 12.9 });
  assert.deepEqual(Object.keys(ev).sort(), ["at", "capability", "errorCode", "latencyMs", "provider", "requestId", "status", "usage"].sort());
  assert.equal(ev.status, "fallback");
  assert.equal(ev.latencyMs, 12);
  assert.ok(!JSON.stringify(ev).toLowerCase().includes("boulangerie"));
});

test("integration-domains: the three domains are distinct and the registry guard rejects non-intelligence", () => {
  assert.deepEqual([...INTEGRATION_DOMAINS], ["INTELLIGENCE_PROVIDER", "DATA_SOURCE", "ACTION_CONNECTOR"]);
  assert.doesNotThrow(() => assertIntelligenceDomain("INTELLIGENCE_PROVIDER"));
  assert.throws(() => assertIntelligenceDomain("DATA_SOURCE"), /only INTELLIGENCE_PROVIDER/);
  assert.throws(() => assertIntelligenceDomain("ACTION_CONNECTOR"), /only INTELLIGENCE_PROVIDER/);
});
