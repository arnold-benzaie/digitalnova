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

/** MISSION C-2D-4-E — same queue-consumption contract as fakeTransport()
 * above, for getDetails() calls specifically. A separate function (not a
 * shared `calls` array with searchText) so a test exercising ONLY
 * getDetails() can assert `detailsCalls.length` without ever worrying
 * about search() calls it never made. */
function fakeDetailsTransport(script) {
  const queue = Array.isArray(script) ? [...script] : [script];
  const calls = [];
  return {
    calls,
    async getDetails(descriptor) {
      calls.push(descriptor);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

/** MISSION C-2D-4-E — a transport implementing BOTH methods, for tests
 * that must prove cross-cutting behavior (the shared circuit breaker) —
 * one call log per method, so a test can assert on either independently. */
function combinedTransport(searchScript, detailsScript) {
  const searchQueue = Array.isArray(searchScript) ? [...searchScript] : [searchScript];
  const detailsQueue = Array.isArray(detailsScript) ? [...detailsScript] : [detailsScript];
  const searchCalls = [];
  const detailsCalls = [];
  return {
    searchCalls,
    detailsCalls,
    async searchText(descriptor) {
      searchCalls.push(descriptor);
      const next = searchQueue.length > 1 ? searchQueue.shift() : searchQueue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    async getDetails(descriptor) {
      detailsCalls.push(descriptor);
      const next = detailsQueue.length > 1 ? detailsQueue.shift() : detailsQueue[0];
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
  // MISSION C-2D-4-E — the Enrichment-specific rate-limit override,
  // completely independent of `checkRateLimit` above.
  const enrichmentRateLimitCalls = [];
  const checkEnrichmentRateLimit =
    overrides.checkEnrichmentRateLimit ??
    (async (providerId) => {
      enrichmentRateLimitCalls.push(providerId);
      return { allowed: true };
    });
  const transport = overrides.transport ?? fakeTransport({ status: 200, body: OK_BODY });
  const provider = createGooglePlacesProvider({
    transport,
    checkRateLimit,
    checkEnrichmentRateLimit,
    clock,
    circuitConfig: overrides.circuitConfig ?? DEFAULT_CIRCUIT_CONFIG,
    // C-2D-6-C-FIX (H1) — the gate is mandatory at runtime, so every
    // pre-existing test that is NOT about budgeting gets an always-allow
    // fake by default. Pass `null` explicitly to build a provider with NO
    // gate (the H1 tests below).
    ...(overrides.checkSearchBudget !== null ? { checkSearchBudget: overrides.checkSearchBudget ?? fakeBudgetGate(["allow"]) } : {}),
    ...(overrides.checkEnrichmentBudget !== null ? { checkEnrichmentBudget: overrides.checkEnrichmentBudget ?? fakeBudgetGate(["allow"]) } : {}),
  });
  return { provider, transport, rateLimitCalls, enrichmentRateLimitCalls, advanceClock };
}

/** MISSION C-2D-6-B — a scriptable fake ProviderBudgetGate: `script` is an
 * array of `"allow"` or an error-code string ("BUDGET_EXHAUSTED" etc.),
 * consumed in order, one per `.reserve()` call (the last entry repeats
 * once exhausted). Records every reserve/settle call for assertion. */
function fakeBudgetGate(script = ["allow"]) {
  const queue = [...script];
  const reserveCalls = [];
  const settleCalls = [];
  let nextReservationId = 0;
  return {
    reserveCalls,
    settleCalls,
    async reserve(attemptNumber) {
      reserveCalls.push(attemptNumber);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === "allow") {
        nextReservationId += 1;
        return { allowed: true, reservationId: `fake-reservation-${nextReservationId}` };
      }
      return { allowed: false, errorCode: next };
    },
    async settle(reservationId, success) {
      settleCalls.push({ reservationId, success });
    },
  };
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
  assert.deepEqual([...provider.capabilities()], ["search", "get_details"]);
});

test("health().id is always GOOGLE_PLACES_PROVIDER_ID", async () => {
  const { provider } = makeProvider();
  assert.equal(provider.health().id, GOOGLE_PLACES_PROVIDER_ID);
});

// ---- MISSION C-2D-4-E — Enrichment Engine: getDetails() ----

const DETAILS_OK_BODY = { internationalPhoneNumber: "+33 1 42 00 00 01", websiteUri: "https://example.test", businessStatus: "OPERATIONAL" };

test("Details: a successful call returns the normalized enrichment patch, never a full DiscoveryProviderResult shape", async () => {
  const { provider } = makeProvider({ transport: fakeDetailsTransport({ status: 200, body: DETAILS_OK_BODY }) });
  const outcome = await provider.getDetails("ChIJ_test_place", "details");
  assert.deepEqual(outcome, { result: { phone: "+33 1 42 00 00 01", website: "https://example.test", openingHours: null, businessStatus: "OPERATIONAL" } });
});

test("Details: the field mask sent to the transport is EXACTLY buildGooglePlacesDetailsFieldMask() -- never influenced by the `fieldSet` argument's value", async () => {
  const transport = fakeDetailsTransport({ status: 200, body: {} });
  const { provider } = makeProvider({ transport });
  await provider.getDetails("ChIJ_test_place", "details");
  const { buildGooglePlacesDetailsFieldMask } = await import("./google-places.ts");
  assert.equal(transport.calls[0].fieldMask, buildGooglePlacesDetailsFieldMask());
  assert.equal(transport.calls[0].placeId, "ChIJ_test_place");
});

test("Details: uses the SEPARATE enrichment rate-limit gate, never the search one -- a search rate-limit denial never blocks Details and vice versa", async () => {
  const { provider, rateLimitCalls, enrichmentRateLimitCalls } = makeProvider({ transport: fakeDetailsTransport({ status: 200, body: {} }) });
  await provider.getDetails("ChIJ_test_place", "details");
  assert.equal(enrichmentRateLimitCalls.length, 1);
  assert.equal(rateLimitCalls.length, 0, "search's own rate-limit gate must never be consulted by getDetails()");
});

test("Details: a denied enrichment rate limit rejects with QUOTA_EXCEEDED, non-retryable, and the transport is NEVER called", async () => {
  const transport = fakeDetailsTransport({ status: 200, body: {} });
  const { provider } = makeProvider({ transport, checkEnrichmentRateLimit: async () => ({ allowed: false, retryAfterSeconds: 20 }) });
  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "QUOTA_EXCEEDED" && err.retryable === false);
  assert.equal(transport.calls.length, 0);
});

test("Details: HTTP 400 rejects with a non-retryable PROVIDER_ERROR, never retried", async () => {
  const transport = fakeDetailsTransport({ status: 400, body: {} });
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "PROVIDER_ERROR" && err.retryable === false);
  assert.equal(transport.calls.length, 1);
});

test("Details: HTTP 429 rejects with PROVIDER_RATE_LIMITED, retryable, exactly one retry attempted", async () => {
  const transport = fakeDetailsTransport([{ status: 429, body: {} }, { status: 429, body: {} }]);
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "PROVIDER_RATE_LIMITED" && err.retryable === true);
  assert.equal(transport.calls.length, 2);
});

test("Details: HTTP 5xx rejects with PROVIDER_UNAVAILABLE, retryable", async () => {
  const transport = fakeDetailsTransport([{ status: 503, body: {} }, { status: 503, body: {} }]);
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "PROVIDER_UNAVAILABLE");
  assert.equal(transport.calls.length, 2);
});

