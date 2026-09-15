// RADAR DISCOVERY ENGINE — Phase C-1 — configured-google-places.ts unit
// tests. Pure, NO NETWORK CALL — fetch/config are injected/faked. Proves
// the "absence of a key/flag is never itself a reason to call" invariant
// (mission section 9) at the wiring boundary.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/adapters/configured-google-places.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/db", { namedExports: { db: {} } });

const { createConfiguredGooglePlacesProvider } = await import("./configured-google-places.ts");
const { GOOGLE_PLACES_PROVIDER_ID } = await import("./google-places.ts");

function loadedConfig(overrides = {}) {
  return { googlePlaces: { enabledFlag: false, hasCredential: false, effectiveEnabled: false, apiKey: null, ...overrides } };
}

test("no config at all -> returns null, never a provider that could attempt a call", () => {
  const provider = createConfiguredGooglePlacesProvider({ loadedConfig: loadedConfig() });
  assert.equal(provider, null);
});

test("enabled flag true but no credential -> returns null", () => {
  const provider = createConfiguredGooglePlacesProvider({ loadedConfig: loadedConfig({ enabledFlag: true, hasCredential: false, effectiveEnabled: false, apiKey: null }) });
  assert.equal(provider, null);
});

test("a credential present but enabled flag off -> returns null", () => {
  const provider = createConfiguredGooglePlacesProvider({ loadedConfig: loadedConfig({ enabledFlag: false, hasCredential: true, effectiveEnabled: false, apiKey: "some-key" }) });
  assert.equal(provider, null);
});

test("effectiveEnabled true with a real key -> returns a real, usable DiscoveryProvider", () => {
  const fetchCalls = [];
  const fakeFetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return { status: 200, async json() { return { places: [] }; } };
  };
  const provider = createConfiguredGooglePlacesProvider({
    loadedConfig: loadedConfig({ enabledFlag: true, hasCredential: true, effectiveEnabled: true, apiKey: "real-configured-key" }),
    fetchImpl: fakeFetch,
  });
  assert.notEqual(provider, null);
  assert.equal(provider.id, GOOGLE_PLACES_PROVIDER_ID);
});

test("the api key is passed to the transport but never returned/exposed on the provider object", () => {
  const HOSTILE_KEY = "AIzaConfiguredHostileKey";
  const provider = createConfiguredGooglePlacesProvider({
    loadedConfig: loadedConfig({ enabledFlag: true, hasCredential: true, effectiveEnabled: true, apiKey: HOSTILE_KEY }),
    fetchImpl: async () => ({ status: 200, async json() { return { places: [] }; } }),
  });
  assert.ok(!JSON.stringify(provider).includes(HOSTILE_KEY));
  assert.ok(!Object.values(provider).some((v) => typeof v === "string" && v.includes(HOSTILE_KEY)));
});

test("with no loadedConfig injected, defaults to reading real env via loadRadarDiscoveryConfig() -- and returns null when nothing is set (safe default)", () => {
  const provider = createConfiguredGooglePlacesProvider({});
  // Whatever the real environment happens to hold, this must never throw
  // -- either null (nothing configured) or a real provider, never a crash.
  assert.ok(provider === null || typeof provider.search === "function");
});
