/**
 * RADAR DISCOVERY ENGINE — Phase C-0 — Google Places adapter DESIGN.
 *
 * ZERO NETWORK CALLS. This module contains only PURE functions: how a
 * generic DiscoverySearchRequest WOULD be translated into a Google Places
 * (New) request shape, how a Google Places (New) response WOULD be
 * normalized into our internal DiscoveryProviderResult, how a Google
 * error WOULD be classified into our DiscoveryError taxonomy, and which
 * internal fields map onto which Google field-mask paths. No `fetch`, no
 * `googleapis` import, no API key, no HTTP client of any kind — the
 * actual network-calling implementation (an isolated HTTP client module)
 * is DELIBERATELY DEFERRED to a later phase, exactly as this phase's
 * mission requires ("privilégier une architecture HTTP adapter isolée
 * qui sera implémentée ultérieurement"). This file provides everything a
 * future real implementation would call.
 *
 * `googleapis` (already a dependency of this repo, used for GBP/Search
 * Console/Analytics/Ads — see package.json) is NOT used here. The Places
 * API (New) is a plain REST API (`https://places.googleapis.com/v1/...`)
 * and is not part of the `googleapis` npm package's covered surface
 * (that package wraps Google Cloud/Workspace API clients, not the Maps
 * Platform family) — a future real implementation would use a small,
 * isolated fetch-based HTTP client, not that SDK. This observation is
 * noted, not verified against a live call (forbidden in this phase).
 *
 * IMPORTANT — UNVERIFIED AGAINST LIVE GOOGLE DOCUMENTATION: the field
 * names and error-envelope shape below are designed against the
 * PUBLICLY DOCUMENTED, stable conventions of the Places API (New) as
 * generally known — this phase performed NO network call and fetched NO
 * live documentation to confirm they are still exactly current. Anyone
 * wiring the real HTTP adapter in a later phase MUST re-verify every
 * field name and error shape against Google's current documentation
 * before relying on it — this module is a design, not a verified
 * integration.
 *
 * GOOGLE PLACES CORRECTION (verified against official Google Places API
 * (New) documentation, still no live network call): the ORIGINAL version
 * of this file incorrectly claimed timezone is never available from
 * Places API — corrected below. `email` was also re-worded for accuracy.
 *
 * WHAT GOOGLE PLACES DOES / DOES NOT PROVIDE (mission section 7's
 * explicit requirement — must be documented precisely, never silently
 * assumed available OR unavailable):
 *  - email: NOT available as a standard contact field in the Place Data
 *    Fields this adapter uses — there is no `email`-equivalent field
 *    documented alongside `websiteUri`/`internationalPhoneNumber`.
 *    `email` stays nullable in our internal model; normalizeGooglePlacesResult()
 *    always sets it to `null` for a Google-sourced result — NEVER derived
 *    from the website domain, never scraped, never guessed by any means.
 *  - timezone: IS available from Places API (New) — `timeZone`
 *    (an IANA identifier, e.g. "America/Montreal") and `utcOffsetMinutes`
 *    are both real, documented fields, requestable via the field mask
 *    like any other. This adapter normalizes them VERBATIM when present
 *    (see normalizeGooglePlacesResult()) — it does NOT compute a local
 *    time, does NOT apply DST logic, and does NOT derive an open/closed
 *    state from them; that remains out of scope for this phase (Phase
 *    B's own "no timezone computation" rule still holds — this adapter
 *    only relays a value the provider already computed, never computes
 *    one itself). MISSION C-2D-3 — `timezone` (only) moved into the
 *    "minimal_discovery" field-set tier (field-masks.ts): official Google
 *    billing documentation confirms it shares the same SKU as every other
 *    minimal_discovery field already, so requesting it adds no
 *    incremental cost tier. `utcOffsetMinutes` stays "details"-tier only
 *    — it is never persisted (a stale snapshot the instant DST changes)
 *    and no caller requests it.
 *  - country/region/city as separate fields: Places API (New) does not
 *    return these as three flat strings — it returns `addressComponents`
 *    (a typed array) or a single `formattedAddress` string. The
 *    normalizer below extracts country/region/city from
 *    `addressComponents` by documented Google component "types"
 *    ("country", "administrative_area_level_1", "locality") — NEVER by
 *    splitting/regex-parsing `formattedAddress` (too fragile — address
 *    formats vary per country and are not a structured contract). A
 *    component type genuinely absent from a given place's response
 *    normalizes to `null`, never fabricated.
 *  - category: `primaryType` (a single string — Places API (New)'s own
 *    purpose-built "the one main type" field) is preferred when present;
 *    `types[0]` (an array, ordered most-to-least specific) is used only
 *    as a fallback when `primaryType` is absent from a partial response.
 *  - `id` vs `name`: the Places API (New) resource `name` field is a
 *    RESOURCE PATH (`places/PLACE_ID`), not a display name and not a
 *    standalone id — `displayName` is the human-readable name, and the
 *    standalone `id` field (NOT `name`) is what this adapter uses for
 *    `sourceId`, per this correction's explicit requirement. This
 *    adapter never reads a `name` field on the raw result at all.
 *  - not consumed by this phase's internal model at all (verified as
 *    real, current Places (New) fields, but this phase's model has no
 *    slot for them and computing anything from them is explicitly out of
 *    scope): `nationalPhoneNumber` (internationalPhoneNumber is preferred
 *    — same E.164-leaning preference already established by Phase A's
 *    crm-client-dedup.ts), `currentOpeningHours`, `nextOpenTime`,
 *    `nextCloseTime` (all three are "computed relative to now" shapes —
 *    normalizing them would cross into the "open/closed state" territory
 *    this phase explicitly excludes; only the static `regularOpeningHours`
 *    schedule is normalized, via `openingHours`).
 */