test("Details: a retryable failure then SUCCESS resolves, exactly one retry", async () => {
  const transport = fakeDetailsTransport([timeoutErrorLike(), { status: 200, body: DETAILS_OK_BODY }]);
  const { provider } = makeProvider({ transport });
  const outcome = await provider.getDetails("ChIJ_test_place", "details");
  assert.equal(outcome.result.phone, "+33 1 42 00 00 01");
  assert.equal(transport.calls.length, 2);
});

test("Details: a transport timeout (AbortError) classifies to PROVIDER_TIMEOUT", async () => {
  const transport = fakeDetailsTransport([timeoutErrorLike(), timeoutErrorLike()]);
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "PROVIDER_TIMEOUT" && err.retryable === true);
});

test("Details: a 2xx response with a non-object body is treated as a provider error, never silently normalized as 'all fields confirmed empty'", async () => {
  const transport = fakeDetailsTransport({ status: 200, body: "not an object" });
  const { provider } = makeProvider({ transport });
  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"));
});

test("Details: an all-empty 2xx response ({}) succeeds with every enrichment field null -- a genuinely different outcome from the malformed-body case above", async () => {
  const transport = fakeDetailsTransport({ status: 200, body: {} });
  const { provider } = makeProvider({ transport });
  const outcome = await provider.getDetails("ChIJ_test_place", "details");
  assert.deepEqual(outcome.result, { phone: null, website: null, openingHours: null, businessStatus: null });
});

