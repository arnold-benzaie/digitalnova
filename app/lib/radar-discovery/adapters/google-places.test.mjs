// RADAR DISCOVERY ENGINE — Phase C-0 — google-places.ts adapter unit
// tests. Pure, no mocks, NO NETWORK CALL of any kind — every input is a
// small local fixture (google-places.fixtures.ts). Covers mission
// section 18 items C, D, E, F, G, H, I, J, K, M (Google-specific half),
// N (Google-specific half).
//
// Run: npx tsx --test lib/radar-discovery/adapters/google-places.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGooglePlacesFieldMask,
  buildGooglePlacesSearchRequest,
  classifyGooglePlacesError,
  GOOGLE_PLACES_CAPABILITIES,
  GOOGLE_PLACES_PROVIDER_ID,
  normalizeGooglePlacesResult,
  normalizeGooglePlacesSearchResponse,
} from "./google-places.ts";
import {
  COMPLETE_RESULT,
  EMPTY_SEARCH_RESPONSE,
  INVALID_ARGUMENT_ERROR,
  PARTIAL_RESULT,
  RATE_LIMIT_ERROR,
  RESULT_MISSING_ID,
  RESULT_MULTIPLE_CATEGORIES,
  RESULT_NO_OPENING_HOURS,
  RESULT_NO_PHONE,
  RESULT_NO_TIMEZONE,
  RESULT_NO_WEBSITE,
  RESULT_PRIMARY_TYPE_DIFFERS_FROM_TYPES,
  RESULT_WITH_COORDINATES,
  RESULT_WITH_TIMEZONE,
  SEARCH_RESPONSE_LAST_PAGE,
  SEARCH_RESPONSE_WITH_PAGE_TOKEN,
  TIMEOUT_ERROR,
  UNAVAILABLE_ERROR,
} from "./google-places.fixtures.ts";

// ---- O. capability declaration (adapter level) ----

test("O. GOOGLE_PLACES_CAPABILITIES declares exactly 'search' -- no get_details in this phase", () => {
  assert.deepEqual([...GOOGLE_PLACES_CAPABILITIES], ["search"]);
});

// ---- G. source/sourceId ----

test("G. source is always the fixed provider id, never read from the raw payload", () => {
  const result = normalizeGooglePlacesResult(COMPLETE_RESULT);
  assert.equal(result.source, GOOGLE_PLACES_PROVIDER_ID);
  assert.equal(result.source, "google_places");
});

test("G. sourceId comes from the Google place id", () => {
  const result = normalizeGooglePlacesResult(COMPLETE_RESULT);
  assert.equal(result.sourceId, "ChIJ_complete_result_id");
});

test("G. a result with no place id throws -- provenance cannot be established, never silently substituted", () => {
  assert.throws(() => normalizeGooglePlacesResult(RESULT_MISSING_ID));
});

// ---- C. normalization of a complete provider result ----

test("C. a complete result normalizes every field correctly", () => {
  const result = normalizeGooglePlacesResult(COMPLETE_RESULT);
  assert.equal(result.name, "Le Petit Bistro");
  assert.equal(result.sourceUrl, "https://maps.google.com/?cid=123");
  assert.equal(result.phone, "+33 1 42 00 00 01");
  assert.equal(result.website, "https://lepetitbistro.example");
  assert.deepEqual(result.openingHours, COMPLETE_RESULT.regularOpeningHours);
});

test("C. email is ALWAYS null for a Google-sourced result -- no standard email contact field exists in the Place Data Fields this adapter uses, never guessed from the website domain", () => {
  const result = normalizeGooglePlacesResult(COMPLETE_RESULT);
  assert.equal(result.email, null);
});

// ---- GOOGLE PLACES CORRECTION: timezone IS genuinely available ----

test("CORRECTION: timeZone.id + utcOffsetMinutes normalize verbatim when present -- Places API (New) genuinely exposes both", () => {
  const result = normalizeGooglePlacesResult(RESULT_WITH_TIMEZONE);
  assert.equal(result.timezone, "Indian/Mauritius");
  assert.equal(result.utcOffsetMinutes, 240);
});

