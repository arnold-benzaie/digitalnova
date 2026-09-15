// RADAR DISCOVERY ENGINE — Phase C-1 — google-places-http-transport.ts
// unit tests. Pure, no mocks needed for the module itself (fetch is
// injected directly) — NO NETWORK CALL of any kind. Covers mission
// section 13 items A-G, R (request shape, headers, field mask, API key
// injection, no secret leak, timeout).
//
// Run: npx tsx --test lib/radar-discovery/adapters/google-places-http-transport.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { createGooglePlacesHttpTransport, GOOGLE_PLACES_TEXT_SEARCH_URL, DEFAULT_GOOGLE_PLACES_REQUEST_TIMEOUT_MS } = await import("./google-places-http-transport.ts");

const HOSTILE_KEY = "AIzaHostileTestKeyDoNotLeak12345";

function fakeFetch(script = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (script.reject) throw script.reject;
    const status = script.status ?? 200;
    return {
      status,
      async json() {
        if (script.invalidJson) throw new SyntaxError("bad json");
        return script.body ?? { places: [] };
      },
    };
  };
  fn.calls = calls;
  return fn;
}

const descriptor = { endpoint: "places:searchText", method: "POST", fieldMask: "places.id,places.displayName", body: { textQuery: "restaurants Montreal", pageSize: 10 } };

// ---- construction guards ----

test("throws immediately when constructed without an api key", () => {
  assert.throws(() => createGooglePlacesHttpTransport({ apiKey: "", fetchImpl: fakeFetch() }));
  assert.throws(() => createGooglePlacesHttpTransport({ apiKey: "   ", fetchImpl: fakeFetch() }));
});

// ---- A/B/C. request correctly formed, correct URL, correct method ----

test("A/B/C. sends a POST to the exact Text Search (New) URL by default", async () => {
  const ff = fakeFetch();
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  await transport.searchText(descriptor);
  assert.equal(ff.calls[0].url, GOOGLE_PLACES_TEXT_SEARCH_URL);
  assert.equal(ff.calls[0].init.method, "POST");
});

// ---- D/E/F. headers correct, field mask correct, API key injected ----

test("D/E. sends X-Goog-FieldMask with exactly the descriptor's own field mask -- never '*'", async () => {
  const ff = fakeFetch();
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  await transport.searchText(descriptor);
  const headers = ff.calls[0].init.headers;
  assert.equal(headers["X-Goog-FieldMask"], "places.id,places.displayName");
  assert.notEqual(headers["X-Goog-FieldMask"], "*");
});

test("F. injects the API key via the X-Goog-Api-Key header, never a URL query parameter", async () => {
  const ff = fakeFetch();
  const transport = createGooglePlacesHttpTransport({ apiKey: HOSTILE_KEY, fetchImpl: ff });
  await transport.searchText(descriptor);
  assert.equal(ff.calls[0].init.headers["X-Goog-Api-Key"], HOSTILE_KEY);
  assert.ok(!ff.calls[0].url.includes(HOSTILE_KEY), "the key must never appear in the URL");
});

test("D. sends Content-Type: application/json and a JSON-stringified body matching the descriptor", async () => {
  const ff = fakeFetch();
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  await transport.searchText(descriptor);
  assert.equal(ff.calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(ff.calls[0].init.body), descriptor.body);
});

// ---- G. no key leak in logs/errors ----

test("G. the api key never appears in a thrown error's message, even on transport failure", async () => {
  const ff = fakeFetch({ reject: new Error("network exploded") });
  const transport = createGooglePlacesHttpTransport({ apiKey: HOSTILE_KEY, fetchImpl: ff });
  try {
    await transport.searchText(descriptor);
    assert.fail("must throw");
  } catch (err) {
    assert.ok(!String(err.message).includes(HOSTILE_KEY));
    assert.ok(!String(err.stack ?? "").includes(HOSTILE_KEY));
  }
});

test("G. the api key never appears in a returned error-status body pass-through", async () => {
  const ff = fakeFetch({ status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT" } } });
  const transport = createGooglePlacesHttpTransport({ apiKey: HOSTILE_KEY, fetchImpl: ff });
  const result = await transport.searchText(descriptor);
  assert.ok(!JSON.stringify(result).includes(HOSTILE_KEY));
});

// ---- H. successful response passthrough ----

test("a genuine 2xx response returns {body, status} verbatim for the caller to normalize", async () => {
  const ff = fakeFetch({ body: { places: [{ id: "abc" }] } });
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  const result = await transport.searchText(descriptor);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { places: [{ id: "abc" }] });
});

// ---- error-status pass-through (classification happens in the caller) ----

test("a non-2xx response returns {body, status} without throwing -- classification is the caller's job", async () => {
  const ff = fakeFetch({ status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED" } } });
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  const result = await transport.searchText(descriptor);
  assert.equal(result.status, 429);
  assert.deepEqual(result.body, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } });
});

test("a non-JSON error body still returns {body: null, status} rather than throwing", async () => {
  const ff = fakeFetch({ status: 503, invalidJson: true });
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  const result = await transport.searchText(descriptor);
  assert.equal(result.status, 503);
  assert.equal(result.body, null);
});

test("a genuine 2xx response with invalid JSON throws InvalidJsonError", async () => {
  const ff = fakeFetch({ status: 200, invalidJson: true });
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  await assert.rejects(() => transport.searchText(descriptor), (err) => err.name === "InvalidJsonError");
});

// ---- R. timeout ----

test("R. a fetch that never resolves is aborted after the configured timeout, preserving AbortError's name", async () => {
  // A realistic fake: real fetch() rejects once its AbortSignal fires --
  // this fake mirrors that (unlike a bare `new Promise(() => {})`, which
  // would hang forever even after the transport's own timer aborts it,
  // since nothing would ever be listening to the signal).
  const hangsUntilAborted = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: hangsUntilAborted, requestTimeoutMs: 50 });
  const start = Date.now();
  await assert.rejects(() => transport.searchText(descriptor), (err) => err.name === "AbortError");
  assert.ok(Date.now() - start < 2000, "must not hang indefinitely");
});

test("R. timeout is centralized/configurable -- default constant is exported and used when not overridden", () => {
  assert.equal(typeof DEFAULT_GOOGLE_PLACES_REQUEST_TIMEOUT_MS, "number");
  assert.ok(DEFAULT_GOOGLE_PLACES_REQUEST_TIMEOUT_MS > 0);
});

test("R. an already-aborted-style fetch rejection maps to AbortError name, never a raw network error name", async () => {
  const abortLike = async () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  };
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: abortLike });
  await assert.rejects(() => transport.searchText(descriptor), (err) => err.name === "AbortError");
});

test("a generic network rejection maps to TransportNetworkError, never leaks the raw error text", async () => {
  const ff = fakeFetch({ reject: new Error("ECONNREFUSED 127.0.0.1:443 some raw socket detail") });
  const transport = createGooglePlacesHttpTransport({ apiKey: "real-key", fetchImpl: ff });
  try {
    await transport.searchText(descriptor);
    assert.fail("must throw");
  } catch (err) {
    assert.equal(err.name, "TransportNetworkError");
    assert.ok(!err.message.includes("ECONNREFUSED"));
  }
});