import { toDiscoveryError, type DiscoveryError } from "../errors";
import { DISCOVERY_FIELD_SET_FIELDS, resolveCumulativeFields } from "../field-masks";
import type { DiscoveryFieldSet, DiscoveryProviderCapability, DiscoveryProviderResult, DiscoverySearchRequest } from "../types";

export const GOOGLE_PLACES_PROVIDER_ID = "google_places";

export const GOOGLE_PLACES_CAPABILITIES: readonly DiscoveryProviderCapability[] = ["search"];

// ---------------------------------------------------------------------
// Field mask — internal field -> Google Places (New) field-mask path.
// Every entry here is a `places.<field>` path under a Text Search /
// Nearby Search response, per the field-set boundaries already defined
// in field-masks.ts (mission section 8: never request more than a tier
// needs) — never the `*` wildcard, which this design never uses. No
// entry exists for `email` — there is no Google field to request (see
// this file's own header). `timezone`/`utcOffsetMinutes` DO have real
// entries now (GOOGLE PLACES CORRECTION) — `places.timeZone` /
// `places.utcOffsetMinutes`. MISSION C-2D-3: `timezone` is now requested
// at the "minimal_discovery" tier (same Google billing SKU as the rest
// of that tier); `utcOffsetMinutes` remains "details"-tier only (never
// persisted — see field-masks.ts's own comment).
// ---------------------------------------------------------------------

// A field may need MORE than one Google path — `category` is the one
// case in this design: `places.primaryType` (Places (New)'s own
// purpose-built single-category field) is preferred, with
// `places.types` requested too so normalizeGooglePlacesResult() has a
// real fallback available for a response where `primaryType` happens to
// be absent (Google's own docs note it is not guaranteed present for
// every place).
const INTERNAL_FIELD_TO_GOOGLE_PATH: Partial<Record<keyof DiscoveryProviderResult, string | readonly string[]>> = {
  sourceId: "places.id",
  sourceUrl: "places.googleMapsUri",
  name: "places.displayName",
  category: ["places.primaryType", "places.types"],
  address: "places.formattedAddress",
  country: "places.addressComponents",
  region: "places.addressComponents",
  city: "places.addressComponents",
  latitude: "places.location",
  longitude: "places.location",
  phone: "places.internationalPhoneNumber",
  website: "places.websiteUri",
  postalCode: "places.addressComponents",
  timezone: "places.timeZone",
  utcOffsetMinutes: "places.utcOffsetMinutes",
  openingHours: "places.regularOpeningHours",
};

/**
 * Builds the Google field-mask string (comma-separated, no duplicates)
 * for a given internal field set — the ONLY function in this codebase
 * that knows Google's `places.<field>` path syntax.
 */
export function buildGooglePlacesFieldMask(fieldSet: DiscoveryFieldSet): string {
  const internalFields = resolveCumulativeFields(fieldSet);
  const googlePaths = new Set<string>();
  for (const field of internalFields) {
    const path = INTERNAL_FIELD_TO_GOOGLE_PATH[field];
    if (!path) continue;
    if (Array.isArray(path)) {
      for (const p of path) googlePaths.add(p);
    } else {
      googlePaths.add(path as string);
    }
  }
  return [...googlePaths].join(",");
}

// ---------------------------------------------------------------------
// Request translation — pure. Describes what a real HTTP call would
// send; never performs one.
// ---------------------------------------------------------------------

/** A descriptive, provider-shaped request — what a future HTTP client
 * module would actually POST. Never executed here. */
