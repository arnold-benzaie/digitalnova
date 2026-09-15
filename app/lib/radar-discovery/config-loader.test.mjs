// RADAR DISCOVERY ENGINE — Phase C-1 — config-loader.ts unit tests. Pure,
// no mocks, no network — env is injected directly, never process.env.
//
// Run: npx tsx --test lib/radar-discovery/config-loader.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { loadRadarDiscoveryConfig, GOOGLE_PLACES_API_KEY_ENV_VAR, GOOGLE_PLACES_ENABLED_ENV_VAR } = await import("./config-loader.ts");

test("unset env -> disabled, no credential, no external call possible", () => {
  const config = loadRadarDiscoveryConfig({});
  assert.equal(config.googlePlaces.enabledFlag, false);
  assert.equal(config.googlePlaces.hasCredential, false);
  assert.equal(config.googlePlaces.effectiveEnabled, false);
  assert.equal(config.googlePlaces.apiKey, null);
});

test("enabled=true but NO key -> effectiveEnabled is still false -- an enabled flag alone is never a reason to call", () => {
  const config = loadRadarDiscoveryConfig({ [GOOGLE_PLACES_ENABLED_ENV_VAR]: "true" });
  assert.equal(config.googlePlaces.enabledFlag, true);
  assert.equal(config.googlePlaces.hasCredential, false);
  assert.equal(config.googlePlaces.effectiveEnabled, false);
  assert.equal(config.googlePlaces.apiKey, null);
});

test("a real key present but enabled flag OFF -> effectiveEnabled is still false -- a key alone is never a reason to call", () => {
  // apiKey itself is surfaced whenever hasCredential is true (matching
  // radar-intelligence's own config-loader.ts precedent exactly) -- the
  // actual "never call without effectiveEnabled" guarantee is enforced
  // downstream, once, in configured-google-places.ts's own gate
  // (`if (!effectiveEnabled || apiKey === null) return null`), never by
  // this loader withholding the value.
  const config = loadRadarDiscoveryConfig({ [GOOGLE_PLACES_API_KEY_ENV_VAR]: "hostile-test-key-do-not-leak" });
  assert.equal(config.googlePlaces.hasCredential, true);
  assert.equal(config.googlePlaces.effectiveEnabled, false);
});

test("enabled='1' (numeric truthy string) is accepted, same as 'true'", () => {
  const config = loadRadarDiscoveryConfig({ [GOOGLE_PLACES_ENABLED_ENV_VAR]: "1", [GOOGLE_PLACES_API_KEY_ENV_VAR]: "k" });
  assert.equal(config.googlePlaces.enabledFlag, true);
  assert.equal(config.googlePlaces.effectiveEnabled, true);
});

test("enabled with an unrecognized value (e.g. 'yes') is NOT accepted -- fail closed on an unexpected value", () => {
  const config = loadRadarDiscoveryConfig({ [GOOGLE_PLACES_ENABLED_ENV_VAR]: "yes", [GOOGLE_PLACES_API_KEY_ENV_VAR]: "k" });
  assert.equal(config.googlePlaces.enabledFlag, false);
  assert.equal(config.googlePlaces.effectiveEnabled, false);
});

test("both flag=true and a real key present -> effectiveEnabled true, apiKey surfaced", () => {
  const config = loadRadarDiscoveryConfig({ [GOOGLE_PLACES_ENABLED_ENV_VAR]: "true", [GOOGLE_PLACES_API_KEY_ENV_VAR]: "real-key-value" });
  assert.equal(config.googlePlaces.effectiveEnabled, true);
  assert.equal(config.googlePlaces.apiKey, "real-key-value");
});

test("whitespace-only key is treated as no credential", () => {
  const config = loadRadarDiscoveryConfig({ [GOOGLE_PLACES_ENABLED_ENV_VAR]: "true", [GOOGLE_PLACES_API_KEY_ENV_VAR]: "   " });
  assert.equal(config.googlePlaces.hasCredential, false);
  assert.equal(config.googlePlaces.effectiveEnabled, false);
});

test("a key with surrounding whitespace is trimmed", () => {
  const config = loadRadarDiscoveryConfig({ [GOOGLE_PLACES_ENABLED_ENV_VAR]: "true", [GOOGLE_PLACES_API_KEY_ENV_VAR]: "  key-value  " });
  assert.equal(config.googlePlaces.apiKey, "key-value");
});

test("defaults to real process.env when no env object is injected -- does not throw", () => {
  assert.doesNotThrow(() => loadRadarDiscoveryConfig());
});
