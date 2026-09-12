// RADAR INTELLIGENCE V2.1 — Phase E — model-catalog.ts tests. Pure, no DB,
// no network, no server-only import needed (the module itself has none).
//
// Run: npx tsx --test lib/radar-intelligence/model-catalog.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { PROVIDER_MODEL_CATALOG, listModelsFor, listAllProviderModels, isKnownModelId } = await import("./model-catalog.ts");

test("PROVIDER_MODEL_CATALOG: exactly the two policy-configurable providers as keys", () => {
  assert.deepEqual(Object.keys(PROVIDER_MODEL_CATALOG).sort(), ["anthropic", "openai"]);
});

test("PROVIDER_MODEL_CATALOG: no gemini/deepseek/kimi/grok/local key exists", () => {
  const forged = ["gemini", "deepseek", "kimi", "grok", "local"];
  for (const id of forged) {
    assert.equal(id in PROVIDER_MODEL_CATALOG, false, `${id} must not be a catalog key`);
  }
});

test("PROVIDER_MODEL_CATALOG: every entry's providerId matches its own bucket", () => {
  for (const [providerId, models] of Object.entries(PROVIDER_MODEL_CATALOG)) {
    for (const m of models) {
      assert.equal(m.providerId, providerId);
    }
  }
});

test("PROVIDER_MODEL_CATALOG: every entry has a non-empty id, label, and a valid status", () => {
  for (const models of Object.values(PROVIDER_MODEL_CATALOG)) {
    for (const m of models) {
      assert.equal(typeof m.id, "string");
      assert.ok(m.id.length > 0);
      assert.equal(typeof m.label, "string");
      assert.ok(m.label.length > 0);
      assert.ok(["active", "deprecated"].includes(m.status));
    }
  }
});

test("PROVIDER_MODEL_CATALOG: frozen at every level (top, per-provider array, per-entry object)", () => {
  assert.ok(Object.isFrozen(PROVIDER_MODEL_CATALOG));
  assert.ok(Object.isFrozen(PROVIDER_MODEL_CATALOG.anthropic));
  assert.ok(Object.isFrozen(PROVIDER_MODEL_CATALOG.openai));
  assert.ok(Object.isFrozen(PROVIDER_MODEL_CATALOG.anthropic[0]));
});

test("listModelsFor: returns the exact same entries as the catalog for a known provider", () => {
  assert.deepEqual(listModelsFor("anthropic"), PROVIDER_MODEL_CATALOG.anthropic);
  assert.deepEqual(listModelsFor("openai"), PROVIDER_MODEL_CATALOG.openai);
});

test("listAllProviderModels: concatenates anthropic then openai, nothing else", () => {
  const all = listAllProviderModels();
  assert.deepEqual(all, [...PROVIDER_MODEL_CATALOG.anthropic, ...PROVIDER_MODEL_CATALOG.openai]);
});

// ---- isKnownModelId ----

test("isKnownModelId: a real anthropic model id is accepted for anthropic", () => {
  assert.equal(isKnownModelId("anthropic", "claude-sonnet-4-5"), true);
  assert.equal(isKnownModelId("anthropic", "claude-sonnet-5"), true);
});

test("isKnownModelId: a real openai model id is accepted for openai", () => {
  assert.equal(isKnownModelId("openai", "gpt-4o-mini"), true);
  assert.equal(isKnownModelId("openai", "gpt-5.6-terra"), true);
});

test("isKnownModelId: an openai model submitted for anthropic is rejected (provider/model mismatch)", () => {
  assert.equal(isKnownModelId("anthropic", "gpt-4o-mini"), false);
});

test("isKnownModelId: an anthropic model submitted for openai is rejected (provider/model mismatch)", () => {
  assert.equal(isKnownModelId("openai", "claude-sonnet-4-5"), false);
});

test("isKnownModelId: an unknown/forged model id is rejected for either provider", () => {
  assert.equal(isKnownModelId("anthropic", "claude-opus-9000"), false);
  assert.equal(isKnownModelId("openai", "gpt-99-turbo"), false);
});

test("isKnownModelId: non-string / empty / whitespace-only input is rejected, never thrown", () => {
  for (const bad of [undefined, null, 42, {}, [], "", "   "]) {
    assert.doesNotThrow(() => isKnownModelId("anthropic", bad));
    assert.equal(isKnownModelId("anthropic", bad), false);
  }
});

test("isKnownModelId: a gemini/deepseek/kimi/local provider id has no catalog entries at all", () => {
  for (const id of ["gemini", "deepseek", "kimi", "local"]) {
    // Cast through the loose call path a forged providerId could take.
    assert.deepEqual(listModelsFor(/** @type {any} */ (id)), []);
  }
});
