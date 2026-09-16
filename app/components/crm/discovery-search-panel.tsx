"use client";

/**
 * MISSION C-2C-1 — RADAR DISCOVERY UI — the entire interactive surface for
 * /admin/crm/discovery. PRESENTATION ONLY: every real decision (RBAC,
 * validation, actor rate limit, provider call, CRM dedup, persistence) is
 * already made by searchRadarDiscovery() (lib/actions/radar-discovery-
 * search.ts, Phase C-2A) — this component calls it, never reimplements or
 * bypasses any of it. It holds no role, permission, session, or CRM data
 * of its own.
 *
 * DATA DISCIPLINE: `RadarDiscoverySearchItem` (the C-2A contract; widened
 * additively by MISSION C-2C-1.5) carries `status`, `source`, `sourceId`,
 * `name` on every branch, plus — for created/already_discovered only —
 * `discoveryResultId`, `category`, `address`, `country`, `region`, `city`,
 * `latitude`, `longitude`. It still has NO phone/email/website/timezone/
 * postalCode/openingHours on the response items (those remain
 * enrichment/details-tier concerns, out of this mission's scope), and
 * `already_in_crm` still carries NOTHING beyond source/sourceId/name.
 * toDiscoveryRow() below is a hand-built literal, never a spread of
 * `item`, so this component can never accidentally surface a field the
 * backend didn't actually put there — the same discipline already
 * established by createDiscoveryResult()/findCrmClientMatch() (Phases A/B)
 * for exactly this reason. `already_in_crm` in particular carries nothing
 * beyond source/sourceId/name (never a CRM client id, name, email, phone,
 * address, or match reason) — enforced by the C-2A contract itself (a
 * structurally separate member of the discriminated union, untouched by
 * C-2C-1.5's widening), not just by this component's own discipline.
 *
 * NO CONVERSION IN THIS MISSION: there is deliberately no "Add to CRM"
 * affordance anywhere below — createClient()/convertDiscoveryResult() are
 * out of scope for C-2C-1 (a later mission).
 *
 * PAGINATION: `nextCursor` is opaque and only ever round-tripped verbatim
 * into the next call's `cursor` — never decoded, constructed, or guessed.
 * "Load more" APPENDS to the existing list (mergeDiscoveryResults) and
 * never re-fetches or discards the first page.
 */
import { useState, useTransition, type FormEvent } from "react";
import { searchRadarDiscovery, type RadarDiscoverySearchItem, type RadarDiscoverySearchResult } from "@/lib/actions/radar-discovery-search";

/** The one field set this mission uses — see this file's own header and
 * lib/radar-discovery/field-masks.ts: minimal_discovery already supplies
 * everything a first result list needs (and is the cheapest tier); this
 * mission does not request "enrichment"/"details" for any result. */
export const DISCOVERY_UI_FIELD_SET = "minimal_discovery" as const;

/** A conservative, interactive-UI-sized page — never the C-0 ceiling
 * (100). Never exposed as a user-configurable control (mission section 8:
 * "ne pas exposer inutilement le plafond interne au client"). */
export const DISCOVERY_UI_MAX_RESULTS = 20;

export type DiscoverySearchFormValues = {
  country: string;
  region: string;
  city: string;
  category: string;
};

const EMPTY_FORM_VALUES: DiscoverySearchFormValues = { country: "", region: "", city: "", category: "" };

/** Structural dict type (mirrors RadarAssignmentDict's own convention in
 * radar-assignment-controls.tsx) so either locale's `crm.discovery` slice
 * is accepted. */
