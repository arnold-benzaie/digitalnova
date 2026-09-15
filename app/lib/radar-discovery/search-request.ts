/**
 * RADAR DISCOVERY ENGINE — Phase C-0 — DiscoverySearchRequest validation.
 *
 * Pure, provider-agnostic. A future Discovery Gateway (not built in this
 * phase) would call this BEFORE ever consulting the provider registry —
 * exactly like advisory-core.ts validates `clientId` before touching a
 * registry/router. Never trusts a caller-supplied value merely because it
 * type-checked; every field is independently re-validated here.
 */
import { DISCOVERY_FIELD_SETS, DISCOVERY_SEARCH_MAX_RESULTS_CEILING, isDiscoveryFieldSet, type DiscoverySearchRequest } from "./types";

export type SearchRequestValidationResult = { ok: true; request: DiscoverySearchRequest } | { ok: false; reason: string };

function optionalTrimmedString(value: unknown, field: string): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, reason: `${field} must be a string` };
  const trimmed = value.trim();
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

function optionalFiniteNumber(value: unknown, field: string, min: number, max: number): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: `${field} must be a finite number` };
  if (value < min || value > max) return { ok: false, reason: `${field} out of range [${min}, ${max}]` };
  return { ok: true, value };
}

/**
 * Validates a raw candidate search request. Returns a NEW, fully
 * normalized `DiscoverySearchRequest` on success — never the caller's own
 * object (mirrors createDiscoveryResult()'s "hand-built literal, never a
 * spread" discipline from Phase B).
 */
export function validateDiscoverySearchRequest(candidate: unknown): SearchRequestValidationResult {
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, reason: "search request must be an object" };
  }
  const raw = candidate as Record<string, unknown>;

  const country = optionalTrimmedString(raw.country, "country");
  if (!country.ok) return country;
  const region = optionalTrimmedString(raw.region, "region");
  if (!region.ok) return region;
  const city = optionalTrimmedString(raw.city, "city");
  if (!city.ok) return city;
  const category = optionalTrimmedString(raw.category, "category");
  if (!category.ok) return category;
  const cursor = optionalTrimmedString(raw.cursor, "cursor");
  if (!cursor.ok) return cursor;

  const latitude = optionalFiniteNumber(raw.latitude, "latitude", -90, 90);
  if (!latitude.ok) return latitude;
  const longitude = optionalFiniteNumber(raw.longitude, "longitude", -180, 180);
  if (!longitude.ok) return longitude;
  const radiusMeters = optionalFiniteNumber(raw.radiusMeters, "radiusMeters", 0, 50_000);
  if (!radiusMeters.ok) return radiusMeters;

  if (typeof raw.maxResults !== "number" || !Number.isInteger(raw.maxResults) || raw.maxResults < 1 || raw.maxResults > DISCOVERY_SEARCH_MAX_RESULTS_CEILING) {
    return { ok: false, reason: `maxResults must be an integer between 1 and ${DISCOVERY_SEARCH_MAX_RESULTS_CEILING}` };
  }

  if (!isDiscoveryFieldSet(raw.fieldSet)) {
    return { ok: false, reason: `fieldSet must be one of ${DISCOVERY_FIELD_SETS.join(", ")}` };
  }

  // At least one geographic OR category signal is required — an entirely
  // empty request ("search everything, everywhere") is never valid in
  // this phase. World-scale search is explicitly a LATER phase's concern
  // (mission section 22) — this is a structural guard against it, not
  // that future feature's own implementation.
  if (!country.value && !region.value && !city.value && !category.value && latitude.value === null) {
    return { ok: false, reason: "at least one of country, region, city, category, or coordinates is required" };
  }

  return {
    ok: true,
    request: {
      country: country.value,
      region: region.value,
      city: city.value,
      category: category.value,
      latitude: latitude.value,
      longitude: longitude.value,
      radiusMeters: radiusMeters.value,
      cursor: cursor.value,
      maxResults: raw.maxResults,
      fieldSet: raw.fieldSet,
    },
  };
}
