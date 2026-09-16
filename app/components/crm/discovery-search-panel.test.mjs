// MISSION C-2C-1 — RADAR DISCOVERY UI — tests for the entire interactive
// surface of /admin/crm/discovery.
//
// This repo has no act()-capable React harness (see radar-assignment-
// controls.tsx / radar-follow-up-quick-actions.tsx's own test files for
// the established precedent), so:
//  - every real DECISION is exercised as a pure, exported function
//    (buildDiscoverySearchInput, mergeDiscoveryResults, toDiscoveryRow,
//    discoveryStatusLabel, mapDiscoverySearchErrorMessage,
//    shouldShowReadyMessage, shouldShowEmptyResultsMessage,
//    canSubmitDiscoverySearch, canLoadMore) — covers test categories
//    A/C/D/E/F/G/H/I/J/K-O/P/R/S from the mission's own test plan;
//  - the component's IDLE markup (initial mount, before any interaction)
//    is asserted via renderToStaticMarkup — covers A/B;
//  - RBAC (category Q) is a page-level concern, tested in
//    app/admin/crm/discovery/page.test.mjs, not here — this panel holds
//    no role/session/permission of its own to test.
//  - clicking Search/Load more and re-rendering after an async state
//    update is NOT exercised here (no act()); the guard conditions those
//    handlers call (canSubmitDiscoverySearch / canLoadMore) ARE, directly.
//
// @/lib/actions/radar-discovery-search is mocked so this file never
// imports the real "use server" action (which transitively pulls in
// @/lib/rbac/require-staff-member -> @/db, needing a live DATABASE_URL —
// same fix already applied to google-places-provider.test.mjs in C-1).
//
// Run: npx tsx --test --experimental-test-module-mocks components/crm/discovery-search-panel.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/actions/radar-discovery-search", {
  namedExports: {
    // Never invoked by any test below (idle render only calls nothing;
    // every interactive path is tested via the pure functions instead) —
    // present only so the module import resolves.
    searchRadarDiscovery: async () => {
      throw new Error("searchRadarDiscovery must not be called in this test file");
    },
  },
});

const {
  DiscoverySearchPanel,
  DISCOVERY_UI_FIELD_SET,
  DISCOVERY_UI_MAX_RESULTS,
  hasAnyDiscoveryCriteria,
  buildDiscoverySearchInput,
  mergeDiscoveryResults,
  discoveryResultKey,
  toDiscoveryRow,
  discoveryStatusLabel,
  mapDiscoverySearchErrorMessage,
  shouldShowReadyMessage,
  shouldShowEmptyResultsMessage,
  canSubmitDiscoverySearch,
  canLoadMore,
} = await import("./discovery-search-panel.tsx");

const T = {
  title: "Discovery",
  subtitle: "subtitle",
  countryLabel: "Pays",
  countryPlaceholder: "ex. France",
  regionLabel: "Région",
  regionPlaceholder: "ex. Bretagne",
  cityLabel: "Ville",
  cityPlaceholder: "ex. Rennes",
  categoryLabel: "Catégorie",
  categoryPlaceholder: "ex. agences",
  searchButton: "Rechercher",
  searching: "Recherche en cours…",
  loadMore: "Charger plus",
  loadingMore: "Chargement…",
  readyTitle: "Prêt à rechercher",
  readyDescription: "Renseignez au moins un critère.",
  noResultsTitle: "Aucun résultat trouvé pour ces critères.",
  noResultsDescription: "Essayez d'autres critères.",
  validationEmptyCriteria: "Renseignez au moins un critère.",
  columns: { name: "Nom", category: "Catégorie", address: "Adresse", city: "Ville", region: "Région", country: "Pays", source: "Source", status: "Statut" },
  noValue: "—",
  statusCreated: "Nouveau",
  statusAlreadyDiscovered: "Déjà découvert",
  statusAlreadyInCrm: "Déjà dans le CRM",
  summaryCreated: (n) => `${n} nouveau(x)`,
  summaryAlreadyDiscovered: (n) => `${n} déjà découvert(s)`,
  summaryAlreadyInCrm: (n) => `${n} déjà dans le CRM`,
  errInvalidRequest: "Requête invalide.",
  errActorRateLimited: (s) => `Limite atteinte. Réessayez dans ${s}s.`,
  errProviderUnavailable: "Fournisseur indisponible.",
  errProviderRateLimited: "Trop de recherches.",
  errProviderTimeout: "Délai dépassé.",
  errProviderError: "Erreur du fournisseur.",
};

const EMPTY = { country: "", region: "", city: "", category: "" };

// ------------------------- A/B. idle render -------------------------

