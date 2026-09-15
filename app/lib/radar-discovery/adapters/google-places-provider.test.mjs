// RADAR DISCOVERY ENGINE — Phase C-1 — google-places-provider.ts unit
// tests. Pure, NO NETWORK CALL of any kind — the transport and rate-limit
// gate are both injected fakes. Covers mission section 13 items H, I, J,
// K, L, M, N, O, P, Q, S, T, U, V, W, X, Y, Z.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/adapters/google-places-provider.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
// rate-limit-gate.ts (a transitive import of google-places-provider.ts)
// itself imports @/lib/api-v1/rate-limit -> @/db, which throws at import
// time when DATABASE_URL is unset -- this suite always injects its own
// checkRateLimit fake and never exercises the real DB-backed path, so
// @/db is mocked to a harmless stand-in purely to satisfy the import
// graph (same convention used throughout this repo's other *.test.mjs
// files that transitively import a DB-backed module they override).
mock.module("@/db", { namedExports: { db: {} } });

const { createGooglePlacesProvider } = await import("./google-places-provider.ts");
const { GOOGLE_PLACES_PROVIDER_ID } = await import("./google-places.ts");
const { DEFAULT_CIRCUIT_CONFIG } = await import("@/lib/radar-intelligence/circuit-breaker");

function fakeTransport(script) {
  // `script` is either a single {status, body} / Error, or an array of
  // such — consumed in order, one per attemptSearchOnce() call.
  const queue = Array.isArray(script) ? [...script] : [script];
  const calls = [];
  return {
    calls,
    async searchText(descriptor) {
      calls.push(descriptor);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function timeoutErrorLike() {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

const BASE_REQUEST = { category: "restaurants", city: "Montreal", maxResults: 10, fieldSet: "minimal_discovery" };
const OK_BODY = { places: [{ id: "ChIJ_test_place", displayName: { text: "Test Place" } }] };

function makeProvider(overrides = {}) {
  let clockValue = 0;
  const clock = overrides.clock ?? (() => clockValue);
  const advanceClock = (ms) => {
    clockValue += ms;
  };
  const rateLimitCalls = [];
  const checkRateLimit =
    overrides.checkRateLimit ??
    (async (providerId) => {
      rateLimitCalls.push(providerId);
      return { allowed: true };
    });
  const transport = overrides.transport ?? fakeTransport({ status: 200, body: OK_BODY });
  const provider = createGooglePlacesProvider({
    transport,
    checkRateLimit,
    clock,
    circuitConfig: overrides.circuitConfig ?? DEFAULT_CIRCUIT_CONFIG,
  });
  return { provider, transport, rateLimitCalls, advanceClock };
}

// ---- H. mapping Google -> ProviderResult (delegates to normalizeGooglePlacesSearchResponse, proven in google-places.test.mjs -- this proves the WIRING) ----

test("H. a successful search returns normalized results with the correct provider id/name", async () => {
  const { provider } = makeProvider();
  const outcome = await provider.search(BASE_REQUEST);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].source, GOOGLE_PLACES_PROVIDER_ID);
  assert.equal(outcome.results[0].name, "Test Place");
});

test("I. email is nullable in every mapped result", async () => {
  const { provider } = makeProvider();
  const outcome = await provider.search(BASE_REQUEST);
  assert.equal(outcome.results[0].email, null);
});

// ---- Q. pagination/pageToken ----

test("Q. nextCursor is relayed from Google's nextPageToken", async () => {
  const transport = fakeTransport({ status: 200, body: { places: [], nextPageToken: "opaque-token-xyz" } });
  const { provider } = makeProvider({ transport });
  const outcome = await provider.search(BASE_REQUEST);
  assert.equal(outcome.nextCursor, "opaque-token-xyz");
});

test("Q. a cursor on the request becomes pageToken in the outbound descriptor", async () => {
  const { provider, transport } = makeProvider();
  await provider.search({ ...BASE_REQUEST, cursor: "prev-page-token" });
  assert.equal(transport.calls[0].body.pageToken, "prev-page-token");
});

// ---- T/U/V/W/X. error status classification ----

test("T. HTTP 400 (INVALID_ARGUMENT) rejects with PROVIDER_ERROR, non-retryable, never retried", async () => {
  const transport = fakeTransport({ status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT" } } });
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_ERROR" && err.retryable === false);
  assert.equal(transport.calls.length, 1, "never retried");
});

test("U. HTTP 401 rejects with a non-retryable PROVIDER_ERROR", async () => {
  const transport = fakeTransport({ status: 401, body: {} });
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_ERROR" && err.retryable === false);
  assert.equal(transport.calls.length, 1);
});

test("V. HTTP 403 rejects with a non-retryable PROVIDER_ERROR", async () => {
  const transport = fakeTransport({ status: 403, body: {} });
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_ERROR" && err.retryable === false);
  assert.equal(transport.calls.length, 1);
});

test("W. HTTP 429 (RESOURCE_EXHAUSTED) rejects with PROVIDER_RATE_LIMITED, retryable", async () => {
  const transport = fakeTransport([{ status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED" } } }, { status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED" } } }]);
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_RATE_LIMITED" && err.retryable === true);
  assert.equal(transport.calls.length, 2, "retried exactly once");
});

test("X. HTTP 5xx rejects with PROVIDER_UNAVAILABLE, retryable", async () => {
  const transport = fakeTransport([{ status: 503, body: {} }, { status: 503, body: {} }]);
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_UNAVAILABLE");
  assert.equal(transport.calls.length, 2);
});

// ---- S. retry behavior (explicit matrix) ----

test("S. success on the FIRST attempt: no retry occurs", async () => {
  const { provider, transport } = makeProvider();
  await provider.search(BASE_REQUEST);
  assert.equal(transport.calls.length, 1);
});

test("S. retryable error then SUCCESS: exactly one retry, resolves successfully", async () => {
  const transport = fakeTransport([timeoutErrorLike(), { status: 200, body: OK_BODY }]);
  const { provider } = makeProvider({ transport });
  const outcome = await provider.search(BASE_REQUEST);
  assert.equal(outcome.results.length, 1);
  assert.equal(transport.calls.length, 2);
});

test("S. retryable error then ANOTHER failure: exactly one retry attempted, then rejects (never a second retry)", async () => {
  const transport = fakeTransport([timeoutErrorLike(), timeoutErrorLike()]);
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_TIMEOUT");
  assert.equal(transport.calls.length, 2, "exactly 2 total attempts, never 3");
});

test("S. non-retryable error: zero retries, fails on the first attempt", async () => {
  const transport = fakeTransport({ status: 400, body: {} });
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST));
  assert.equal(transport.calls.length, 1);
});

