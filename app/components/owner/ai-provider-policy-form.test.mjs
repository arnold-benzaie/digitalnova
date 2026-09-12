// RADAR INTELLIGENCE V2.1 — Phase C — pure-logic tests for
// ai-provider-policy-form.tsx's exported helpers. No rendering harness in
// this repo (same convention as app-sidebar-nav.test.mjs) — the pure
// functions (deriveFallbackOrder / validateFormState / buildCandidate)
// are exported specifically so this suite can exercise them directly.
//
// Run: npx tsx --test components/owner/ai-provider-policy-form.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ai-provider-policy-form.tsx -> lib/actions/radar-ai-policy-ui.ts ->
// lib/actions/radar-ai-policy.ts -> lib/rbac/require-staff-member.ts ->
// @/db (module scope) -- @/db's real module throws synchronously at
// import time when DATABASE_URL isn't set (same pattern as every other
// suite in this repo that transitively imports a "use server" action
// file). None of these pure helper functions ever touch the DB, so a
// trivial stub is enough for the static import chain to resolve.
mock.module("server-only", { namedExports: {} });
mock.module("@/db", { namedExports: { db: {} } });

const { deriveFallbackOrder, validateFormState, buildCandidate } = await import("./ai-provider-policy-form.tsx");

// ---- deriveFallbackOrder ----

test("deriveFallbackOrder: default provider first, the other enabled provider after", () => {
  assert.deepEqual(deriveFallbackOrder(["anthropic", "openai"], "anthropic"), ["anthropic", "openai"]);
  assert.deepEqual(deriveFallbackOrder(["anthropic", "openai"], "openai"), ["openai", "anthropic"]);
});

test("deriveFallbackOrder: only one provider enabled -> a single-entry order", () => {
  assert.deepEqual(deriveFallbackOrder(["anthropic"], "anthropic"), ["anthropic"]);
  assert.deepEqual(deriveFallbackOrder(["openai"], "openai"), ["openai"]);
});

test("deriveFallbackOrder: no provider enabled -> empty order", () => {
  assert.deepEqual(deriveFallbackOrder([], null), []);
});

test("deriveFallbackOrder: defaultProvider null -> canonical order of enabled providers", () => {
  assert.deepEqual(deriveFallbackOrder(["anthropic", "openai"], null), ["anthropic", "openai"]);
});

test("deriveFallbackOrder: defaultProvider not actually in enabledProviders -> ignored, canonical order used", () => {
  assert.deepEqual(deriveFallbackOrder(["openai"], "anthropic"), ["openai"]);
});

// ---- validateFormState ----

test("validateFormState: a valid state has no errors", () => {
  assert.deepEqual(validateFormState({ enabledProviders: ["anthropic", "openai"], defaultProvider: "anthropic", fallbackEnabled: true }), []);
});

test("validateFormState: zero enabled providers -> errAtLeastOneEnabled", () => {
  const errors = validateFormState({ enabledProviders: [], defaultProvider: null, fallbackEnabled: true });
  assert.ok(errors.includes("errAtLeastOneEnabled"));
});

test("validateFormState: defaultProvider set but not enabled -> errDefaultMustBeEnabled", () => {
  const errors = validateFormState({ enabledProviders: ["openai"], defaultProvider: "anthropic", fallbackEnabled: true });
  assert.ok(errors.includes("errDefaultMustBeEnabled"));
});

test("validateFormState: defaultProvider null is always valid regardless of enabledProviders", () => {
  assert.deepEqual(validateFormState({ enabledProviders: ["anthropic"], defaultProvider: null, fallbackEnabled: false }), []);
});

test("validateFormState: both violations reported together", () => {
  const errors = validateFormState({ enabledProviders: [], defaultProvider: "anthropic", fallbackEnabled: true });
  assert.ok(errors.includes("errAtLeastOneEnabled"));
  assert.ok(errors.includes("errDefaultMustBeEnabled"));
});

// ---- buildCandidate ----

test("buildCandidate: mode is always fixed to 'AUTO' -- never emits 'MANUAL' from this V1 UI", () => {
  const candidate = buildCandidate({ enabledProviders: ["anthropic", "openai"], defaultProvider: "openai", fallbackEnabled: true });
  assert.equal(candidate.mode, "AUTO");
});

test("buildCandidate: allowUserSelection is always fixed to false, userSelectableProviders always [] -- Phase D is never activated from this UI", () => {
  const candidate = buildCandidate({ enabledProviders: ["anthropic"], defaultProvider: "anthropic", fallbackEnabled: true });
  assert.equal(candidate.allowUserSelection, false);
  assert.deepEqual(candidate.userSelectableProviders, []);
});

test("buildCandidate: fallbackOrder is derived, defaultProvider/enabledProviders/fallbackEnabled reflect the form state exactly", () => {
  const candidate = buildCandidate({ enabledProviders: ["anthropic", "openai"], defaultProvider: "openai", fallbackEnabled: false });
  assert.equal(candidate.defaultProvider, "openai");
  assert.deepEqual(candidate.enabledProviders, ["anthropic", "openai"]);
  assert.equal(candidate.fallbackEnabled, false);
  assert.deepEqual(candidate.fallbackOrder, ["openai", "anthropic"]);
});

test("buildCandidate: never includes an apiKey/secret/token/credential field -- structurally impossible, only the 7 ProviderPolicy fields are set", () => {
  const candidate = buildCandidate({ enabledProviders: ["anthropic"], defaultProvider: "anthropic", fallbackEnabled: true });
  assert.deepEqual(
    Object.keys(candidate).sort(),
    ["mode", "defaultProvider", "fallbackOrder", "enabledProviders", "userSelectableProviders", "allowUserSelection", "fallbackEnabled"].sort(),
  );
});

test("buildCandidate: produces a candidate that survives the real Phase B validator (validateProviderPolicyCandidate)", async () => {
  const { validateProviderPolicyCandidate } = await import("../../lib/radar-intelligence/provider-policy.ts");
  const candidate = buildCandidate({ enabledProviders: ["anthropic", "openai"], defaultProvider: "anthropic", fallbackEnabled: true });
  const result = validateProviderPolicyCandidate(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.errors));
});

test("buildCandidate: a single-provider-enabled candidate also survives the real Phase B validator", async () => {
  const { validateProviderPolicyCandidate } = await import("../../lib/radar-intelligence/provider-policy.ts");
  const candidate = buildCandidate({ enabledProviders: ["openai"], defaultProvider: "openai", fallbackEnabled: false });
  const result = validateProviderPolicyCandidate(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.errors));
});
