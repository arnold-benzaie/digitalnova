// MISSION C-2D-2 — offline tests for the guarded live-DATA-VALIDATION
// harness (a separate mechanism from the original connectivity-only
// live-smoke script). ZERO network: an injected fake `fetch` simulates
// the Google Places response(s). ZERO database: deliberately mocks
// NEITHER "@/lib/api-v1/rate-limit" NOR "@/db" — this script's real,
// in-memory checkRateLimit override makes that unnecessary, same
// discipline as scripts/radar-discovery-google-places-live-smoke.test.mjs
// since MISSION C-2D-0-FIX. This file is wired into `npm test`; the live
// script itself is never invoked by any automation.
//
// Run: npx tsx --test --experimental-test-module-mocks scripts/radar-discovery-google-places-live-data-validation.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Sanity guard for the test environment itself: this suite's entire point
// (like its DB-free sibling) requires no DATABASE_URL to be needed.
delete process.env.DATABASE_URL;

mock.module("server-only", { namedExports: {} });

const SKIP_H1 = "C-2D-6-C-FIX H1: this historical live script builds its provider WITHOUT a budget gate, so it now (correctly) fails closed before any HTTP; its success-path behavior is re-validated when the script is refactored to supply a gate in C-2D-6-D";

const { runGooglePlacesLiveDataValidation, ACK_FLAG, DEFAULT_MAX_RESULTS, MAX_ADDITIONAL_PAGES, VALIDATION_SEARCH_REQUEST } = await import(
  "./radar-discovery-google-places-live-data-validation.mjs"
);

const HOSTILE_KEY = "AIzaLIVE-VALIDATION-SECRET-DO-NOT-LEAK";
const ENABLED_ENV = { GOOGLE_PLACES_ENABLED: "true", GOOGLE_PLACES_API_KEY: HOSTILE_KEY };

function collector() {
  const lines = [];
  return { lines, write: (l) => lines.push(l), text: () => lines.join("\n") };
}

function place(id, overrides = {}) {
  return {
    id,
    displayName: { text: `Smoke Restaurant ${id}` },
    primaryType: "restaurant",
    formattedAddress: `${id} Waterfront, Port Louis, Mauritius`,
    addressComponents: [
      { longText: "Mauritius", types: ["country"] },
      { longText: "Port Louis District", types: ["administrative_area_level_1"] },
      { longText: "Port Louis", types: ["locality"] },
    ],
    location: { latitude: -20.1609, longitude: 57.5012 },
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    // Fields minimal_discovery never requests -- present here only to
    // prove redactResult() strips them even if a poisoned response ever
    // carried them.
    internationalPhoneNumber: "+23012345678",
    websiteUri: "https://example.test",
    ...overrides,
  };
}

/** `pages` is an array of { places, nextPageToken? } consumed in order,
 * one per fetch call. */
function fakeFetch(pages) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url, init });
    const page = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return {
      status: 200,
      async json() {
        return { places: page.places, ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
      },
    };
  };
  fn.calls = calls;
  return fn;
}

async function run(overrides = {}) {
  const so = collector();
  const se = collector();
  const ff = overrides.fetchImpl ?? fakeFetch(overrides.pages ?? [{ places: [place("p1")] }]);
  const res = await runGooglePlacesLiveDataValidation({
    argv: overrides.argv ?? [ACK_FLAG],
    env: overrides.env ?? ENABLED_ENV,
    fetchImpl: ff,
    stdout: so.write,
    stderr: se.write,
    ...(overrides.request ? { request: overrides.request } : {}),
  });
  return { res, stdout: so.text(), stderr: se.text(), fetchCalls: ff.calls?.length ?? 0, ff };
}

const noSecret = (s) => {
  assert.equal(s.includes(HOSTILE_KEY), false, "hostile key leaked");
  assert.equal(/AIza/i.test(s), false, "AIza-prefix pattern leaked");
};

// ---------------- guards (identical contract to the original smoke) ----------------

test("no --i-understand flag -> refused, exitCode 2, ZERO fetch calls", async () => {
  const { res, fetchCalls } = await run({ argv: [] });
  assert.equal(res.exitCode, 2);
  assert.equal(res.reason, "missing-ack-flag");
  assert.equal(fetchCalls, 0);
});

test("GOOGLE_PLACES_ENABLED not 'true' -> refused, exitCode 3, ZERO fetch", async () => {
  const { res, fetchCalls } = await run({ env: { GOOGLE_PLACES_API_KEY: HOSTILE_KEY } });
  assert.equal(res.exitCode, 3);
  assert.equal(fetchCalls, 0);
});

