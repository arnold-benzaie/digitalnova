// RADAR INTELLIGENCE V1 — Slice 3 — server config loader tests.
//
// The loader is the ONLY place process.env is read. Tests inject a plain
// env object — no real environment variable is set. Proves fail-closed
// behaviour: enabled only on an exact value; missing key -> effectively
// disabled; unset env -> deterministic; never throws.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/config-loader.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { loadRadarIntelligenceConfig, ANTHROPIC_API_KEY_ENV_VAR, ANTHROPIC_ENABLED_ENV_VAR, ANTHROPIC_MODEL_ENV_VAR } = await import("./config-loader.ts");
const { DEFAULT_ANTHROPIC_CONFIG } = await import("./adapters/config.ts");

const KEY = "sk-ant-fake-not-real";

test("env var names are the documented ones", () => {
  assert.equal(ANTHROPIC_ENABLED_ENV_VAR, "RADAR_INTELLIGENCE_ANTHROPIC_ENABLED");
  assert.equal(ANTHROPIC_API_KEY_ENV_VAR, "RADAR_INTELLIGENCE_ANTHROPIC_API_KEY");
  assert.equal(ANTHROPIC_MODEL_ENV_VAR, "RADAR_INTELLIGENCE_ANTHROPIC_MODEL");
});

test("empty env -> anthropic fully disabled, no credential, deterministic default model", () => {
  const c = loadRadarIntelligenceConfig({}).anthropic;
  assert.equal(c.enabledFlag, false);
  assert.equal(c.hasCredential, false);
  assert.equal(c.effectiveEnabled, false);
  assert.equal(c.apiKey, null);
  assert.equal(c.model, DEFAULT_ANTHROPIC_CONFIG.model);
});

test("enabled only on the exact strings 'true' / '1'", () => {
  const mk = (v) => loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: v, RADAR_INTELLIGENCE_ANTHROPIC_API_KEY: KEY }).anthropic;
  assert.equal(mk("true").effectiveEnabled, true);
  assert.equal(mk("1").effectiveEnabled, true);
  assert.equal(mk(" true ").effectiveEnabled, true); // trimmed
  for (const v of ["TRUE", "True", "yes", "on", "0", "false", "", "enable", "y"]) {
    assert.equal(mk(v).effectiveEnabled, false, `"${v}" must not enable`);
    assert.equal(mk(v).enabledFlag, false);
  }
});

test("enabled flag true but NO api key -> effectiveEnabled false, never throws", () => {
  const c = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: "true" }).anthropic;
  assert.equal(c.enabledFlag, true);
  assert.equal(c.hasCredential, false);
  assert.equal(c.effectiveEnabled, false);
  assert.equal(c.apiKey, null);
  // blank / whitespace key also counts as missing
  const c2 = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: "true", RADAR_INTELLIGENCE_ANTHROPIC_API_KEY: "   " }).anthropic;
  assert.equal(c2.effectiveEnabled, false);
});

test("enabled + key -> effectiveEnabled true, apiKey carried (server-only), caps from defaults", () => {
  const c = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: "1", RADAR_INTELLIGENCE_ANTHROPIC_API_KEY: `  ${KEY}  ` }).anthropic;
  assert.equal(c.effectiveEnabled, true);
  assert.equal(c.apiKey, KEY); // trimmed
  assert.equal(c.maxOutputTokens, DEFAULT_ANTHROPIC_CONFIG.maxOutputTokens);
  assert.equal(c.maxRequestBytes, DEFAULT_ANTHROPIC_CONFIG.maxRequestBytes);
});

test("model override is read; provider identity is not affected (id stays 'anthropic' elsewhere)", () => {
  const c = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_ANTHROPIC_MODEL: "claude-opus-5" }).anthropic;
  assert.equal(c.model, "claude-opus-5");
});

test("loader never throws on hostile input", () => {
  assert.doesNotThrow(() => loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_ANTHROPIC_API_KEY: "\n\t" }));
  assert.doesNotThrow(() => loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: undefined }));
});