test("CORRECTION: a complete result's timezone/utcOffsetMinutes also normalize correctly (not just an isolated minimal fixture)", () => {
  const result = normalizeGooglePlacesResult(COMPLETE_RESULT);
  assert.equal(result.timezone, "Europe/Paris");
  assert.equal(result.utcOffsetMinutes, 60);
});

test("CORRECTION: no timeZone/utcOffsetMinutes present -- both normalize to null, never fabricated, never derived from country", () => {
  const result = normalizeGooglePlacesResult(RESULT_NO_TIMEZONE);
  assert.equal(result.timezone, null);
  assert.equal(result.utcOffsetMinutes, null);
});

test("CORRECTION: this adapter never computes a local time, DST state, or open/closed status from timezone data -- it only relays what the provider already supplied, verbatim", () => {
  const result = normalizeGooglePlacesResult(RESULT_WITH_TIMEZONE);
  assert.equal(typeof result.timezone, "string", "timezone is a plain IANA-id string, never an object with derived fields");
  assert.ok(!("localTime" in result), "no derived localTime field exists anywhere on the internal model");
  assert.ok(!("isOpenNow" in result), "no derived open/closed field exists anywhere on the internal model");
});

// ---- D. address transformation ----

test("D. address components are extracted by Google's documented component 'types', never by array position", () => {
  const result = normalizeGooglePlacesResult(COMPLETE_RESULT);
  assert.equal(result.country, "France");
  assert.equal(result.region, "Île-de-France");
  assert.equal(result.city, "Paris");
  assert.equal(result.postalCode, "75011");
  assert.equal(result.address, "15 Rue du Faubourg, 75011 Paris, France");
});

test("D. a result with no addressComponents at all normalizes every address-component field to null, never throws", () => {
  const result = normalizeGooglePlacesResult(PARTIAL_RESULT);
  assert.equal(result.country, null);
  assert.equal(result.region, null);
  assert.equal(result.city, null);
  assert.equal(result.postalCode, null);
  assert.equal(result.address, "22 Avenue de la République, Lyon, France", "formattedAddress is still used as a single string");
});

// ---- E. category transformation ----

test("E. category prefers primaryType when present", () => {
  const result = normalizeGooglePlacesResult(COMPLETE_RESULT);
  assert.equal(result.category, "restaurant");
});

test("CORRECTION: primaryType genuinely takes precedence over types[0], proven with a fixture where they differ", () => {
  const result = normalizeGooglePlacesResult(RESULT_PRIMARY_TYPE_DIFFERS_FROM_TYPES);
  assert.equal(result.category, "shopping_mall", "primaryType's value, not types[0] ('point_of_interest')");
});

test("E. no primaryType (partial response) falls back to types[0], the most-specific entry -- never joined/concatenated", () => {
  const result = normalizeGooglePlacesResult(RESULT_MULTIPLE_CATEGORIES);
  assert.equal(result.category, "dentist");
  assert.ok(!result.category.includes(","), "category must be a single value, not a joined list");
});

test("E. no primaryType AND no types array at all -> category is null", () => {
  const result = normalizeGooglePlacesResult(RESULT_WITH_COORDINATES);
  assert.equal(result.category, null);
});

// ---- F. coordinate transformation ----

test("F. latitude/longitude map directly from Google's location object", () => {
  const result = normalizeGooglePlacesResult(RESULT_WITH_COORDINATES);
  assert.equal(result.latitude, -20.348);
  assert.equal(result.longitude, 57.552);
});

test("F. no location object -> both null, never coerced to 0", () => {
  const result = normalizeGooglePlacesResult(PARTIAL_RESULT);
  assert.equal(result.latitude, null);
  assert.equal(result.longitude, null);
});

// ---- H. optional fields absent ----

test("H. no phone -> null, rest of the result still normalizes", () => {
  const result = normalizeGooglePlacesResult(RESULT_NO_PHONE);
  assert.equal(result.phone, null);
  assert.equal(result.name, "Le Petit Bistro");
});

test("H. no website -> null", () => {
  const result = normalizeGooglePlacesResult(RESULT_NO_WEBSITE);
  assert.equal(result.website, null);
});