test("A/B. idle render: title/subtitle come from the caller, the four labeled inputs are present, ready message shown, no results table", () => {
  const markup = renderToStaticMarkup(React.createElement(DiscoverySearchPanel, { t: T }));
  assert.match(markup, /Pays/);
  assert.match(markup, /Région/);
  assert.match(markup, /Ville/);
  assert.match(markup, /Catégorie/);
  assert.match(markup, /Rechercher/);
  assert.match(markup, /Prêt à rechercher/);
  assert.doesNotMatch(markup, /<table/);
  assert.doesNotMatch(markup, /Aucun résultat trouvé/);
});

test("A. idle render: Search button is a real, non-disabled <button>; no premature error/empty banners", () => {
  const markup = renderToStaticMarkup(React.createElement(DiscoverySearchPanel, { t: T }));
  assert.match(markup, /<button type="submit"/);
  assert.doesNotMatch(markup, /disabled=""/);
});

// ------------------------- D. empty-form validation -------------------------

test("D. hasAnyDiscoveryCriteria: all blank (including whitespace-only) -> false", () => {
  assert.equal(hasAnyDiscoveryCriteria(EMPTY), false);
  assert.equal(hasAnyDiscoveryCriteria({ country: "   ", region: "\t", city: "", category: "" }), false);
});

test("D. hasAnyDiscoveryCriteria: any single non-blank field -> true", () => {
  assert.equal(hasAnyDiscoveryCriteria({ ...EMPTY, country: "France" }), true);
  assert.equal(hasAnyDiscoveryCriteria({ ...EMPTY, region: "Bretagne" }), true);
  assert.equal(hasAnyDiscoveryCriteria({ ...EMPTY, city: "Rennes" }), true);
  assert.equal(hasAnyDiscoveryCriteria({ ...EMPTY, category: "agences" }), true);
});

test("R/D. canSubmitDiscoverySearch: false while busy even with valid criteria; false with empty criteria even when idle", () => {
  assert.equal(canSubmitDiscoverySearch({ isBusy: true, values: { ...EMPTY, country: "France" } }), false);
  assert.equal(canSubmitDiscoverySearch({ isBusy: false, values: EMPTY }), false);
  assert.equal(canSubmitDiscoverySearch({ isBusy: false, values: { ...EMPTY, country: "France" } }), true);
});

// ------------------------- C/S. building the request -------------------------

test("C. buildDiscoverySearchInput: trims fields, omits blanks as undefined, fixes fieldSet/maxResults, forwards cursor null as undefined", () => {
  const input = buildDiscoverySearchInput({ country: " France ", region: "", city: "Paris", category: "  " }, null);
  assert.deepEqual(input, {
    country: "France",
    region: undefined,
    city: "Paris",
    category: undefined,
    cursor: undefined,
    maxResults: DISCOVERY_UI_MAX_RESULTS,
    fieldSet: DISCOVERY_UI_FIELD_SET,
  });
});

test("H. buildDiscoverySearchInput: a real cursor is forwarded verbatim, never decoded/altered", () => {
  const opaque = "eyJvcGFxdWUiOnRydWV9==weird+chars/here";
  const input = buildDiscoverySearchInput({ ...EMPTY, city: "Paris" }, opaque);
  assert.equal(input.cursor, opaque, "the cursor must be byte-for-byte identical to what the backend issued");
});

test("S. buildDiscoverySearchInput: never exceeds 20 maxResults, never requests a non-minimal_discovery fieldSet, has exactly the 7 documented keys — no 'mode'/'world'/lat/long/radius/clientId/userId", () => {
  const input = buildDiscoverySearchInput({ ...EMPTY, country: "France" }, null);
  assert.equal(input.maxResults, 20);
  assert.equal(input.fieldSet, "minimal_discovery");
  assert.deepEqual(Object.keys(input).sort(), ["category", "city", "country", "cursor", "fieldSet", "maxResults", "region"].sort());
});

test("S. buildDiscoverySearchInput: an all-blank form can still be handed to the builder (defense in depth) and it STILL never produces a 'world' search — no signal is ever synthesized", () => {
  const input = buildDiscoverySearchInput(EMPTY, null);
  assert.equal(input.country, undefined);
  assert.equal(input.region, undefined);
  assert.equal(input.city, undefined);
  assert.equal(input.category, undefined);
  // The real guard against this is canSubmitDiscoverySearch()/
  // hasAnyDiscoveryCriteria() never calling searchRadarDiscovery() at all
  // in this case (proven above) — validateDiscoverySearchRequest() on the
  // backend would also reject it independently either way.
});

test("6. buildDiscoverySearchInput: a poisoned form object carrying an extra clientId/userId field never leaks it through", () => {
  const poisoned = { ...EMPTY, country: "France", clientId: "11111111-1111-4111-8111-111111111111", userId: "someone-else" };
  const input = buildDiscoverySearchInput(poisoned, null);
  assert.equal("clientId" in input, false);
  assert.equal("userId" in input, false);
});

