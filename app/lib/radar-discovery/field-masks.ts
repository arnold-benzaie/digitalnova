/**
 * RADAR DISCOVERY ENGINE — Phase C-0 — internal field-set -> field
 * mapping. Mission section 8: never request more than a step actually
 * needs, and never mix a cheap search with a costly enrichment call by
 * default. This file defines which INTERNAL DiscoveryProviderResult
 * fields each DiscoveryFieldSet implies are wanted — generic, no
 * provider vocabulary. A provider adapter (adapters/google-places.ts) is
 * the ONLY place that translates this into its own real field-mask
 * syntax; the core never speaks a provider's field-mask language.
 *
 * `minimal_discovery` is deliberately the smallest set that lets a future
 * UI render one result row (name + where + what) — nothing a first
 * display doesn't need. `enrichment` adds the fields a prospect actually
 * needs to be CONTACTED. `details` is everything this phase's internal
 * model can represent at all.
 */
import type { DiscoveryFieldSet, DiscoveryProviderResult } from "./types";

export const DISCOVERY_FIELD_SET_FIELDS: Record<DiscoveryFieldSet, readonly (keyof DiscoveryProviderResult)[]> = {
  minimal_discovery: ["source", "sourceId", "sourceUrl", "name", "category", "address", "country", "region", "city", "latitude", "longitude"],
  enrichment: ["phone", "email", "website"],
  // GOOGLE PLACES CORRECTION: timezone (`timeZone`) and utcOffsetMinutes
  // are genuinely available from Places API (New), unlike this phase's
  // original assumption — kept at the "details" tier (never
  // minimal_discovery/enrichment) since requesting them still has a real
  // field-mask cost, and no result-list UI needs them for a first
  // display.
  details: ["postalCode", "timezone", "utcOffsetMinutes", "openingHours"],
};

/** The cumulative field set up to and including `fieldSet` — "enrichment"
 * implies everything "minimal_discovery" already asked for, "details"
 * implies both of the others. A future gateway never has to remember
 * this ordering itself. */
export function resolveCumulativeFields(fieldSet: DiscoveryFieldSet): readonly (keyof DiscoveryProviderResult)[] {
  if (fieldSet === "minimal_discovery") return DISCOVERY_FIELD_SET_FIELDS.minimal_discovery;
  if (fieldSet === "enrichment") return [...DISCOVERY_FIELD_SET_FIELDS.minimal_discovery, ...DISCOVERY_FIELD_SET_FIELDS.enrichment];
  return [...DISCOVERY_FIELD_SET_FIELDS.minimal_discovery, ...DISCOVERY_FIELD_SET_FIELDS.enrichment, ...DISCOVERY_FIELD_SET_FIELDS.details];
}