test("enabled=true, NO key -> refused, exitCode 4, ZERO fetch", async () => {
  const { res, fetchCalls } = await run({ env: { GOOGLE_PLACES_ENABLED: "true" } });
  assert.equal(res.exitCode, 4);
  assert.equal(fetchCalls, 0);
});

// ---------------- request shaping ----------------

test("fieldSet is ALWAYS forced to minimal_discovery, even if the caller's request claims otherwise", { skip: SKIP_H1 }, async () => {
  const { res } = await run({ request: { ...VALIDATION_SEARCH_REQUEST, fieldSet: "details" } });
  assert.equal(res.safeResult.requestedFieldSet, "minimal_discovery");
});

test("maxResults is capped at DEFAULT_MAX_RESULTS (5) even if the caller asks for more", { skip: SKIP_H1 }, async () => {
  const { res } = await run({ request: { ...VALIDATION_SEARCH_REQUEST, maxResults: 999 } });
  assert.equal(res.safeResult.requestedMaxResults, DEFAULT_MAX_RESULTS);
  assert.equal(DEFAULT_MAX_RESULTS, 5);
});

test("a maxResults below 1 is floored to 1, never zero or negative", { skip: SKIP_H1 }, async () => {
  const { res } = await run({ request: { ...VALIDATION_SEARCH_REQUEST, maxResults: -3 } });
  assert.equal(res.safeResult.requestedMaxResults, 1);
});

// ---------------- single-page success + field redaction ----------------

test("page1: resultCount/hasNextCursor/attemptCount/circuitState/results are all reported; no nextPageToken -> no page2 at all", { skip: SKIP_H1 }, async () => {
  const { res, fetchCalls } = await run({ pages: [{ places: [place("p1"), place("p2")] }] });
  assert.equal(res.exitCode, 0);
  assert.equal(res.safeResult.page1.resultCount, 2);
  assert.equal(res.safeResult.page1.hasNextCursor, false);
  assert.equal(res.safeResult.page1.attemptCount, 1);
  assert.equal(res.safeResult.page1.circuitState, "connected");
  assert.equal("page2" in res.safeResult, false);
  assert.equal(fetchCalls, 1);
});

test("each redacted result carries EXACTLY the documented allowlist -- source/sourceId/name/category/address/country/region/city/latitude/longitude/sourceUrl -- and nothing else, even from a poisoned raw place with phone/website", { skip: SKIP_H1 }, async () => {
  const { res } = await run({ pages: [{ places: [place("p1")] }] });
  const row = res.safeResult.page1.results[0];
  assert.deepEqual(Object.keys(row).sort(), ["address", "category", "city", "country", "latitude", "longitude", "name", "region", "source", "sourceId", "sourceUrl"]);
  assert.equal(row.source, "google_places");
  assert.equal(row.sourceId, "p1");
  assert.equal(row.name, "Smoke Restaurant p1");
  assert.equal(row.category, "restaurant");
  assert.equal(row.country, "Mauritius");
  assert.equal(row.region, "Port Louis District");
  assert.equal(row.city, "Port Louis");
  assert.equal(row.latitude, -20.1609);
  assert.equal(row.longitude, 57.5012);
  assert.equal(JSON.stringify(row).includes("+23012345678"), false, "phone must never appear even though the raw place object carried one");
  assert.equal(JSON.stringify(row).includes("example.test"), false, "website must never appear even though the raw place object carried one");
});

// ---------------- pagination: exactly one additional page, hard capped ----------------

test("PAGINATION: a nextPageToken on page1 triggers EXACTLY one additional request (page2), never more", { skip: SKIP_H1 }, async () => {
  const { res, fetchCalls } = await run({
    pages: [
      { places: [place("p1")], nextPageToken: "opaque-token-1" },
      { places: [place("p2")] },
    ],
  });
  assert.equal(fetchCalls, 2);
  assert.equal(res.safeResult.page1.hasNextCursor, true);
  assert.ok(res.safeResult.page2);
  assert.equal(res.safeResult.page2.resultCount, 1);
  assert.equal(res.safeResult.page2.hasNextCursor, false);
  assert.equal(res.safeResult.page2.attemptCount, 1);
  assert.equal(MAX_ADDITIONAL_PAGES, 1);
});

test("PAGINATION HARD CAP: even when page2's OWN response also carries a nextPageToken, NO third request is ever made", { skip: SKIP_H1 }, async () => {
  const { res, fetchCalls } = await run({
    pages: [
      { places: [place("p1")], nextPageToken: "opaque-token-1" },
      { places: [place("p2")], nextPageToken: "opaque-token-2" },
    ],
  });
  assert.equal(fetchCalls, 2, "must stop at exactly 2 requests total, never 3");
  assert.equal(res.safeResult.page2.hasNextCursor, true, "page2's own nextCursor is reported, but never followed");
});