// ---- Details x Search: shared circuit breaker, separate everything else ----

test("SHARED CIRCUIT: a Details failure that trips the circuit also blocks a subsequent Search attempt -- both operations hit the same underlying Google reachability", async () => {
  const transport = combinedTransport({ status: 200, body: OK_BODY }, { status: 400, body: {} });
  const { provider } = makeProvider({ transport, circuitConfig: { failureThreshold: 1, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });

  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"));
  assert.equal(provider.health().state, "unavailable", "the circuit must be OPEN after this Details failure");

  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "PROVIDER_UNAVAILABLE");
  assert.equal(transport.searchCalls.length, 0, "the OPEN circuit (tripped by Details) must block Search before the transport is ever called");
});

test("SHARED CIRCUIT: a Search failure that trips the circuit also blocks a subsequent Details attempt", async () => {
  const transport = combinedTransport({ status: 400, body: {} }, { status: 200, body: DETAILS_OK_BODY });
  const { provider } = makeProvider({ transport, circuitConfig: { failureThreshold: 1, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });

  await assert.rejects(() => provider.search(BASE_REQUEST));
  assert.equal(provider.health().state, "unavailable");

  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "PROVIDER_UNAVAILABLE");
  assert.equal(transport.detailsCalls.length, 0, "the OPEN circuit (tripped by Search) must block Details before the transport is ever called");
});

test("SEPARATE RATE LIMITS: an exhausted Search rate-limit budget never blocks a Details call on the SAME provider instance", async () => {
  const transport = combinedTransport({ status: 200, body: OK_BODY }, { status: 200, body: DETAILS_OK_BODY });
  const { provider } = makeProvider({ transport, checkRateLimit: async () => ({ allowed: false, retryAfterSeconds: 5 }) });

  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "QUOTA_EXCEEDED");
  const outcome = await provider.getDetails("ChIJ_test_place", "details");
  assert.equal(outcome.result.phone, "+33 1 42 00 00 01", "Details must succeed even though Search's own budget is exhausted");
});

// ---- MISSION C-2D-6-B — RADAR DISCOVERY COST & QUOTA GOVERNANCE: per-attempt budget gating ----

// ---- C-2D-6-C-FIX (H1): NO GATE -> NO GOOGLE CALL ----

test("H1: search() WITHOUT a gate rejects with BUDGET_GATE_MISSING and makes ZERO HTTP calls, spends no rate-limit unit, never touches the circuit", async () => {
  const transport = fakeTransport({ status: 200, body: OK_BODY });
  const { provider, rateLimitCalls } = makeProvider({ transport, checkSearchBudget: null });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "BUDGET_GATE_MISSING" && err.retryable === false);
  assert.equal(transport.calls.length, 0, "no gate -> no HTTP");
  assert.equal(rateLimitCalls.length, 0, "the refusal happens before the rate limit is even consulted");
  assert.equal(provider.health().state, "connected");
});

test("H1: getDetails() WITHOUT a gate rejects with BUDGET_GATE_MISSING and makes ZERO HTTP calls", async () => {
  const transport = fakeDetailsTransport({ status: 200, body: DETAILS_OK_BODY });
  const { provider, enrichmentRateLimitCalls } = makeProvider({ transport, checkEnrichmentBudget: null });
  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "BUDGET_GATE_MISSING");
  assert.equal(transport.calls.length, 0);
  assert.equal(enrichmentRateLimitCalls.length, 0);
});