export type DiscoverySearchDict = {
  title: string;
  subtitle: string;
  countryLabel: string;
  countryPlaceholder: string;
  regionLabel: string;
  regionPlaceholder: string;
  cityLabel: string;
  cityPlaceholder: string;
  categoryLabel: string;
  categoryPlaceholder: string;
  searchButton: string;
  searching: string;
  loadMore: string;
  loadingMore: string;
  readyTitle: string;
  readyDescription: string;
  noResultsTitle: string;
  noResultsDescription: string;
  validationEmptyCriteria: string;
  columns: { name: string; category: string; address: string; city: string; region: string; country: string; source: string; status: string };
  /** Displayed for any of the new optional fields when null (mirrors
   * crm.radar's own `noValue` convention) — never a blank cell. */
  noValue: string;
  statusCreated: string;
  statusAlreadyDiscovered: string;
  statusAlreadyInCrm: string;
  summaryCreated: (count: number) => string;
  summaryAlreadyDiscovered: (count: number) => string;
  summaryAlreadyInCrm: (count: number) => string;
  errInvalidRequest: string;
  errActorRateLimited: (retryAfterSeconds: number) => string;
  errProviderUnavailable: string;
  errProviderRateLimited: string;
  errProviderTimeout: string;
  errProviderError: string;
};

/** True when at least one of the four supported criteria has real (post
 * -trim) content — mirrors validateDiscoverySearchRequest()'s own "at
 * least one signal" rule as a client-side UX nicety only; the server
 * action re-validates independently and remains the sole authority. */
export function hasAnyDiscoveryCriteria(values: DiscoverySearchFormValues): boolean {
  return values.country.trim() !== "" || values.region.trim() !== "" || values.city.trim() !== "" || values.category.trim() !== "";
}

/**
 * Builds the conceptual input `searchRadarDiscovery()` expects. Never
 * includes latitude/longitude/radiusMeters (out of scope for this
 * mission — section 6), never a clientId/userId (the action resolves the
 * actor from the server session itself), and always the fixed
 * fieldSet/maxResults this mission commits to. A blank field is sent as
 * `undefined`, not `""` — matching validateDiscoverySearchRequest()'s own
 * "empty means absent" treatment, so the UI never has to guess whether an
 * empty string counts as a signal.
 */
export function buildDiscoverySearchInput(values: DiscoverySearchFormValues, cursor: string | null) {
  const country = values.country.trim();
  const region = values.region.trim();
  const city = values.city.trim();
  const category = values.category.trim();
  return {
    country: country === "" ? undefined : country,
    region: region === "" ? undefined : region,
    city: city === "" ? undefined : city,
    category: category === "" ? undefined : category,
    cursor: cursor ?? undefined,
    maxResults: DISCOVERY_UI_MAX_RESULTS,
    fieldSet: DISCOVERY_UI_FIELD_SET,
  };
}

/** "Load more" APPENDS — never replaces, dedups, sorts, or otherwise
 * reinterprets what the provider/dedup pipeline already decided. */
export function mergeDiscoveryResults(
  previous: readonly RadarDiscoverySearchItem[],
  next: readonly RadarDiscoverySearchItem[],
): RadarDiscoverySearchItem[] {
  return [...previous, ...next];
}

/** Stable React list key. `sourceId` is unique per `source` (the C-2A
 * contract's own provenance guarantee — db/schema.ts's
 * discovery_results_source_source_id_idx), so this is unique across the
 * whole accumulated list regardless of status or page. */
export function discoveryResultKey(item: RadarDiscoverySearchItem): string {
  return `${item.source}::${item.sourceId}`;
}

