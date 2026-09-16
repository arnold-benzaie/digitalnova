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
 *
 * MISSION C-2D-3 — `timezone` is the one exception to "smallest set":
 * included in `minimal_discovery` despite not being a phone/website
 * contact field, because it shares Google's billing SKU with every other
 * minimal_discovery field already (no incremental cost) and is required
 * for the deterministic, non-AI local-time display this mission adds.
 */
import type { DiscoveryFieldSet, DiscoveryProviderResult } from "./types";

export const DISCOVERY_FIELD_SET_FIELDS: Record<DiscoveryFieldSet, readonly (keyof DiscoveryProviderResult)[]> = {
  // MISSION C-2D-3 — `timezone` moved here from the "details" tier
  // (product decision, per the C-2D-3 audit's own documented finding):
  // official Google billing documentation (verified in MISSION C-2D-2,
  // via WebFetch against developers.google.com, never guessed) confirms
  // `places.timeZone` belongs to the SAME "Text Search Pro" SKU as
  // `displayName`/`formattedAddress`/`addressComponents`/`location` —
  // every field minimal_discovery already requests. Requesting it here
  // adds NO incremental billing tier. `utcOffsetMinutes` is deliberately
  // NOT moved (stays details-only, see below) — it is never persisted
  // (a UTC-offset snapshot goes stale the instant DST changes; only the
  // IANA `timezone` string is a stable fact worth requesting by default).
  minimal_discovery: ["source", "sourceId", "sourceUrl", "name", "category", "address", "country", "region", "city", "latitude", "longitude", "timezone"],
  enrichment: ["phone", "email", "website"],
  // GOOGLE PLACES CORRECTION: utcOffsetMinutes is genuinely available
  // from Places API (New) — kept at the "details" tier on purpose: it is
  // never persisted (see MISSION C-2D-3's own decision) and no caller in
  // this codebase requests it, unlike `timezone` above.
  details: ["postalCode", "utcOffsetMinutes", "openingHours"],
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