test("H. no opening hours -> null, never an empty object fabricated", () => {
  const result = normalizeGooglePlacesResult(RESULT_NO_OPENING_HOURS);
  assert.equal(result.openingHours, null);
});

test("H. no displayName -> name normalizes to an empty string, never 'undefined' or null (name is required downstream)", () => {
  const result = normalizeGooglePlacesResult({ id: "has-id-no-name" });
  assert.equal(result.name, "");
});

// ---- I / J / K. error classification ----

test("I. RESOURCE_EXHAUSTED / HTTP 429 -> PROVIDER_RATE_LIMITED, never leaks the raw Google message", () => {
  const err = classifyGooglePlacesError(RATE_LIMIT_ERROR);
  assert.equal(err.code, "PROVIDER_RATE_LIMITED");
  assert.equal(err.providerId, "google_places");
  assert.ok(!JSON.stringify(err).includes("Quota exceeded"));
});

test("J. UNAVAILABLE / HTTP 503 -> PROVIDER_UNAVAILABLE", () => {
  const err = classifyGooglePlacesError(UNAVAILABLE_ERROR);
  assert.equal(err.code, "PROVIDER_UNAVAILABLE");
});

test("K. DEADLINE_EXCEEDED -> PROVIDER_TIMEOUT", () => {
  const err = classifyGooglePlacesError(TIMEOUT_ERROR);
  assert.equal(err.code, "PROVIDER_TIMEOUT");
  assert.equal(err.retryable, true);
});

test("I. INVALID_ARGUMENT / HTTP 400 -> PROVIDER_ERROR (a genuine 4xx, never treated as retryable)", () => {
  const err = classifyGooglePlacesError(INVALID_ARGUMENT_ERROR);
  assert.equal(err.code, "PROVIDER_ERROR");
  assert.equal(err.failureClass, "PROVIDER_4XX");
  assert.equal(err.retryable, false);
});

test("I. an error with neither a recognized grpcStatus nor a recognized HTTP code still resolves to a safe PROVIDER_ERROR, never throws", () => {
  const err = classifyGooglePlacesError({});
  assert.equal(err.code, "PROVIDER_ERROR");
});

// ---- M. field mask construction ----

test("M. minimal_discovery field mask never includes phone/email/website paths", () => {
  const mask = buildGooglePlacesFieldMask("minimal_discovery");
  assert.ok(!mask.includes("internationalPhoneNumber"));
  assert.ok(!mask.includes("websiteUri"));
});

test("M. enrichment field mask includes phone/website paths on top of minimal_discovery's own", () => {
  const mask = buildGooglePlacesFieldMask("enrichment");
  assert.ok(mask.includes("places.internationalPhoneNumber"));
  assert.ok(mask.includes("places.websiteUri"));
  assert.ok(mask.includes("places.displayName"), "must still include the minimal_discovery fields");
});

test("M. details field mask includes opening hours on top of everything else", () => {
  const mask = buildGooglePlacesFieldMask("details");
  assert.ok(mask.includes("places.regularOpeningHours"));
});

test("CORRECTION: details field mask includes places.timeZone and places.utcOffsetMinutes -- genuinely requestable per official docs", () => {
  const mask = buildGooglePlacesFieldMask("details");
  assert.ok(mask.includes("places.timeZone"));
  assert.ok(mask.includes("places.utcOffsetMinutes"));
});

test("MISSION C-2D-3: minimal_discovery and enrichment field masks INCLUDE places.timeZone (moved from details -- same Google billing SKU as the rest of minimal_discovery, no incremental cost), but NEVER places.utcOffsetMinutes (stays details-tier only -- never persisted, see field-masks.ts)", () => {
  for (const fieldSet of ["minimal_discovery", "enrichment"]) {
    const mask = buildGooglePlacesFieldMask(fieldSet);
    assert.ok(mask.includes("places.timeZone"), `${fieldSet} must include places.timeZone`);
    assert.ok(!mask.includes("places.utcOffsetMinutes"), `${fieldSet} must never include places.utcOffsetMinutes`);
  }
});

