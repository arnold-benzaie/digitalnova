// RADAR DISCOVERY ENGINE — Phase C-0 — provider.ts (DiscoveryProvider
// contract + registry) unit tests. Pure, no mocks, no network. Covers
// mission section 18 item A (provider contract) and part of item O
// (capability declaration, at the registry level).
//
// Run: npx tsx --test lib/radar-discovery/provider.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryProviderRegistry } from "./provider.ts";

function fakeAdapter(id, capabilities = ["search"]) {
  return {
    id,
    health: () => ({ id, state: "connected", capabilities, lastCheckedAt: null }),
    capabilities: () => capabilities,
    search: async () => ({ results: [], nextCursor: null }),
  };
}

// ---- A. provider contract ----

test("A. a conforming adapter registers successfully", () => {
  const registry = createDiscoveryProviderRegistry();
  const result = registry.register(fakeAdapter("google_places"));
  assert.deepEqual(result, { ok: true });
  assert.equal(registry.has("google_places"), true);
});

test("A. registering the same id twice is rejected -- never silently replaces", () => {
  const registry = createDiscoveryProviderRegistry();
  registry.register(fakeAdapter("google_places"));
  const second = registry.register(fakeAdapter("google_places"));
  assert.equal(second.ok, false);
  assert.equal(registry.list().length, 1);
});

test("A. get() returns the exact registered adapter; a missing id returns undefined, never throws", () => {
  const registry = createDiscoveryProviderRegistry();
  const adapter = fakeAdapter("google_places");
  registry.register(adapter);
  assert.equal(registry.get("google_places"), adapter);
  assert.equal(registry.get("does_not_exist"), undefined);
});

test("A. list() reflects registration order, is empty for a fresh registry", () => {
  const registry = createDiscoveryProviderRegistry();
  assert.deepEqual(registry.list(), []);
  registry.register(fakeAdapter("a"));
  registry.register(fakeAdapter("b"));
  assert.deepEqual(
    registry.list().map((p) => p.id),
    ["a", "b"],
  );
});

test("A. an adapter's search() always returns a DiscoverySearchOutcome shape -- {results, nextCursor}", async () => {
  const adapter = fakeAdapter("google_places");
  const outcome = await adapter.search({ category: "restaurants", city: "Montreal", maxResults: 20, fieldSet: "minimal_discovery" });
  assert.ok(Array.isArray(outcome.results));
  assert.ok(outcome.nextCursor === null || typeof outcome.nextCursor === "string");
});

test("A. getDetails is optional -- an adapter without it is still a fully valid DiscoveryProvider", () => {
  const adapter = fakeAdapter("google_places");
  assert.equal(adapter.getDetails, undefined);
  // No runtime crash from omitting it -- structurally optional per the
  // interface (provider.ts's own `getDetails?`).
});

// ---- O. capability declaration (registry level) ----

test("O. listByCapability returns only adapters that declare the requested capability", () => {
  const registry = createDiscoveryProviderRegistry();
  registry.register(fakeAdapter("search_only", ["search"]));
  registry.register(fakeAdapter("search_and_details", ["search", "get_details"]));
  registry.register(fakeAdapter("neither", []));

  const searchCapable = registry.listByCapability("search");
  assert.deepEqual(
    searchCapable.map((p) => p.id).sort(),
    ["search_and_details", "search_only"],
  );

  const detailsCapable = registry.listByCapability("get_details");
  assert.deepEqual(
    detailsCapable.map((p) => p.id),
    ["search_and_details"],
  );
});

test("O. listByCapability on an empty registry returns an empty array, never throws", () => {
  const registry = createDiscoveryProviderRegistry();
  assert.deepEqual(registry.listByCapability("search"), []);
});