test("H1: a Search gate does NOT unlock Details (and vice versa) -- each operation needs ITS OWN gate", async () => {
  const combined = combinedTransport({ status: 200, body: OK_BODY }, { status: 200, body: DETAILS_OK_BODY });
  const onlySearch = makeProvider({ transport: combined, checkSearchBudget: fakeBudgetGate(["allow"]), checkEnrichmentBudget: null });
  await assert.rejects(() => onlySearch.provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "BUDGET_GATE_MISSING");
  assert.equal(combined.detailsCalls.length, 0);

  const combined2 = combinedTransport({ status: 200, body: OK_BODY }, { status: 200, body: DETAILS_OK_BODY });
  const onlyDetails = makeProvider({ transport: combined2, checkSearchBudget: null, checkEnrichmentBudget: fakeBudgetGate(["allow"]) });
  await assert.rejects(() => onlyDetails.provider.search(BASE_REQUEST), (err) => err.code === "BUDGET_GATE_MISSING");
  assert.equal(combined2.searchCalls.length, 0);
});

test("H1: no default construction path bypasses the gate -- a provider built with ONLY transport (no gates at all) can never reach the transport", async () => {
  const transport = combinedTransport({ status: 200, body: OK_BODY }, { status: 200, body: DETAILS_OK_BODY });
  const bare = createGooglePlacesProvider({ transport, checkRateLimit: async () => ({ allowed: true }), checkEnrichmentRateLimit: async () => ({ allowed: true }) });
  await assert.rejects(() => bare.search(BASE_REQUEST), (err) => err.code === "BUDGET_GATE_MISSING");
  await assert.rejects(() => bare.getDetails("ChIJ_test_place", "details"), (err) => err.code === "BUDGET_GATE_MISSING");
  assert.equal(transport.searchCalls.length + transport.detailsCalls.length, 0);
});

test("H1: WITH a gate the gate is genuinely used (reserve before HTTP, settle after) and behavior is normal", async () => {
  const gate = fakeBudgetGate(["allow"]);
  const transport = fakeTransport({ status: 200, body: OK_BODY });
  const { provider } = makeProvider({ transport, checkSearchBudget: gate });
  const outcome = await provider.search(BASE_REQUEST);
  assert.equal(outcome.results.length, 1);
  assert.deepEqual(gate.reserveCalls, [1]);
  assert.deepEqual(gate.settleCalls, [{ reservationId: "fake-reservation-1", success: true }]);
  assert.equal(transport.calls.length, 1);
});

test("H1: a retry with a budget-DENIED second attempt makes no second HTTP call (no free retry on the first reservation)", async () => {
  const gate = fakeBudgetGate(["allow", "BUDGET_EXHAUSTED"]);
  const transport = fakeTransport([{ status: 503, body: {} }, { status: 200, body: OK_BODY }]);
  const { provider } = makeProvider({ transport, checkSearchBudget: gate, circuitConfig: { failureThreshold: 5, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });
  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "BUDGET_EXHAUSTED");
  assert.equal(transport.calls.length, 1);
  assert.deepEqual(gate.reserveCalls, [1, 2]);
});

test("BUDGET: a search denied on attempt 1 (BUDGET_EXHAUSTED) never reaches the transport, never retries, never touches the circuit breaker", async () => {
  const gate = fakeBudgetGate(["BUDGET_EXHAUSTED"]);
  const transport = fakeTransport({ status: 200, body: OK_BODY });
  const { provider } = makeProvider({ transport, checkSearchBudget: gate });

  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "BUDGET_EXHAUSTED");
  assert.equal(transport.calls.length, 0, "the transport must never be called when the budget refuses");
  assert.deepEqual(gate.reserveCalls, [1]);
  assert.equal(gate.settleCalls.length, 0, "a refused reservation is never settled -- there is nothing to settle");
  assert.equal(provider.health().state, "connected", "a budget refusal must never degrade the circuit breaker");
});

test("BUDGET: BUDGET_BLOCKED and BUDGET_PRICE_UNKNOWN propagate as their own distinct DiscoveryError codes", async () => {
  for (const code of ["BUDGET_BLOCKED", "BUDGET_PRICE_UNKNOWN"]) {
    const gate = fakeBudgetGate([code]);
    const { provider } = makeProvider({ checkSearchBudget: gate });
    await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === code);
  }
});

test("BUDGET: a successful attempt is settled with success=true, using the reservation id the gate returned", async () => {
  const gate = fakeBudgetGate(["allow"]);
  const { provider } = makeProvider({ checkSearchBudget: gate });
  await provider.search(BASE_REQUEST);
  assert.deepEqual(gate.settleCalls, [{ reservationId: "fake-reservation-1", success: true }]);
});