export type GooglePlacesSearchRequestDescriptor = {
  endpoint: "places:searchText";
  method: "POST";
  fieldMask: string;
  body: {
    textQuery: string;
    pageSize: number;
    pageToken?: string;
    locationBias?: { circle: { center: { latitude: number; longitude: number }; radius: number } };
  };
};

/**
 * Translates a generic DiscoverySearchRequest into the shape a Places
 * (New) Text Search call would use. `textQuery` is built from
 * category + city + region + country — the same free-text composition a
 * human would type into Google Maps search, since Text Search (unlike
 * Nearby Search) has no separate structured country/region/city
 * parameters at all.
 */
export function buildGooglePlacesSearchRequest(request: DiscoverySearchRequest): GooglePlacesSearchRequestDescriptor {
  const queryParts = [request.category, request.city, request.region, request.country].filter((part): part is string => typeof part === "string" && part.length > 0);
  const textQuery = queryParts.join(" ");

  const descriptor: GooglePlacesSearchRequestDescriptor = {
    endpoint: "places:searchText",
    method: "POST",
    fieldMask: buildGooglePlacesFieldMask(request.fieldSet),
    body: {
      textQuery,
      pageSize: request.maxResults,
    },
  };
  if (request.cursor) descriptor.body.pageToken = request.cursor;
  if (typeof request.latitude === "number" && typeof request.longitude === "number") {
    descriptor.body.locationBias = {
      circle: {
        center: { latitude: request.latitude, longitude: request.longitude },
        radius: request.radiusMeters ?? 5_000,
      },
    };
  }
  return descriptor;
}

// ---------------------------------------------------------------------
// Response normalization — pure. Converts a Google-shaped raw place
// object into our internal DiscoveryProviderResult. Never trusts a
// missing field's absence as an error — a genuinely partial Google
// response normalizes every missing field to `null`, never a guessed
// value (mission section 5/12: external data is untrusted, never
// fabricated).
// ---------------------------------------------------------------------

/** A minimal, LOCALLY-DEFINED type describing the shape of one place
 * object in a Places (New) response — NOT imported from any Google SDK
 * (none is used). Deliberately loose/partial (every field optional) —
 * exactly what a real, partial API response looks like. */
export type GooglePlacesRawResult = {
  id?: string;
  displayName?: { text?: string };
  googleMapsUri?: string;
  /** Places (New)'s own single-category field — preferred over `types`
   * for `category` when present (GOOGLE PLACES CORRECTION). */
  primaryType?: string;
  types?: string[];
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  internationalPhoneNumber?: string;
  websiteUri?: string;
  /** google.type.TimeZone-shaped — an IANA identifier under `id`
   * (GOOGLE PLACES CORRECTION: genuinely available, see this file's own
   * header). Loosely typed (`id` optional) since this phase performed no
   * live verification of the exact nested proto shape. */
  timeZone?: { id?: string };
  /** Minutes offset from UTC (GOOGLE PLACES CORRECTION). */
  utcOffsetMinutes?: number;
  regularOpeningHours?: unknown;
};

function findAddressComponent(components: GooglePlacesRawResult["addressComponents"], type: string): string | null {
  if (!Array.isArray(components)) return null;
  const match = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  return typeof match?.longText === "string" && match.longText.length > 0 ? match.longText : null;
}

/**
 * Normalizes ONE raw Google Places (New) result into our internal model.
 * `source` is always the fixed GOOGLE_PLACES_PROVIDER_ID — never read
 * from the raw payload (a provider can never claim to be a different
 * provider). Throws (never silently substitutes) if `id` — the one field
 * everything else depends on for provenance — is missing; every other
 * field degrades to `null`.
 */