// ------------------------- I. load more / merge -------------------------

test("I. mergeDiscoveryResults: appends in order, never dedups/reorders/discards", () => {
  const a = { status: "created", source: "google_places", sourceId: "1", name: "A", discoveryResultId: "d1" };
  const b = { status: "already_discovered", source: "google_places", sourceId: "2", name: "B", discoveryResultId: "d2" };
  const c = { status: "already_in_crm", source: "google_places", sourceId: "3", name: "C" };
  assert.deepEqual(mergeDiscoveryResults([a], [b, c]), [a, b, c]);
  assert.deepEqual(mergeDiscoveryResults([], [a]), [a]);
  assert.deepEqual(mergeDiscoveryResults([a], []), [a]);
});

test("canLoadMore: false when busy, when no further page, or when there is no active query yet", () => {
  assert.equal(canLoadMore({ isBusy: true, nextCursor: "c", activeQuery: EMPTY }), false);
  assert.equal(canLoadMore({ isBusy: false, nextCursor: null, activeQuery: EMPTY }), false);
  assert.equal(canLoadMore({ isBusy: false, nextCursor: "c", activeQuery: null }), false);
  assert.equal(canLoadMore({ isBusy: false, nextCursor: "c", activeQuery: EMPTY }), true);
});

// ------------------------- E/F/G/P. result rows + no CRM leak -------------------------

test("E. created item -> row carries name/source/status/category/address/country/region/city/lat/long + a stable key; status label is 'Nouveau'", () => {
  const item = {
    status: "created", source: "google_places", sourceId: "abc", name: "Le Petit Café", discoveryResultId: "d-1",
    category: "restaurant", address: "1 Main St", country: "France", region: "Île-de-France", city: "Paris", latitude: 48.85, longitude: 2.35,
  };
  const row = toDiscoveryRow(item);
  assert.deepEqual(row, {
    key: "google_places::abc", name: "Le Petit Café", source: "google_places", status: "created",
    category: "restaurant", address: "1 Main St", country: "France", region: "Île-de-France", city: "Paris", latitude: 48.85, longitude: 2.35,
  });
  assert.equal(discoveryStatusLabel(row.status, T), "Nouveau");
});

test("C-2C-1.5: a 'created' item with null category/address/country/region/city/lat/long comes through as null on the row, never fabricated", () => {
  const item = {
    status: "created", source: "google_places", sourceId: "abc", name: "X", discoveryResultId: "d-1",
    category: null, address: null, country: null, region: null, city: null, latitude: null, longitude: null,
  };
  const row = toDiscoveryRow(item);
  assert.equal(row.category, null);
  assert.equal(row.address, null);
  assert.equal(row.country, null);
  assert.equal(row.region, null);
  assert.equal(row.city, null);
  assert.equal(row.latitude, null);
  assert.equal(row.longitude, null);
});

test("F. already_discovered item -> status label 'Déjà découvert', same widened fields as created", () => {
  const item = {
    status: "already_discovered", source: "google_places", sourceId: "abc", name: "X", discoveryResultId: "d-1",
    category: "restaurant", address: "1 Main St", country: "France", region: "Île-de-France", city: "Paris", latitude: 48.85, longitude: 2.35,
  };
  const row = toDiscoveryRow(item);
  assert.equal(discoveryStatusLabel(row.status, T), "Déjà découvert");
  assert.equal(row.category, "restaurant");
  assert.equal(row.address, "1 Main St");
  assert.equal(row.country, "France");
  assert.equal(row.region, "Île-de-France");
  assert.equal(row.city, "Paris");
  assert.equal(row.latitude, 48.85);
  assert.equal(row.longitude, 2.35);
});

