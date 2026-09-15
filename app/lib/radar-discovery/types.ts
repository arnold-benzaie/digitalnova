/**
 * RADAR DISCOVERY ENGINE — Phase C-0 — provider-agnostic core types.
 *
 * Nothing in this file may name a specific provider (no "google", "places",
 * "bing", ...) — see this directory's own header on why the core must
 * never depend on any one source. A provider ADAPTER (e.g.
 * adapters/google-places.ts) translates between these generic shapes and
 * whatever a real provider's API actually looks like; the core never sees
 * the provider's own vocabulary.
 *
 * Deliberately mirrors the SHAPE of lib/radar-intelligence/types.ts's own
 * connection/capability/status modeling (closed-set arrays + derived
 * union types + `isX()` guards) — the same proven pattern, re-typed for a
 * different domain. NOT a direct reuse: IntelligenceProviderId is a
 * CLOSED set anchored to real, already-registered AI adapters compiled
 * into that layer; no discovery adapter is registered anywhere yet, so
 * DiscoveryProviderId stays a plain `string` here — an individual adapter
 * module (google-places.ts) commits to its own literal id, but the core
 * registry type does not close the set. This mirrors the exact same
 * reasoning already applied to db/schema.ts's `discovery_results.source`
 * column (Phase B): free text, not a closed CHECK, because no adapter
 * exists yet to anchor a closed list against.
 */

// ---------------------------------------------------------------------
// Provider identity / capability / connection state
// ---------------------------------------------------------------------

export type DiscoveryProviderId = string;

/** What kind of operation a provider can perform. `search` is the only
 * capability any adapter implements in this phase; `get_details` is
 * listed here only because the field-mask design (field-masks.ts)
 * already separates a future "enrichment" tier from search — no adapter
 * declares it yet, and none is required to. */
export const DISCOVERY_PROVIDER_CAPABILITIES = ["search", "get_details"] as const;
export type DiscoveryProviderCapability = (typeof DISCOVERY_PROVIDER_CAPABILITIES)[number];

export function isDiscoveryProviderCapability(value: unknown): value is DiscoveryProviderCapability {
  return typeof value === "string" && (DISCOVERY_PROVIDER_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Mission section 11's own exact vocabulary (kept lowercase, unlike
 * radar-intelligence's UPPERCASE connection/health states, to match that
 * section verbatim): connected / disconnected / degraded / limited /
 * unavailable. A single closed set rather than radar-intelligence's two
 * orthogonal axes (connection x health) — Discovery has no "disabled by
 * policy" state to distinguish yet (no OWNER governance exists for this
 * layer in this phase; see this directory's cost/quota design notes).
 */
export const DISCOVERY_PROVIDER_CONNECTION_STATES = ["connected", "disconnected", "degraded", "limited", "unavailable"] as const;
export type DiscoveryProviderConnectionState = (typeof DISCOVERY_PROVIDER_CONNECTION_STATES)[number];

export function isDiscoveryProviderConnectionState(value: unknown): value is DiscoveryProviderConnectionState {
  return typeof value === "string" && (DISCOVERY_PROVIDER_CONNECTION_STATES as readonly string[]).includes(value);
}

export type DiscoveryProviderStatus = {
  id: DiscoveryProviderId;
  state: DiscoveryProviderConnectionState;
  capabilities: readonly DiscoveryProviderCapability[];
  /** ISO-8601, or null if never checked. */
  lastCheckedAt: string | null;
};

// ---------------------------------------------------------------------
// Field sets — mission section 8: never mix a cheap search with a costly
// enrichment call by default. Deliberately GENERIC names — a provider
// adapter is the ONLY place that maps these onto its own real field
// mask/parameter syntax (see field-masks.ts and adapters/google-places.ts).
// ---------------------------------------------------------------------

export const DISCOVERY_FIELD_SETS = ["minimal_discovery", "enrichment", "details"] as const;
export type DiscoveryFieldSet = (typeof DISCOVERY_FIELD_SETS)[number];

export function isDiscoveryFieldSet(value: unknown): value is DiscoveryFieldSet {
  return typeof value === "string" && (DISCOVERY_FIELD_SETS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// Search request — the ONLY shape a caller (a future Discovery Gateway /
// server action) ever builds. Never references a provider's own
// parameter names (mission section 5's explicit "googleTextQuery" /
// "googlePageToken" / "googleRadiusType" counter-examples). World/
// country/region/city filtering UI is NOT built in this phase — this is
// only the data shape a future one would eventually populate.
// ---------------------------------------------------------------------

export type DiscoverySearchRequest = {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  /** Free-text category/query, e.g. "restaurants", "agences digitales". */
  category?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number | null;
  /** Opaque pagination token from a PREVIOUS DiscoverySearchOutcome — the
   * core never constructs, inspects, or interprets this string; only a
   * provider adapter that issued it can make sense of it. */
  cursor?: string | null;
  /** Hard cap on how many results a single search() call may return —
   * never "as many as the provider wants to give us". */
  maxResults: number;
  fieldSet: DiscoveryFieldSet;
};

export const DISCOVERY_SEARCH_MAX_RESULTS_CEILING = 100;

// ---------------------------------------------------------------------
// Provider result — what an adapter's search() resolves to per item,
// BEFORE it becomes a discovery_results row. Structurally identical to
// lib/radar-discovery/discovery-result-store.ts's own DiscoveryResultInput
// (Phase B) but DELIBERATELY a separate, independently-defined type, not
// an import of it: a provider adapter must never depend on
// `@/db/schema`-derived persistence types (providers know nothing about
// how/whether their output gets stored), and this type represents a
// DIFFERENT pipeline stage (mission section 15: "B. Discovery Provider"
// vs "D. Discovery Result Store" are separate responsibilities). A future
// ingestion action maps one onto the other field-for-field — kept in
// sync by convention/tests, not by a shared type.
// ---------------------------------------------------------------------

export type DiscoveryProviderResult = {
  source: DiscoveryProviderId;
  sourceId: string;
  sourceUrl?: string | null;
  name: string;
  category?: string | null;
  address?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** An IANA timezone identifier (e.g. "America/Montreal"), when a
   * provider supplies one directly — never computed/derived here or
   * anywhere in this phase (no geocoding, no DST math — see
   * adapters/google-places.ts's own correction notes). */
  timezone?: string | null;
  /** Minutes offset from UTC, when a provider supplies one directly
   * alongside `timezone` — GOOGLE PLACES CORRECTION (verified against
   * official documentation): Places API (New) exposes both `timeZone`
   * and `utcOffsetMinutes`; this field exists on the PROVIDER-RESULT
   * type only (not yet a discovery_results column — Phase B's schema is
   * intentionally unmodified in this correction; persisting this value
   * is a future phase's migration, not built here). Never computed from
   * `timezone` or from `country` — only ever a verbatim provider value. */
  utcOffsetMinutes?: number | null;
  openingHours?: unknown;
};

/** What a successful search() call resolves to. `nextCursor: null` means
 * no further page exists — the core never infers this any other way
 * (e.g. "fewer than maxResults returned" is NOT treated as end-of-results
 * by itself, since a provider may legitimately paginate short pages). */
export type DiscoverySearchOutcome = {
  results: readonly DiscoveryProviderResult[];
  nextCursor: string | null;
};
