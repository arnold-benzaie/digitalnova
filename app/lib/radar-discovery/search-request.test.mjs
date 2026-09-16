// RADAR DISCOVERY ENGINE — Phase C-0 — search-request.ts unit tests. Pure,
// no mocks, no network. Covers mission section 18 item B (input
// validation) and item N (pagination abstraction, cursor's generic
// round-trip through validation).
//
// Run: npx tsx --test lib/radar-discovery/search-request.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDiscoverySearchRequest } from "./search-request.ts";

function base(overrides = {}) {
  return { category: "restaurants", city: "Montreal", maxResults: 20, fieldSet: "minimal_discovery", ...overrides };
}

// ---- B. input validation ----

test("B. a well-formed request with category+city validates and normalizes cleanly", () => {
  const r = validateDiscoverySearchRequest(base());
  assert.equal(r.ok, true);
  assert.equal(r.request.category, "restaurants");
  assert.equal(r.request.city, "Montreal");
  assert.equal(r.request.country, null);
  assert.equal(r.request.cursor, null);
});

test("B. not an object -> rejected", () => {
  assert.equal(validateDiscoverySearchRequest(null).ok, false);
  assert.equal(validateDiscoverySearchRequest("a string").ok, false);
  assert.equal(validateDiscoverySearchRequest(42).ok, false);
  assert.equal(validateDiscoverySearchRequest(undefined).ok, false);
});

test("B. a completely empty request (no location, no category, no coordinates) is rejected -- never 'search everything'", () => {
  const r = validateDiscoverySearchRequest({ maxResults: 20, fieldSet: "minimal_discovery" });
  assert.equal(r.ok, false);
});

test("B. coordinates alone (no category/location text) are sufficient", () => {
  const r = validateDiscoverySearchRequest({ latitude: 45.5, longitude: -73.5, maxResults: 20, fieldSet: "minimal_discovery" });
  assert.equal(r.ok, true);
});

test("B. maxResults must be a positive integer within the ceiling", () => {
  assert.equal(validateDiscoverySearchRequest(base({ maxResults: 0 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ maxResults: -5 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ maxResults: 1.5 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ maxResults: 1000 })).ok, false, "must not exceed DISCOVERY_SEARCH_MAX_RESULTS_CEILING");
  assert.equal(validateDiscoverySearchRequest(base({ maxResults: 1 })).ok, true);
  assert.equal(validateDiscoverySearchRequest(base({ maxResults: 100 })).ok, true);
});

// ---- SECURITY (MISSION C-2D-4-C): fieldSet is locked, never caller-influenced ----
//
// search-request.ts no longer reads `fieldSet` from the candidate AT ALL
// (see that file's own header) -- the validated request's fieldSet is a
// fixed constant, always "minimal_discovery", regardless of what (if
// anything) the caller sent. This replaces the pre-C-2D-4-C test that
// accepted "enrichment"/"details" as valid caller-chosen values -- that
// was precisely the vulnerability this mission closes.

test("SECURITY (C-2D-4-C): fieldSet in the candidate NEVER influences the validated request -- always locked to minimal_discovery, whatever the caller sends", () => {
  const candidateFieldSets = ["minimal_discovery", "enrichment", "details", "bogus", "enterprise", undefined, null, {}, 42, ["details"]];
  for (const fieldSet of candidateFieldSets) {
    const r = validateDiscoverySearchRequest(base({ fieldSet }));
    assert.equal(r.ok, true, `fieldSet=${JSON.stringify(fieldSet)} must never affect validity`);
    assert.equal(r.request.fieldSet, "minimal_discovery", `fieldSet=${JSON.stringify(fieldSet)} must never leak through -- always minimal_discovery`);
  }
});

test("SECURITY (C-2D-4-C): fieldSet key entirely absent from the candidate still yields minimal_discovery -- the field is not required from the caller at all", () => {
  const withoutFieldSet = base();
  delete withoutFieldSet.fieldSet;
  const r = validateDiscoverySearchRequest(withoutFieldSet);
  assert.equal(r.ok, true);
  assert.equal(r.request.fieldSet, "minimal_discovery");
});

test("SECURITY (C-2D-4-C) POISONED OBJECT: a malicious request object carrying a privileged fieldSet cannot transmit it through validation -- the returned request always diverges from the poisoned input on this field", () => {
  const poisoned = base({ fieldSet: "details", maxResults: 20 });
  const r = validateDiscoverySearchRequest(poisoned);
  assert.equal(r.ok, true);
  assert.equal(r.request.fieldSet, "minimal_discovery");
  assert.notEqual(r.request.fieldSet, poisoned.fieldSet);
});

test("B. latitude/longitude out of range are rejected", () => {
  assert.equal(validateDiscoverySearchRequest(base({ latitude: 91 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ latitude: -91 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ longitude: 181 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ latitude: NaN })).ok, false);
});

test("B. radiusMeters out of [0, 50000] is rejected", () => {
  assert.equal(validateDiscoverySearchRequest(base({ latitude: 1, longitude: 1, radiusMeters: -1 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ latitude: 1, longitude: 1, radiusMeters: 100_000 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ latitude: 1, longitude: 1, radiusMeters: 5000 })).ok, true);
});

test("B. non-string country/region/city/category are rejected, not silently coerced", () => {
  assert.equal(validateDiscoverySearchRequest(base({ country: 123 })).ok, false);
  assert.equal(validateDiscoverySearchRequest(base({ city: {} })).ok, false);
});

test("B. empty/whitespace-only optional strings normalize to null, not an empty string", () => {
  const r = validateDiscoverySearchRequest(base({ region: "   " }));
  assert.equal(r.ok, true);
  assert.equal(r.request.region, null);
});

// ---- N. pagination abstraction ----

test("N. cursor is opaque: an arbitrary string round-trips through validation unchanged, the core never interprets it", () => {
  const r = validateDiscoverySearchRequest(base({ cursor: "whatever-a-provider-happened-to-issue==" }));
  assert.equal(r.ok, true);
  assert.equal(r.request.cursor, "whatever-a-provider-happened-to-issue==");
});

test("N. no cursor provided -> null, meaning 'first page', never an empty string", () => {
  const r = validateDiscoverySearchRequest(base());
  assert.equal(r.ok, true);
  assert.equal(r.request.cursor, null);
});