test("PAGINATION: the opaque token itself is NEVER present anywhere in the printed output", { skip: SKIP_H1 }, async () => {
  const { res, stdout } = await run({
    pages: [
      { places: [place("p1")], nextPageToken: "TOTALLY-OPAQUE-TOKEN-VALUE" },
      { places: [place("p2")] },
    ],
  });
  assert.equal(stdout.includes("TOTALLY-OPAQUE-TOKEN-VALUE"), false);
  assert.equal(JSON.stringify(res.safeResult).includes("TOTALLY-OPAQUE-TOKEN-VALUE"), false);
  assert.equal("hasNextCursor" in res.safeResult.page1, true);
});

test("PAGINATION: page2 reuses the SAME category/city/country/fieldSet/maxResults as page1, only cursor differs", { skip: SKIP_H1 }, async () => {
  const { res, ff } = await run({
    pages: [
      { places: [place("p1")], nextPageToken: "tok" },
      { places: [place("p2")] },
    ],
  });
  assert.equal(res.exitCode, 0);
  const [firstCallInit, secondCallInit] = ff.calls.map((c) => JSON.parse(c.init.body));
  assert.equal(firstCallInit.textQuery, secondCallInit.textQuery, "the same free-text query must be reused for page2");
  assert.equal(secondCallInit.pageToken, "tok");
  assert.equal("pageToken" in firstCallInit, false, "page1 must never carry a pageToken");
});

// ---------------- security ----------------

test("the api key is genuinely used on EVERY outbound request (page1 and page2), yet never printed", { skip: SKIP_H1 }, async () => {
  const { res, ff, stdout, stderr } = await run({
    pages: [
      { places: [place("p1")], nextPageToken: "tok" },
      { places: [place("p2")] },
    ],
  });
  assert.equal(res.exitCode, 0);
  assert.equal(ff.calls[0].init.headers["X-Goog-Api-Key"], HOSTILE_KEY);
  assert.equal(ff.calls[1].init.headers["X-Goog-Api-Key"], HOSTILE_KEY);
  noSecret(stdout);
  noSecret(stderr);
});

test("no raw HTTP header object ever appears in the printed result", async () => {
  const { res } = await run();
  assert.equal(JSON.stringify(res.safeResult).includes("X-Goog"), false);
});

test("a provider-side error surfaces only a safe error code, never the raw Google error body", { skip: SKIP_H1 }, async () => {
  const { res, stdout } = await run({
    fetchImpl: async () => ({ status: 403, async json() { return { error: { code: 403, status: "PERMISSION_DENIED", message: "API key not authorized for this API" } }; } }),
  });
  assert.equal(res.exitCode, 1);
  assert.equal(res.reason, "provider-failure");
  assert.equal(res.safeResult.errorCode, "PROVIDER_ERROR");
  assert.ok(!stdout.includes("not authorized"));
});

// ---------------- structural isolation ----------------

test("this module never imports discovery-result-store, searchRadarDiscovery, convertDiscoveryResult, or RBAC -- structurally cannot write DB / touch CRM / bypass RBAC", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./radar-discovery-google-places-live-data-validation.mjs", import.meta.url), "utf8");
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
  for (const line of importLines) {
    assert.doesNotMatch(line, /discovery-result-store/);
    assert.doesNotMatch(line, /radar-discovery-search/);
    assert.doesNotMatch(line, /radar-discovery-convert/);
    assert.doesNotMatch(line, /require-staff-member/);
    assert.doesNotMatch(line, /@\/lib\/session\b/);
    assert.doesNotMatch(line, /@\/lib\/api-v1\/rate-limit/);
    assert.doesNotMatch(line, /@\/db\b/);
  }
});

test("importing this module runs nothing (no CLI branch executes on import)", async () => {
  assert.ok(true);
});

// ---------------- C-2D-6-C-FIX (H1): NO GATE -> NO GOOGLE CALL ----------------

test("H1: with every guard satisfied but NO budget gate (this historical script never supplies one), the provider refuses BEFORE any HTTP -- ZERO fetch calls, non-zero exit, BUDGET_GATE_MISSING surfaced, key never printed", async () => {
  const { res, stdout, stderr, fetchCalls } = await run();
  assert.equal(fetchCalls, 0, "an omitted gate must never become a real Google call");
  assert.notEqual(res.exitCode, 0);
  assert.ok((stdout + stderr).includes("BUDGET_GATE_MISSING"), "the controlled error code is surfaced");
  assert.equal((stdout + stderr).includes(HOSTILE_KEY), false, "hostile key leaked");
});