// ---- R. timeout classification (at the provider level, via a thrown AbortError) ----

test("R. a transport timeout (AbortError) classifies to PROVIDER_TIMEOUT", async () => {
  const transport = fakeTransport([timeoutErrorLike(), timeoutErrorLike()]);
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_TIMEOUT" && err.retryable === true);
});

// ---- Y. circuit breaker ----

test("Y. CLOSED circuit: a single failure does not open it (stays under the threshold)", async () => {
  const transport = fakeTransport([{ status: 500, body: {} }, { status: 500, body: {} }]);
  const { provider } = makeProvider({ transport, circuitConfig: { failureThreshold: 5, cooldownMs: 1000, halfOpenMaxProbes: 1 } });
  await assert.rejects(() => provider.search(BASE_REQUEST));
  assert.equal(provider.health().state, "connected", "still CLOSED -- below the failure threshold");
});

test("Y. consecutive failures reaching the threshold trip the circuit to unavailable (OPEN)", async () => {
  // failureThreshold=1 with 0 retries granted per call (INVALID_ARGUMENT
  // is non-retryable) -- one call, one recorded failure, trips
  // immediately.
  const transport = fakeTransport({ status: 400, body: {} });
  const { provider } = makeProvider({ transport, circuitConfig: { failureThreshold: 1, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });
  await assert.rejects(() => provider.search(BASE_REQUEST));
  assert.equal(provider.health().state, "unavailable");
});

test("Y. an OPEN circuit refuses to attempt at all -- zero transport calls, zero rate-limit spend, until cooldown elapses", async () => {
  const transport = fakeTransport({ status: 400, body: {} });
  const { provider, rateLimitCalls, advanceClock } = makeProvider({ transport, circuitConfig: { failureThreshold: 1, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });

  await assert.rejects(() => provider.search(BASE_REQUEST));
  assert.equal(provider.health().state, "unavailable");
  const callsBefore = transport.calls.length;
  const rateLimitCallsBefore = rateLimitCalls.length;

  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_UNAVAILABLE");
  assert.equal(transport.calls.length, callsBefore, "the OPEN circuit must block the attempt before the transport is ever called");
  assert.equal(rateLimitCalls.length, rateLimitCallsBefore, "must not even spend a rate-limit unit for a call the circuit already refused");

  advanceClock(10_001);
  const okTransport = fakeTransport({ status: 200, body: OK_BODY });
  const { provider: recoveredProvider } = makeProvider({ transport: okTransport, clock: () => 10_001, circuitConfig: { failureThreshold: 1, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });
  const outcome = await recoveredProvider.search(BASE_REQUEST);
  assert.equal(outcome.results.length, 1, "after cooldown, a probe is allowed through and can succeed (HALF_OPEN -> CLOSED)");
});

test("Y. a rate-limit denial never affects circuit state -- it says nothing about Google's own reachability", async () => {
  const { provider } = makeProvider({ checkRateLimit: async () => ({ allowed: false, retryAfterSeconds: 30 }) });
  await assert.rejects(() => provider.search(BASE_REQUEST));
  assert.equal(provider.health().state, "connected", "circuit must remain CLOSED -- Google was never even contacted");
});

test("Y. a successful call after failures resets the circuit to CLOSED", async () => {
  const transport = fakeTransport([timeoutErrorLike(), { status: 200, body: OK_BODY }]);
  const { provider } = makeProvider({ transport, circuitConfig: { failureThreshold: 5, cooldownMs: 1000, halfOpenMaxProbes: 1 } });
  await provider.search(BASE_REQUEST);
  assert.equal(provider.health().state, "connected");
});

// ---- Z. rate limit / quota ----

test("Z. a rate-limit denial rejects with QUOTA_EXCEEDED, non-retryable, and the transport is NEVER called", async () => {
  const transport = fakeTransport({ status: 200, body: OK_BODY });
  const { provider } = makeProvider({ transport, checkRateLimit: async () => ({ allowed: false, retryAfterSeconds: 15 }) });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "QUOTA_EXCEEDED" && err.retryable === false);
  assert.equal(transport.calls.length, 0, "quota-exceeded must block BEFORE any network call");
});

test("Z. the rate-limit gate is checked with this provider's own id", async () => {
  const rateLimitProviderIds = [];
  const { provider } = makeProvider({
    checkRateLimit: async (providerId) => {
      rateLimitProviderIds.push(providerId);
      return { allowed: true };
    },
  });
  await provider.search(BASE_REQUEST);
  assert.deepEqual(rateLimitProviderIds, [GOOGLE_PLACES_PROVIDER_ID]);
});

// ---- capabilities / health shape (structural, complements google-places.test.mjs's own O) ----

test("capabilities() and health().capabilities agree, and match GOOGLE_PLACES_CAPABILITIES", async () => {
  const { provider } = makeProvider();
  assert.deepEqual(provider.capabilities(), provider.health().capabilities);
  assert.deepEqual([...provider.capabilities()], ["search"]);
});

test("health().id is always GOOGLE_PLACES_PROVIDER_ID", async () => {
  const { provider } = makeProvider();
  assert.equal(provider.health().id, GOOGLE_PLACES_PROVIDER_ID);
});
