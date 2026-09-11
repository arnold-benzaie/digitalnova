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

const {
  loadRadarIntelligenceConfig,
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_ENABLED_ENV_VAR,
  ANTHROPIC_MODEL_ENV_VAR,
  OPENAI_API_KEY_ENV_VAR,
  OPENAI_ENABLED_ENV_VAR,
  OPENAI_MODEL_ENV_VAR,
} = await import("./config-loader.ts");
const { DEFAULT_ANTHROPIC_CONFIG } = await import("./adapters/config.ts");
const { DEFAULT_OPENAI_CONFIG } = await import("./adapters/openai-config.ts");

const KEY = "sk-ant-fake-not-real";
const OPENAI_KEY = "sk-proj-fake-not-real";

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

// ---------------- V2: OpenAI — the same fail-closed rules, independently ----------------

test("openai env var names are the documented ones", () => {
  assert.equal(OPENAI_ENABLED_ENV_VAR, "RADAR_INTELLIGENCE_OPENAI_ENABLED");
  assert.equal(OPENAI_API_KEY_ENV_VAR, "RADAR_INTELLIGENCE_OPENAI_API_KEY");
  assert.equal(OPENAI_MODEL_ENV_VAR, "RADAR_INTELLIGENCE_OPENAI_MODEL");
});

test("empty env -> openai fully disabled, no credential, deterministic default model", () => {
  const c = loadRadarIntelligenceConfig({}).openai;
  assert.equal(c.enabledFlag, false);
  assert.equal(c.hasCredential, false);
  assert.equal(c.effectiveEnabled, false);
  assert.equal(c.apiKey, null);
  assert.equal(c.model, DEFAULT_OPENAI_CONFIG.model);
});

test("openai enabled only on the exact strings 'true' / '1'", () => {
  const mk = (v) => loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_OPENAI_ENABLED: v, RADAR_INTELLIGENCE_OPENAI_API_KEY: OPENAI_KEY }).openai;
  assert.equal(mk("true").effectiveEnabled, true);
  assert.equal(mk("1").effectiveEnabled, true);
  assert.equal(mk(" true ").effectiveEnabled, true); // trimmed
  for (const v of ["TRUE", "True", "yes", "on", "0", "false", "", "enable", "y"]) {
    assert.equal(mk(v).effectiveEnabled, false, `"${v}" must not enable`);
    assert.equal(mk(v).enabledFlag, false);
  }
});

test("openai enabled flag true but NO api key -> effectiveEnabled false, never throws", () => {
  const c = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_OPENAI_ENABLED: "true" }).openai;
  assert.equal(c.enabledFlag, true);
  assert.equal(c.hasCredential, false);
  assert.equal(c.effectiveEnabled, false);
  assert.equal(c.apiKey, null);
  const c2 = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_OPENAI_ENABLED: "true", RADAR_INTELLIGENCE_OPENAI_API_KEY: "   " }).openai;
  assert.equal(c2.effectiveEnabled, false);
});

test("openai enabled + key -> effectiveEnabled true, apiKey carried (server-only), caps from defaults", () => {
  const c = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_OPENAI_ENABLED: "1", RADAR_INTELLIGENCE_OPENAI_API_KEY: `  ${OPENAI_KEY}  ` }).openai;
  assert.equal(c.effectiveEnabled, true);
  assert.equal(c.apiKey, OPENAI_KEY); // trimmed
  assert.equal(c.maxOutputTokens, DEFAULT_OPENAI_CONFIG.maxOutputTokens);
  assert.equal(c.maxRequestBytes, DEFAULT_OPENAI_CONFIG.maxRequestBytes);
});

test("openai model override is read; provider identity is not affected", () => {
  const c = loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_OPENAI_MODEL: "gpt-4.1-mini" }).openai;
  assert.equal(c.model, "gpt-4.1-mini");
});

test("openai loader never throws on hostile input", () => {
  assert.doesNotThrow(() => loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_OPENAI_API_KEY: "\n\t" }));
  assert.doesNotThrow(() => loadRadarIntelligenceConfig({ RADAR_INTELLIGENCE_OPENAI_ENABLED: undefined }));
});

// ---------------- V2: independence — each provider's flags never touch the other ----------------

test("V2: Anthropic enabled+keyed while OpenAI is fully unset -> only Anthropic effectively enabled", () => {
  const config = loadRadarIntelligenceConfig({
    RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: "true",
    RADAR_INTELLIGENCE_ANTHROPIC_API_KEY: KEY,
  });
  assert.equal(config.anthropic.effectiveEnabled, true);
  assert.equal(config.openai.effectiveEnabled, false);
  assert.equal(config.openai.apiKey, null);
});

test("V2: OpenAI enabled+keyed while Anthropic is fully unset -> only OpenAI effectively enabled", () => {
  const config = loadRadarIntelligenceConfig({
    RADAR_INTELLIGENCE_OPENAI_ENABLED: "true",
    RADAR_INTELLIGENCE_OPENAI_API_KEY: OPENAI_KEY,
  });
  assert.equal(config.openai.effectiveEnabled, true);
  assert.equal(config.anthropic.effectiveEnabled, false);
  assert.equal(config.anthropic.apiKey, null);
});

test("V2: both providers configured independently, both effectively enabled with their own distinct keys/models", () => {
  const config = loadRadarIntelligenceConfig({
    RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: "true",
    RADAR_INTELLIGENCE_ANTHROPIC_API_KEY: KEY,
    RADAR_INTELLIGENCE_ANTHROPIC_MODEL: "claude-sonnet-5",
    RADAR_INTELLIGENCE_OPENAI_ENABLED: "1",
    RADAR_INTELLIGENCE_OPENAI_API_KEY: OPENAI_KEY,
    RADAR_INTELLIGENCE_OPENAI_MODEL: "gpt-4o-mini",
  });
  assert.equal(config.anthropic.effectiveEnabled, true);
  assert.equal(config.openai.effectiveEnabled, true);
  assert.equal(config.anthropic.apiKey, KEY);
  assert.equal(config.openai.apiKey, OPENAI_KEY);
  assert.equal(config.anthropic.model, "claude-sonnet-5");
  assert.equal(config.openai.model, "gpt-4o-mini");
  assert.notEqual(config.anthropic.apiKey, config.openai.apiKey);
});

test("V2: OpenAI is disabled by default (mission requirement) even when Anthropic is fully configured", () => {
  const config = loadRadarIntelligenceConfig({
    RADAR_INTELLIGENCE_ANTHROPIC_ENABLED: "true",
    RADAR_INTELLIGENCE_ANTHROPIC_API_KEY: KEY,
  });
  assert.equal(config.openai.enabledFlag, false);
  assert.equal(config.openai.effectiveEnabled, false);
});