test("G/P. already_in_crm item -> row EXPLICITLY nulls category/address/country/region/city/lat/long, status label 'Déjà dans le CRM', and NOTHING else leaks even when the backend object is poisoned with extra CRM fields AND a full address/coordinates set", () => {
  const poisoned = {
    status: "already_in_crm",
    source: "google_places",
    sourceId: "abc",
    name: "X",
    // None of these exist on the real, frozen C-2A contract — simulated
    // here only to prove toDiscoveryRow() cannot surface them even if a
    // future bug ever put them on the object.
    crmClientId: "11111111-1111-4111-8111-111111111111",
    assignedUserId: "22222222-2222-4222-8222-222222222222",
    email: "hidden@example.com",
    phone: "+15145550000",
    address: "123 secret street",
    // MISSION C-2C-1.5 NON-REGRESSION — even a fully-populated address/
    // geo set on the raw object (as if some future bug tried to widen
    // this branch too) must never survive toDiscoveryRow()'s dedicated
    // already_in_crm handling.
    category: "restaurant",
    country: "France",
    region: "Île-de-France",
    city: "Paris",
    latitude: 48.85,
    longitude: 2.35,
    candidateClientIds: ["a", "b"],
    matchReason: "email match",
  };
  const row = toDiscoveryRow(poisoned);
  assert.deepEqual(Object.keys(row).sort(), ["address", "category", "city", "country", "key", "latitude", "longitude", "name", "region", "source", "status"]);
  assert.deepEqual(row, {
    key: "google_places::abc", name: "X", source: "google_places", status: "already_in_crm",
    category: null, address: null, country: null, region: null, city: null, latitude: null, longitude: null,
  });
  assert.equal(discoveryStatusLabel(row.status, T), "Déjà dans le CRM");
  assert.equal(JSON.stringify(row).includes("crmClientId"), false);
  assert.equal(JSON.stringify(row).includes("assignedUserId"), false);
  assert.equal(JSON.stringify(row).includes("hidden@example.com"), false);
  assert.equal(JSON.stringify(row).includes("123 secret street"), false);
  assert.equal(JSON.stringify(row).includes("candidateClientIds"), false);
  assert.equal(JSON.stringify(row).includes("restaurant"), false);
  assert.equal(JSON.stringify(row).includes("Île-de-France"), false);
  assert.equal(JSON.stringify(row).includes("48.85"), false);
});

test("P. discoveryResultKey never embeds any CRM-internal identifier — only source::sourceId", () => {
  const item = { status: "already_in_crm", source: "google_places", sourceId: "abc" , name: "X" };
  assert.equal(discoveryResultKey(item), "google_places::abc");
});

// ------------------------- J. empty state / ready state -------------------------

test("J. shouldShowEmptyResultsMessage: true only after a completed, error-free search with zero items", () => {
  assert.equal(shouldShowEmptyResultsMessage({ hasSearched: false, hasError: false, itemsCount: 0 }), false, "not searched yet -> ready state, not empty state");
  assert.equal(shouldShowEmptyResultsMessage({ hasSearched: true, hasError: true, itemsCount: 0 }), false, "an error is never mislabeled as an empty result");
  assert.equal(shouldShowEmptyResultsMessage({ hasSearched: true, hasError: false, itemsCount: 3 }), false);
  assert.equal(shouldShowEmptyResultsMessage({ hasSearched: true, hasError: false, itemsCount: 0 }), true);
});

test("A/J. shouldShowReadyMessage: true only before the first completed search", () => {
  assert.equal(shouldShowReadyMessage({ hasSearched: false }), true);
  assert.equal(shouldShowReadyMessage({ hasSearched: true }), false);
});

// ------------------------- K-O. error states -------------------------

test("K. actor_rate_limited -> user-friendly message including retryAfterSeconds", () => {
  assert.equal(mapDiscoverySearchErrorMessage({ status: "actor_rate_limited", retryAfterSeconds: 42 }, T), "Limite atteinte. Réessayez dans 42s.");
});

test("L. provider_unavailable -> generic message", () => {
  assert.equal(mapDiscoverySearchErrorMessage({ status: "provider_unavailable" }, T), "Fournisseur indisponible.");
});

test("M. provider_rate_limited -> generic message", () => {
  assert.equal(mapDiscoverySearchErrorMessage({ status: "provider_rate_limited" }, T), "Trop de recherches.");
});

test("N. provider_timeout -> generic message", () => {
  assert.equal(mapDiscoverySearchErrorMessage({ status: "provider_timeout" }, T), "Délai dépassé.");
});

test("O. provider_error -> generic message", () => {
  assert.equal(mapDiscoverySearchErrorMessage({ status: "provider_error" }, T), "Erreur du fournisseur.");
});

test("bonus: invalid_request -> generic, LOCALIZED message, never the raw backend `reason` string", () => {
  assert.equal(mapDiscoverySearchErrorMessage({ status: "invalid_request", reason: "at least one of country, region, city, category, or coordinates is required" }, T), "Requête invalide.");
});

test("P. no error-message branch ever includes a raw stack trace, SQL, or provider-internal detail — every branch returns a fixed dictionary string", () => {
  const cases = [
    { status: "invalid_request", reason: "x" },
    { status: "actor_rate_limited", retryAfterSeconds: 1 },
    { status: "provider_unavailable" },
    { status: "provider_rate_limited" },
    { status: "provider_timeout" },
    { status: "provider_error" },
  ];
  for (const c of cases) {
    const message = mapDiscoverySearchErrorMessage(c, T);
    assert.equal(typeof message, "string");
    assert.doesNotMatch(message, /at |Error:|SELECT |INSERT |sk-|AIza/i);
  }
});