export function normalizeGooglePlacesResult(raw: GooglePlacesRawResult): DiscoveryProviderResult {
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new Error("google_places: raw result has no place id -- cannot establish provenance");
  }
  return {
    source: GOOGLE_PLACES_PROVIDER_ID,
    sourceId: raw.id,
    sourceUrl: typeof raw.googleMapsUri === "string" ? raw.googleMapsUri : null,
    name: typeof raw.displayName?.text === "string" && raw.displayName.text.length > 0 ? raw.displayName.text : "",
    // GOOGLE PLACES CORRECTION: `primaryType` (a single, purpose-built
    // category field) is preferred; `types[0]` (most-to-least-specific
    // array) is only a fallback for a response where primaryType happens
    // to be absent -- see this file's own header.
    category:
      typeof raw.primaryType === "string" && raw.primaryType.length > 0
        ? raw.primaryType
        : Array.isArray(raw.types) && raw.types.length > 0
          ? raw.types[0]
          : null,
    address: typeof raw.formattedAddress === "string" ? raw.formattedAddress : null,
    country: findAddressComponent(raw.addressComponents, "country"),
    region: findAddressComponent(raw.addressComponents, "administrative_area_level_1"),
    city: findAddressComponent(raw.addressComponents, "locality"),
    postalCode: findAddressComponent(raw.addressComponents, "postal_code"),
    phone: typeof raw.internationalPhoneNumber === "string" ? raw.internationalPhoneNumber : null,
    // NOT a standard Places contact field -- see this file's own header.
    // Never derived from the website domain or anything else.
    email: null,
    website: typeof raw.websiteUri === "string" ? raw.websiteUri : null,
    latitude: typeof raw.location?.latitude === "number" ? raw.location.latitude : null,
    longitude: typeof raw.location?.longitude === "number" ? raw.location.longitude : null,
    // GOOGLE PLACES CORRECTION: genuinely available -- relayed verbatim,
    // never computed (no DST/local-time math happens here).
    timezone: typeof raw.timeZone?.id === "string" && raw.timeZone.id.length > 0 ? raw.timeZone.id : null,
    utcOffsetMinutes: typeof raw.utcOffsetMinutes === "number" ? raw.utcOffsetMinutes : null,
    openingHours: raw.regularOpeningHours ?? null,
  };
}

/** A minimal, locally-defined shape for a Places (New) SEARCH response —
 * NOT a full SDK type. `nextPageToken`'s absence means no further page. */
export type GooglePlacesSearchResponse = {
  places?: GooglePlacesRawResult[];
  nextPageToken?: string;
};

/**
 * Normalizes a full search response, INCLUDING pagination — the only
 * place the provider-specific `nextPageToken` name is ever read; it
 * becomes the generic, opaque `nextCursor` the core understands. A place
 * missing its `id` is dropped (with the caller's own telemetry/logging
 * layer, not built in this phase, responsible for recording that this
 * happened) rather than aborting the entire batch.
 */
export function normalizeGooglePlacesSearchResponse(raw: GooglePlacesSearchResponse): { results: DiscoveryProviderResult[]; nextCursor: string | null } {
  const rawPlaces = Array.isArray(raw.places) ? raw.places : [];
  const results: DiscoveryProviderResult[] = [];
  for (const place of rawPlaces) {
    try {
      results.push(normalizeGooglePlacesResult(place));
    } catch {
      // Missing id -- see normalizeGooglePlacesResult's own contract;
      // skip rather than fail the whole page.
    }
  }
  return { results, nextCursor: typeof raw.nextPageToken === "string" && raw.nextPageToken.length > 0 ? raw.nextPageToken : null };
}

// ---------------------------------------------------------------------
// Error classification — pure. A Places (New) error envelope generally
// looks like `{ error: { code: <http-status-number>, message, status:
// <GRPC_STYLE_STRING> } }` per Google's standard API error model.
// ---------------------------------------------------------------------

export type GooglePlacesRawError = {
  error?: { code?: number; status?: string; message?: string };
  status?: number;
};

/**
 * Classifies a raw Google Places error into our internal DiscoveryError.
 * Reuses toDiscoveryError()'s own generic HTTP-status classification as
 * the fallback — this function only adds the Google-specific gRPC
 * `status` string vocabulary on top. `message` is read only to detect
 * known shapes; it is NEVER copied into the returned DiscoveryError (the
 * SAME "never leak provider text" discipline as radar-intelligence's own
 * toIntelligenceError()).
 */
export function classifyGooglePlacesError(raw: GooglePlacesRawError): DiscoveryError {
  const httpStatus = raw.error?.code ?? raw.status;
  const grpcStatus = raw.error?.status;

  if (grpcStatus === "RESOURCE_EXHAUSTED" || httpStatus === 429) {
    return toDiscoveryError({ status: 429 }, GOOGLE_PLACES_PROVIDER_ID);
  }
  if (grpcStatus === "DEADLINE_EXCEEDED") {
    return toDiscoveryError({ name: "TimeoutError" }, GOOGLE_PLACES_PROVIDER_ID);
  }
  if (grpcStatus === "UNAVAILABLE" || httpStatus === 503) {
    return toDiscoveryError({ status: 503 }, GOOGLE_PLACES_PROVIDER_ID);
  }
  return toDiscoveryError(typeof httpStatus === "number" ? { status: httpStatus } : {}, GOOGLE_PLACES_PROVIDER_ID);
}

// Re-exported for tests / a future registry wiring — see field-masks.ts
// for the field-set constant itself.
export { DISCOVERY_FIELD_SET_FIELDS };