test("BUDGET RETRY: attempt 1 reserved+fails retryably, attempt 2 gets its OWN, separately-numbered reservation -- never reused", async () => {
  const gate = fakeBudgetGate(["allow", "allow"]);
  const transport = fakeTransport([{ status: 503, body: {} }, { status: 200, body: OK_BODY }]);
  const { provider } = makeProvider({ transport, checkSearchBudget: gate });

  const outcome = await provider.search(BASE_REQUEST);
  assert.equal(outcome.results.length, 1);
  assert.deepEqual(gate.reserveCalls, [1, 2], "each attempt (initial + retry) must reserve independently, numbered by attempt");
  assert.equal(transport.calls.length, 2);
  assert.deepEqual(gate.settleCalls, [
    { reservationId: "fake-reservation-1", success: false },
    { reservationId: "fake-reservation-2", success: true },
  ]);
});

test("BUDGET RETRY: if the budget denies the RETRY (attempt 2), the retry never happens -- no second transport call, no third reservation", async () => {
  const gate = fakeBudgetGate(["allow", "BUDGET_EXHAUSTED"]);
  const transport = fakeTransport([{ status: 503, body: {} }, { status: 200, body: OK_BODY }]);
  const { provider } = makeProvider({ transport, checkSearchBudget: gate, circuitConfig: { failureThreshold: 5, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });

  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "BUDGET_EXHAUSTED");
  assert.equal(transport.calls.length, 1, "only the FIRST attempt (a real, budget-approved transport failure) ever reaches the transport");
  assert.deepEqual(gate.reserveCalls, [1, 2]);
  assert.deepEqual(gate.settleCalls, [{ reservationId: "fake-reservation-1", success: false }], "the denied retry attempt was never reserved, so there is nothing to settle for it");
});

test("BUDGET RETRY: only the REAL transport failure counts against the circuit breaker -- a budget-denied retry never does", async () => {
  const gate = fakeBudgetGate(["allow", "BUDGET_EXHAUSTED"]);
  const transport = fakeTransport([{ status: 503, body: {} }, { status: 200, body: OK_BODY }]);
  const { provider } = makeProvider({ transport, checkSearchBudget: gate, circuitConfig: { failureThreshold: 5, cooldownMs: 10_000, halfOpenMaxProbes: 1 } });

  await assert.rejects(() => provider.search(BASE_REQUEST));
  // failureThreshold=5 -- a single REAL transport failure alone must not
  // trip the circuit to "unavailable" (it would need 5).
  assert.equal(provider.health().state, "connected", "exactly one real transport failure recorded -- the budget-denied retry must not add a second");
});

test("BUDGET (Enrichment): Details uses its OWN gate, completely independent of Search's own", async () => {
  const searchGate = fakeBudgetGate(["BUDGET_EXHAUSTED"]);
  const enrichmentGate = fakeBudgetGate(["allow"]);
  const transport = combinedTransport({ status: 200, body: OK_BODY }, { status: 200, body: DETAILS_OK_BODY });
  const { provider } = makeProvider({ transport, checkSearchBudget: searchGate, checkEnrichmentBudget: enrichmentGate });

  await assert.rejects(() => provider.search(BASE_REQUEST), (err) => err.code === "BUDGET_EXHAUSTED");
  const outcome = await provider.getDetails("ChIJ_test_place", "details");
  assert.equal(outcome.result.phone, "+33 1 42 00 00 01", "Enrichment must succeed even though Search's own budget is exhausted");
  assert.deepEqual(enrichmentGate.settleCalls, [{ reservationId: "fake-reservation-1", success: true }]);
});

test("BUDGET (Enrichment): a Details attempt denied by budget never reaches the transport", async () => {
  const gate = fakeBudgetGate(["BUDGET_EXHAUSTED"]);
  const transport = fakeDetailsTransport({ status: 200, body: DETAILS_OK_BODY });
  const { provider } = makeProvider({ transport, checkEnrichmentBudget: gate });

  await assert.rejects(() => provider.getDetails("ChIJ_test_place", "details"), (err) => err.code === "BUDGET_EXHAUSTED");
  assert.equal(transport.calls.length, 0);
});
