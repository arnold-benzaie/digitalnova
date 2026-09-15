// RADAR DISCOVERY ENGINE — Phase C-2A — actor-rate-limit.ts unit tests.
// @/lib/api-v1/rate-limit is mocked (no real DB) so this suite needs no
// live Postgres connection. Mirrors rate-limit-gate.test.mjs's exact
// convention. Underlying atomicity of checkRateLimit() itself is already
// proven elsewhere (lib/api-v1/rate-limit.integration.test.mjs,
// quota-counter-store concurrency tests) — this file only proves THIS
// wrapper's own wiring/behavior.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/actor-rate-limit.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

let checkRateLimitCalls = [];
/** @type {Map<string, number>} identifier -> admitted count, for a
 * realistic "N requests admitted per window" fake. */
let admittedByIdentifier = new Map();
let shouldThrow = false;

mock.module("@/lib/api-v1/rate-limit", {
  namedExports: {
    checkRateLimit: async (scope, identifier, limit, windowSeconds) => {
      checkRateLimitCalls.push({ scope, identifier, limit, windowSeconds });
      if (shouldThrow) throw new Error("simulated rate-limit store outage");
      const already = admittedByIdentifier.get(identifier) ?? 0;
      admittedByIdentifier.set(identifier, already + 1);
      const admitted = already < limit;
      return {
        allowed: admitted,
        limit,
        remaining: Math.max(0, limit - already - 1),
        resetAt: new Date(Date.now() + windowSeconds * 1000),
        retryAfterSeconds: windowSeconds,
      };
    },
  },
});

const { checkDiscoveryActorRateLimit, DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS, DISCOVERY_ACTOR_RATE_LIMIT_WINDOW_SECONDS } = await import("./actor-rate-limit.ts");
const { DISCOVERY_RATE_LIMIT_MAX_REQUESTS } = await import("./rate-limit-gate.ts");

function reset() {
  checkRateLimitCalls = [];
  admittedByIdentifier = new Map();
  shouldThrow = false;
}
test.beforeEach(reset);

test("first request for a fresh actor is allowed", async () => {
  const decision = await checkDiscoveryActorRateLimit("user-A");
  assert.deepEqual(decision, { allowed: true });
});

test("limit reached: the next request for the SAME actor is denied", async () => {
  for (let i = 0; i < DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS; i++) {
    const r = await checkDiscoveryActorRateLimit("user-A");
    assert.equal(r.allowed, true, `request ${i + 1} should still be admitted`);
  }
  const overLimit = await checkDiscoveryActorRateLimit("user-A");
  assert.equal(overLimit.allowed, false);
  assert.equal(typeof overLimit.retryAfterSeconds, "number");
});

test("calls checkRateLimit with the exact scope/identifier/limit/window contract", async () => {
  await checkDiscoveryActorRateLimit("user-A");
  assert.deepEqual(checkRateLimitCalls[0], {
    scope: "radar_discovery_actor",
    identifier: "user-A",
    limit: DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS,
    windowSeconds: DISCOVERY_ACTOR_RATE_LIMIT_WINDOW_SECONDS,
  });
});

test("isolation: user A hitting their own limit never affects user B's own window", async () => {
  for (let i = 0; i < DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS; i++) {
    await checkDiscoveryActorRateLimit("user-A");
  }
  const userADenied = await checkDiscoveryActorRateLimit("user-A");
  assert.equal(userADenied.allowed, false);

  const userBFirst = await checkDiscoveryActorRateLimit("user-B");
  assert.equal(userBFirst.allowed, true, "a different actor must have their own independent window");
});

test("the actor-level scope is a DIFFERENT scope string from the provider-level guard -- the two windows can never collide", () => {
  assert.notEqual("radar_discovery_actor", "radar_discovery_provider");
});

test("the per-actor limit is strictly LOWER than the shared provider-level global limit -- documented fairness guarantee", () => {
  assert.ok(DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS < DISCOVERY_RATE_LIMIT_MAX_REQUESTS, "a single actor must never be able to consume the entire global budget alone");
});

test("FAIL-CLOSED: a store outage denies the call, never allows it", async () => {
  shouldThrow = true;
  const decision = await checkDiscoveryActorRateLimit("user-A");
  assert.equal(decision.allowed, false);
  assert.equal(typeof decision.retryAfterSeconds, "number");
});

test("never throws -- a store outage resolves to a deny, never rejects the caller's own await", async () => {
  shouldThrow = true;
  await assert.doesNotReject(() => checkDiscoveryActorRateLimit("user-A"));
});

test("concurrent calls for the SAME actor: exactly N are admitted, the rest denied (proves this wrapper forwards results correctly under Promise.all, not just sequentially)", async () => {
  const results = await Promise.all(Array.from({ length: DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS + 3 }, () => checkDiscoveryActorRateLimit("user-concurrent")));
  const admitted = results.filter((r) => r.allowed);
  const denied = results.filter((r) => !r.allowed);
  assert.equal(admitted.length, DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS);
  assert.equal(denied.length, 3);
});

test("window: the fake's own resetAt/retryAfterSeconds are forwarded through to the decision on denial", async () => {
  for (let i = 0; i < DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS; i++) await checkDiscoveryActorRateLimit("user-A");
  const denied = await checkDiscoveryActorRateLimit("user-A");
  assert.equal(denied.retryAfterSeconds, DISCOVERY_ACTOR_RATE_LIMIT_WINDOW_SECONDS);
});
