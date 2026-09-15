/**
 * RADAR DISCOVERY ENGINE — Phase C-0 — small, LOCAL, representative
 * fixtures for the Google Places adapter's pure functions. Never fetched
 * from a real API, never a large verbatim Google payload, never a
 * secret. Test-only (imported by google-places.test.mjs).
 */
import type { GooglePlacesRawError, GooglePlacesRawResult, GooglePlacesSearchResponse } from "./google-places";

export const COMPLETE_RESULT: GooglePlacesRawResult = {
  id: "ChIJ_complete_result_id",
  displayName: { text: "Le Petit Bistro" },
  googleMapsUri: "https://maps.google.com/?cid=123",
  primaryType: "restaurant",
  types: ["restaurant", "food", "point_of_interest"],
  formattedAddress: "15 Rue du Faubourg, 75011 Paris, France",
  addressComponents: [
    { longText: "15", types: ["street_number"] },
    { longText: "Rue du Faubourg", types: ["route"] },
    { longText: "Paris", shortText: "Paris", types: ["locality"] },
    { longText: "Île-de-France", shortText: "IDF", types: ["administrative_area_level_1"] },
    { longText: "75011", types: ["postal_code"] },
    { longText: "France", shortText: "FR", types: ["country"] },
  ],
  location: { latitude: 48.8566, longitude: 2.3522 },
  internationalPhoneNumber: "+33 1 42 00 00 01",
  websiteUri: "https://lepetitbistro.example",
  timeZone: { id: "Europe/Paris" },
  utcOffsetMinutes: 60,
  regularOpeningHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 22, minute: 0 } }] },
};

export const PARTIAL_RESULT: GooglePlacesRawResult = {
  id: "ChIJ_partial_result_id",
  displayName: { text: "Garage Moreau Auto" },
  types: ["car_repair"],
  formattedAddress: "22 Avenue de la République, Lyon, France",
};

export const RESULT_NO_PHONE: GooglePlacesRawResult = {
  ...COMPLETE_RESULT,
  id: "ChIJ_no_phone_id",
  internationalPhoneNumber: undefined,
};

export const RESULT_NO_WEBSITE: GooglePlacesRawResult = {
  ...COMPLETE_RESULT,
  id: "ChIJ_no_website_id",
  websiteUri: undefined,
};

export const RESULT_NO_OPENING_HOURS: GooglePlacesRawResult = {
  ...COMPLETE_RESULT,
  id: "ChIJ_no_hours_id",
  regularOpeningHours: undefined,
};

// GOOGLE PLACES CORRECTION additions --------------------------------

/** Explicit timeZone + utcOffsetMinutes present -- mission section 10's
 * required fixture. */
export const RESULT_WITH_TIMEZONE: GooglePlacesRawResult = {
  id: "ChIJ_with_timezone_id",
  displayName: { text: "Institut Beauté Zen Maurice" },
  timeZone: { id: "Indian/Mauritius" },
  utcOffsetMinutes: 240,
};

/** No timeZone/utcOffsetMinutes at all -- the ordinary partial-response
 * case; both must normalize to null, never fabricated. */
export const RESULT_NO_TIMEZONE: GooglePlacesRawResult = {
  ...COMPLETE_RESULT,
  id: "ChIJ_no_timezone_id",
  timeZone: undefined,
  utcOffsetMinutes: undefined,
};

export const RESULT_WITH_COORDINATES: GooglePlacesRawResult = {
  id: "ChIJ_with_coords_id",
  displayName: { text: "Institut Beauté Zen" },
  location: { latitude: -20.348, longitude: 57.552 },
};

export const RESULT_MULTIPLE_CATEGORIES: GooglePlacesRawResult = {
  id: "ChIJ_multi_category_id",
  displayName: { text: "Cabinet Dentaire Santé Sourire" },
  types: ["dentist", "health", "point_of_interest", "establishment"],
};

/** primaryType DIFFERS from types[0] -- proves primaryType genuinely
 * takes precedence, not a coincidence of matching values. */
export const RESULT_PRIMARY_TYPE_DIFFERS_FROM_TYPES: GooglePlacesRawResult = {
  id: "ChIJ_primary_type_precedence_id",
  displayName: { text: "Mixed-Use Building Co" },
  primaryType: "shopping_mall",
  types: ["point_of_interest", "establishment", "shopping_mall"],
};

export const RESULT_MISSING_ID: GooglePlacesRawResult = {
  displayName: { text: "No Id Co" },
};

export const SEARCH_RESPONSE_WITH_PAGE_TOKEN: GooglePlacesSearchResponse = {
  places: [COMPLETE_RESULT, PARTIAL_RESULT],
  nextPageToken: "opaque-next-page-token-abc123",
};

export const SEARCH_RESPONSE_LAST_PAGE: GooglePlacesSearchResponse = {
  places: [COMPLETE_RESULT],
};

export const EMPTY_SEARCH_RESPONSE: GooglePlacesSearchResponse = {
  places: [],
};

export const RATE_LIMIT_ERROR: GooglePlacesRawError = {
  error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" },
};

export const UNAVAILABLE_ERROR: GooglePlacesRawError = {
  error: { code: 503, status: "UNAVAILABLE", message: "Service temporarily unavailable" },
};

export const TIMEOUT_ERROR: GooglePlacesRawError = {
  error: { status: "DEADLINE_EXCEEDED", message: "Request deadline exceeded" },
};

export const INVALID_ARGUMENT_ERROR: GooglePlacesRawError = {
  error: { code: 400, status: "INVALID_ARGUMENT", message: "textQuery is required" },
};
