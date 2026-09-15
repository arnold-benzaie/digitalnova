// RADAR DISCOVERY ENGINE — Phase C-1 — rate-limit-gate.ts unit tests.
// @/lib/api-v1/rate-limit is mocked (no real DB) so this suite needs no
// live Postgres connection. Covers mission section 13 item Z (rate
// limit/quota) at the gate level.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/rate-limit-gate.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

let checkRateLimitCalls = [];
let nextResult = { allowed: true, limit: 10, remaining: 9, resetAt: new Date(), retryAfterSeconds: 0 };
let shouldThrow = false;

mock.module("@/lib/api-v1/rate-limit", {
  namedExports: {
    checkRateLimit: async (scope, identifier, limit, windowSeconds) => {
      checkRateLimitCalls.push({ scope, identifier, limit, windowSeconds });
      if (shouldThrow) throw new Error("simulated rate-limit store outage");
      return nextResult;
    },
  },
});

const { checkDiscoveryProviderRateLimit, DISCOVERY_RATE_LIMIT_MAX_REQUESTS, DISCOVERY_RATE_LIMIT_WINDOW_SECONDS } = await import("./rate-limit-gate.ts");

function reset() {
  checkRateLimitCalls = [];
  nextResult = { allowed: true, limit: 10, remaining: 9, resetAt: new Date(), retryAfterSeconds: 0 };
  shouldThrow = false;
}
test.beforeEach(reset);

test("Z. allowed -> {allowed: true}, exactly one underlying checkRateLimit call", async () => {
  const decision = await checkDiscoveryProviderRateLimit("google_places");
  assert.deepEqual(decision, { allowed: true });
  assert.equal(checkRateLimitCalls.length, 1);
});

test("Z. denied -> {allowed: false, retryAfterSeconds}", async () => {
  nextResult = { allowed: false, limit: 10, remaining: 0, resetAt: new Date(), retryAfterSeconds: 42 };
  const decision = await checkDiscoveryProviderRateLimit("google_places");
  assert.equal(decision.allowed, false);
  assert.equal(decision.retryAfterSeconds, 42);
});

test("Z. calls checkRateLimit with the exact scope/identifier/limit/window contract", async () => {
  await checkDiscoveryProviderRateLimit("google_places");
  assert.deepEqual(checkRateLimitCalls[0], {
    scope: "radar_discovery_provider",
    identifier: "google_places:global",
    limit: DISCOVERY_RATE_LIMIT_MAX_REQUESTS,
    windowSeconds: DISCOVERY_RATE_LIMIT_WINDOW_SECONDS,
  });
});

test("Z. a DIFFERENT providerId keys an independent window -- never shares a limit with another provider", async () => {
  await checkDiscoveryProviderRateLimit("some_other_provider");
  assert.equal(checkRateLimitCalls[0].identifier, "some_other_provider:global");
});

test("Z. FAIL-CLOSED: a store outage (checkRateLimit throws) denies the call, never allows it -- the opposite direction from G4D's advisory cooldown", async () => {
  shouldThrow = true;
  const decision = await checkDiscoveryProviderRateLimit("google_places");
  assert.equal(decision.allowed, false);
  assert.equal(typeof decision.retryAfterSeconds, "number");
});

test("Z. never throws -- a store outage resolves to a deny, never rejects the caller's own await", async () => {
  shouldThrow = true;
  await assert.doesNotReject(() => checkDiscoveryProviderRateLimit("google_places"));
});