test("CORRECTION: minimal_discovery field mask requests BOTH places.primaryType and places.types -- so the normalizer's documented fallback is real, not vestigial", () => {
  const mask = buildGooglePlacesFieldMask("minimal_discovery");
  assert.ok(mask.includes("places.primaryType"));
  assert.ok(mask.includes("places.types"));
});

test("M. field mask never contains a duplicate path even when several internal fields map to the same Google path", () => {
  // country/region/city/postalCode all map to places.addressComponents.
  const mask = buildGooglePlacesFieldMask("details");
  const paths = mask.split(",");
  assert.equal(paths.length, new Set(paths).size, "no duplicate field-mask path");
  assert.equal(paths.filter((p) => p === "places.addressComponents").length, 1);
});

test("no field mask, at any tier, ever contains the '*' wildcard -- never used in this design", () => {
  for (const fieldSet of ["minimal_discovery", "enrichment", "details"]) {
    assert.ok(!buildGooglePlacesFieldMask(fieldSet).includes("*"));
  }
});

test("buildGooglePlacesSearchRequest: composes textQuery from category+city+region+country, uses the fieldSet's own mask, never references Google-specific param names in the DiscoverySearchRequest input", () => {
  const descriptor = buildGooglePlacesSearchRequest({ category: "restaurants", city: "Montreal", region: "Quebec", country: "Canada", maxResults: 10, fieldSet: "minimal_discovery" });
  assert.equal(descriptor.endpoint, "places:searchText");
  assert.equal(descriptor.body.textQuery, "restaurants Montreal Quebec Canada");
  assert.equal(descriptor.body.pageSize, 10);
  assert.equal(descriptor.fieldMask, buildGooglePlacesFieldMask("minimal_discovery"));
  assert.equal(descriptor.body.pageToken, undefined, "no cursor -> no pageToken sent");
});

test("buildGooglePlacesSearchRequest: a cursor becomes pageToken, opaque and unmodified", () => {
  const descriptor = buildGooglePlacesSearchRequest({ category: "hotels", cursor: "abc==", maxResults: 10, fieldSet: "minimal_discovery" });
  assert.equal(descriptor.body.pageToken, "abc==");
});

test("buildGooglePlacesSearchRequest: coordinates + radius become a locationBias circle", () => {
  const descriptor = buildGooglePlacesSearchRequest({ category: "restaurants", latitude: 1.5, longitude: 2.5, radiusMeters: 3000, maxResults: 10, fieldSet: "minimal_discovery" });
  assert.deepEqual(descriptor.body.locationBias, { circle: { center: { latitude: 1.5, longitude: 2.5 }, radius: 3000 } });
});

test("buildGooglePlacesSearchRequest: never performs any network call -- purely returns a plain descriptor object", () => {
  const descriptor = buildGooglePlacesSearchRequest({ category: "restaurants", city: "Montreal", maxResults: 10, fieldSet: "minimal_discovery" });
  assert.equal(typeof descriptor, "object");
  assert.equal(descriptor instanceof Promise, false);
});

// ---- N. pagination abstraction ----

test("N. a nextPageToken becomes the generic, opaque nextCursor", () => {
  const { nextCursor } = normalizeGooglePlacesSearchResponse(SEARCH_RESPONSE_WITH_PAGE_TOKEN);
  assert.equal(nextCursor, "opaque-next-page-token-abc123");
});

test("N. no nextPageToken -> nextCursor is null, meaning the last page", () => {
  const { nextCursor } = normalizeGooglePlacesSearchResponse(SEARCH_RESPONSE_LAST_PAGE);
  assert.equal(nextCursor, null);
});

test("N. an empty response -> zero results, nextCursor null, never throws", () => {
  const { results, nextCursor } = normalizeGooglePlacesSearchResponse(EMPTY_SEARCH_RESPONSE);
  assert.deepEqual(results, []);
  assert.equal(nextCursor, null);
});

test("N. a batch with one missing-id place drops only that place, keeps the rest", () => {
  const { results } = normalizeGooglePlacesSearchResponse({ places: [COMPLETE_RESULT, RESULT_MISSING_ID, PARTIAL_RESULT] });
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.sourceId),
    ["ChIJ_complete_result_id", "ChIJ_partial_result_id"],
  );
});
