// RADAR DISCOVERY ENGINE — Phase C-1 — observability.ts unit tests. Pure,
// no mocks, no network. Covers mission section 13 item G (no secret leak
// in logs) and section 19 (allowed/forbidden log fields).
//
// Run: npx tsx --test lib/radar-discovery/observability.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { logDiscoveryProviderEvent } from "./observability.ts";

function withCapturedWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => calls.push(args);
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

test("logs the exact allowlisted fields for a success event", () => {
  const calls = withCapturedWarn(() => {
    logDiscoveryProviderEvent({ providerId: "google_places", outcome: "success", latencyMs: 120, resultCount: 5, attemptCount: 1, circuitState: "connected" });
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { providerId: "google_places", outcome: "success", latencyMs: 120, resultCount: 5, attemptCount: 1, circuitState: "connected" });
});

test("logs the exact allowlisted fields for a failure event", () => {
  const calls = withCapturedWarn(() => {
    logDiscoveryProviderEvent({ providerId: "google_places", outcome: "failure", errorCode: "PROVIDER_TIMEOUT", latencyMs: 8000, attemptCount: 2 });
  });
  assert.deepEqual(calls[0][1], { providerId: "google_places", outcome: "failure", errorCode: "PROVIDER_TIMEOUT", latencyMs: 8000, attemptCount: 2 });
});

test("G. an attacker-shaped event object with a hostile extra field never reaches the log line -- allowlist rebuild, never a spread", () => {
  const hostile = {
    providerId: "google_places",
    outcome: "success",
    latencyMs: 10,
    attemptCount: 1,
    apiKey: "AIzaHostileLeakedKeyDoNotPrint",
    authorization: "Bearer hostile-secret",
  };
  const calls = withCapturedWarn(() => logDiscoveryProviderEvent(hostile));
  const logged = JSON.stringify(calls[0][1]);
  assert.ok(!logged.includes("AIzaHostileLeakedKeyDoNotPrint"));
  assert.ok(!logged.includes("hostile-secret"));
  assert.ok(!("apiKey" in calls[0][1]));
  assert.ok(!("authorization" in calls[0][1]));
});

test("an invalid errorCode (not in the closed set) is dropped, never logged verbatim", () => {
  const calls = withCapturedWarn(() => {
    logDiscoveryProviderEvent({ providerId: "google_places", outcome: "failure", errorCode: "NOT_A_REAL_CODE", latencyMs: 10, attemptCount: 1 });
  });
  assert.ok(!("errorCode" in calls[0][1]));
});

test("an invalid circuitState is dropped, never logged verbatim", () => {
  const calls = withCapturedWarn(() => {
    logDiscoveryProviderEvent({ providerId: "google_places", outcome: "success", latencyMs: 10, attemptCount: 1, circuitState: "bogus_state" });
  });
  assert.ok(!("circuitState" in calls[0][1]));
});

test("negative or non-integer latency/resultCount/attemptCount are dropped, never logged as-is", () => {
  const calls = withCapturedWarn(() => {
    logDiscoveryProviderEvent({ providerId: "google_places", outcome: "success", latencyMs: -5, resultCount: 1.5, attemptCount: 1 });
  });
  assert.ok(!("latencyMs" in calls[0][1]));
  assert.ok(!("resultCount" in calls[0][1]));
  assert.equal(calls[0][1].attemptCount, 1);
});

test("never throws on a well-formed event", () => {
  assert.doesNotThrow(() => {
    withCapturedWarn(() => logDiscoveryProviderEvent({ providerId: "google_places", outcome: "success", latencyMs: 1, attemptCount: 1 }));
  });
});