export type DiscoveryResultRow = {
  key: string;
  name: string;
  source: string;
  status: RadarDiscoverySearchItem["status"];
  category: string | null;
  address: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Hand-built literal, NEVER a spread of `item` — see this file's own
 * header. Even if a future backend change ever added an extra field to
 * `RadarDiscoverySearchItem`, this function would still only ever surface
 * these known, already-safe fields.
 *
 * MISSION C-2C-1.5 — `already_in_crm` is handled in its OWN branch,
 * explicitly nulling category/address/country/region/city/latitude/
 * longitude: that status never carries these fields on the real,
 * discriminated-union type, but this defensive branch means even a
 * mistyped/poisoned object could never leak a fabricated value through
 * here for that status (same discipline the existing poisoned-object test
 * already exercises).
 */
export function toDiscoveryRow(item: RadarDiscoverySearchItem): DiscoveryResultRow {
  if (item.status === "already_in_crm") {
    return {
      key: discoveryResultKey(item),
      name: item.name,
      source: item.source,
      status: item.status,
      category: null,
      address: null,
      country: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
    };
  }
  return {
    key: discoveryResultKey(item),
    name: item.name,
    source: item.source,
    status: item.status,
    category: item.category,
    address: item.address,
    country: item.country,
    region: item.region,
    city: item.city,
    latitude: item.latitude,
    longitude: item.longitude,
  };
}

export function discoveryStatusLabel(status: RadarDiscoverySearchItem["status"], t: DiscoverySearchDict): string {
  switch (status) {
    case "created":
      return t.statusCreated;
    case "already_discovered":
      return t.statusAlreadyDiscovered;
    case "already_in_crm":
      return t.statusAlreadyInCrm;
  }
}

/**
 * Maps every non-"ok" RadarDiscoverySearchResult status to a safe,
 * localized message — an exhaustive switch over the closed union (a
 * missing case is a compile error), so no status can silently fall
 * through to a raw/undefined value. Never touches `reason` on
 * invalid_request (already a safe, generic backend string, but this
 * mission's own client-side hasAnyDiscoveryCriteria() check means an
 * empty-criteria request is never even sent, so this path is expected to
 * be effectively unreachable in normal use) — a fixed, localized message
 * keeps FR/EN copy consistent instead of surfacing an English backend
 * string in a French UI.
 */
export function mapDiscoverySearchErrorMessage(result: Exclude<RadarDiscoverySearchResult, { status: "ok" }>, t: DiscoverySearchDict): string {
  switch (result.status) {
    case "invalid_request":
      return t.errInvalidRequest;
    case "actor_rate_limited":
      return t.errActorRateLimited(result.retryAfterSeconds);
    case "provider_unavailable":
      return t.errProviderUnavailable;
    case "provider_rate_limited":
      return t.errProviderRateLimited;
    case "provider_timeout":
      return t.errProviderTimeout;
    case "provider_error":
      return t.errProviderError;
  }
}

/** Pure UI-state decisions, extracted so they are unit-testable without a
 * DOM renderer (this repo has no act()-capable React harness — mirrors
 * canClaimRadarFollowUp()/canCompleteRadarFollowUp()'s own convention in
 * radar-follow-up-quick-actions.tsx). Each takes only the plain values it
 * needs, never React state/setters/refs. */

/** The initial "ready to search" panel shows until the FIRST search
 * attempt completes (success or error) — never re-appears afterward, even
 * if a later attempt errors (the error banner takes over instead). */
export function shouldShowReadyMessage(args: { hasSearched: boolean }): boolean {
  return !args.hasSearched;
}

/** The "no results" panel shows only after a completed, ERROR-FREE search
 * that returned zero items — never confused with "not searched yet"
 * (shouldShowReadyMessage) or with a genuine provider/validation error. */
export function shouldShowEmptyResultsMessage(args: { hasSearched: boolean; hasError: boolean; itemsCount: number }): boolean {
  return args.hasSearched && !args.hasError && args.itemsCount === 0;
}

/** Guards the Search button/submit handler: never while a search or
 * load-more is already in flight (no concurrent/duplicate submissions —
 * mission section 14), and never with an empty-criteria form (mirrors
 * hasAnyDiscoveryCriteria — the UI never even attempts the round trip the
 * backend would reject anyway). */
export function canSubmitDiscoverySearch(args: { isBusy: boolean; values: DiscoverySearchFormValues }): boolean {
  return !args.isBusy && hasAnyDiscoveryCriteria(args.values);
}

/** Guards "Load more": never while busy, never with no further page
 * (`nextCursor === null`), and never with no query to continue (a fresh
 * mount before any successful search). */
export function canLoadMore(args: { isBusy: boolean; nextCursor: string | null; activeQuery: DiscoverySearchFormValues | null }): boolean {
  return !args.isBusy && args.nextCursor !== null && args.activeQuery !== null;
}

const inputClass = "w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir";
const labelClass = "block text-xs font-medium text-pm-gris";

export function DiscoverySearchPanel({ t }: { t: DiscoverySearchDict }) {
  const [formValues, setFormValues] = useState<DiscoverySearchFormValues>(EMPTY_FORM_VALUES);
  const [formError, setFormError] = useState<string | null>(null);

  // The query actually in effect for the current result set — distinct
  // from `formValues`, which the user may keep editing after a search
  // completes. "Load more" must continue THIS query, never whatever the
  // form currently holds.
  const [activeQuery, setActiveQuery] = useState<DiscoverySearchFormValues | null>(null);

  const [items, setItems] = useState<RadarDiscoverySearchItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ created: number; alreadyDiscovered: number; alreadyInCrm: number } | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorResult, setErrorResult] = useState<Exclude<RadarDiscoverySearchResult, { status: "ok" }> | null>(null);

  const [isSearching, startSearchTransition] = useTransition();
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const isBusy = isSearching || isLoadingMore;

  function onFieldChange(field: keyof DiscoverySearchFormValues, value: string) {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isBusy) return; // no concurrent/duplicate submissions

    if (!canSubmitDiscoverySearch({ isBusy, values: formValues })) {
      setFormError(t.validationEmptyCriteria);
      return;
    }
    setFormError(null);
    setErrorResult(null);

    const query = { ...formValues };
    startSearchTransition(async () => {
      const result = await searchRadarDiscovery(buildDiscoverySearchInput(query, null));
      setHasSearched(true);
      if (result.status === "ok") {
        setActiveQuery(query);
        setItems(result.items);
        setNextCursor(result.nextCursor);
        setCounts({ created: result.createdCount, alreadyDiscovered: result.alreadyDiscoveredCount, alreadyInCrm: result.alreadyInCrmCount });
        setErrorResult(null);
      } else {
        setErrorResult(result);
      }
    });
  }

  function onLoadMore() {
    if (!canLoadMore({ isBusy, nextCursor, activeQuery })) return;
    // canLoadMore() already proved both are non-null; re-check narrows the
    // types for TypeScript without an assertion.
    if (activeQuery === null || nextCursor === null) return;
    const query = activeQuery;
    const cursor = nextCursor;
    setErrorResult(null);
    startLoadMoreTransition(async () => {
      const result = await searchRadarDiscovery(buildDiscoverySearchInput(query, cursor));
      if (result.status === "ok") {
        // Existing results are never discarded on "Load more" — appended
        // only (mission section 12/14).
        setItems((prev) => mergeDiscoveryResults(prev, result.items));
        setNextCursor(result.nextCursor);
        setCounts({ created: result.createdCount, alreadyDiscovered: result.alreadyDiscoveredCount, alreadyInCrm: result.alreadyInCrmCount });
        setErrorResult(null);
      } else {
        // The existing list is deliberately left untouched on error.
        setErrorResult(result);
      }
    });
  }

  const errorMessage = errorResult ? mapDiscoverySearchErrorMessage(errorResult, t) : null;
  const showReady = shouldShowReadyMessage({ hasSearched });
  const showEmptyResults = shouldShowEmptyResultsMessage({ hasSearched, hasError: errorResult !== null, itemsCount: items.length });
  const canClickLoadMore = canLoadMore({ isBusy, nextCursor, activeQuery });

  return (
    <div className="mt-6">
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="discovery-country" className={labelClass}>
            {t.countryLabel}
          </label>
          <input
            id="discovery-country"
            type="text"
            value={formValues.country}
            onChange={(e) => onFieldChange("country", e.target.value)}
            placeholder={t.countryPlaceholder}
            disabled={isBusy}
            aria-invalid={formError !== null}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="discovery-region" className={labelClass}>
            {t.regionLabel}
          </label>
          <input
            id="discovery-region"
            type="text"
            value={formValues.region}
            onChange={(e) => onFieldChange("region", e.target.value)}
            placeholder={t.regionPlaceholder}
            disabled={isBusy}
            aria-invalid={formError !== null}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="discovery-city" className={labelClass}>
            {t.cityLabel}
          </label>
          <input
            id="discovery-city"
            type="text"
            value={formValues.city}
            onChange={(e) => onFieldChange("city", e.target.value)}
            placeholder={t.cityPlaceholder}
            disabled={isBusy}
            aria-invalid={formError !== null}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="discovery-category" className={labelClass}>
            {t.categoryLabel}
          </label>
          <input
            id="discovery-category"
            type="text"
            value={formValues.category}
            onChange={(e) => onFieldChange("category", e.target.value)}
            placeholder={t.categoryPlaceholder}
            disabled={isBusy}
            aria-invalid={formError !== null}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
          >
            {isSearching ? t.searching : t.searchButton}
          </button>
          {formError && (
            <p role="alert" aria-live="polite" className="mt-2 text-xs text-pm-rouge">
              {formError}
            </p>
          )}
        </div>
      </form>

      {errorMessage && (
        <p role="alert" aria-live="polite" className="mt-4 rounded-lg border border-pm-rouge/30 bg-pm-rouge/5 px-4 py-3 text-sm text-pm-rouge-2">
          {errorMessage}
        </p>
      )}

      {showReady && (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.readyTitle}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.readyDescription}</p>
        </div>
      )}

      {showEmptyResults && (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.noResultsTitle}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.noResultsDescription}</p>
        </div>
      )}

      {items.length > 0 && (
        <>
          {counts && (
            <p className="mt-4 text-xs text-pm-gris">
              {t.summaryCreated(counts.created)} · {t.summaryAlreadyDiscovered(counts.alreadyDiscovered)} · {t.summaryAlreadyInCrm(counts.alreadyInCrm)}
            </p>
          )}
          <div className="mt-3 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">{t.columns.name}</th>
                  <th className="px-5 py-3">{t.columns.category}</th>
                  <th className="px-5 py-3">{t.columns.address}</th>
                  <th className="px-5 py-3">{t.columns.city}</th>
                  <th className="px-5 py-3">{t.columns.region}</th>
                  <th className="px-5 py-3">{t.columns.country}</th>
                  <th className="px-5 py-3">{t.columns.source}</th>
                  <th className="px-5 py-3">{t.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const row = toDiscoveryRow(item);
                  return (
                    <tr key={row.key} className="border-t border-pm-gris-2">
                      <td className="px-5 py-3 font-medium text-pm-noir">{row.name}</td>
                      <td className="px-5 py-3 text-pm-gris">{row.category ?? t.noValue}</td>
                      <td className="px-5 py-3 text-pm-gris">{row.address ?? t.noValue}</td>
                      <td className="px-5 py-3 text-pm-gris">{row.city ?? t.noValue}</td>
                      <td className="px-5 py-3 text-pm-gris">{row.region ?? t.noValue}</td>
                      <td className="px-5 py-3 text-pm-gris">{row.country ?? t.noValue}</td>
                      <td className="px-5 py-3 text-pm-gris">{row.source}</td>
                      <td className="px-5 py-3 text-pm-gris">{discoveryStatusLabel(row.status, t)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {nextCursor !== null && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={!canClickLoadMore}
                className="rounded-lg border border-pm-gris-2 px-4 py-2 text-sm text-pm-noir transition hover:bg-pm-gris-2/30 disabled:opacity-50"
              >
                {isLoadingMore ? t.loadingMore : t.loadMore}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
