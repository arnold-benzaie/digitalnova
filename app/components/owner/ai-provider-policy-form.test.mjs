// RADAR INTELLIGENCE V2.1 — Phase C/D — pure-logic tests for
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

/** Default FormState fixture -- Phase D added allowUserSelection /
 * userSelectableProviders, defaulting to the safe "off" shape so every
 * pre-Phase-D test keeps working unless it explicitly overrides them. */
function formState(overrides = {}) {
  return {
    enabledProviders: ["anthropic", "openai"],
    defaultProvider: "anthropic",
    fallbackEnabled: true,
    allowUserSelection: false,
    userSelectableProviders: [],
    ...overrides,
  };
}

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
  assert.deepEqual(validateFormState(formState()), []);
});

test("validateFormState: zero enabled providers -> errAtLeastOneEnabled", () => {
  const errors = validateFormState(formState({ enabledProviders: [], defaultProvider: null }));
  assert.ok(errors.includes("errAtLeastOneEnabled"));
});

test("validateFormState: defaultProvider set but not enabled -> errDefaultMustBeEnabled", () => {
  const errors = validateFormState(formState({ enabledProviders: ["openai"], defaultProvider: "anthropic" }));
  assert.ok(errors.includes("errDefaultMustBeEnabled"));
});

test("validateFormState: defaultProvider null is always valid regardless of enabledProviders", () => {
  assert.deepEqual(validateFormState(formState({ enabledProviders: ["anthropic"], defaultProvider: null, fallbackEnabled: false })), []);
});

test("validateFormState: both violations reported together", () => {
  const errors = validateFormState(formState({ enabledProviders: [], defaultProvider: "anthropic" }));
  assert.ok(errors.includes("errAtLeastOneEnabled"));
  assert.ok(errors.includes("errDefaultMustBeEnabled"));
});

// ---- RADAR INTELLIGENCE V2.1 Phase D: user-selection validation rules ----

test("validateFormState: allowUserSelection=true with a non-empty userSelectableProviders has no error", () => {
  assert.deepEqual(validateFormState(formState({ allowUserSelection: true, userSelectableProviders: ["anthropic"] })), []);
});

test("validateFormState: allowUserSelection=true with an EMPTY userSelectableProviders -> errAllowSelectionRequiresSelectable", () => {
  const errors = validateFormState(formState({ allowUserSelection: true, userSelectableProviders: [] }));
  assert.ok(errors.includes("errAllowSelectionRequiresSelectable"));
});

test("validateFormState: allowUserSelection=false with a non-empty userSelectableProviders still validates (existing 'may remain stored' semantics)", () => {
  assert.deepEqual(validateFormState(formState({ allowUserSelection: false, userSelectableProviders: ["anthropic", "openai"] })), []);
});

test("validateFormState: a selectable provider that is NOT enabled -> errSelectableMustBeEnabled", () => {
  const errors = validateFormState(formState({ enabledProviders: ["anthropic"], userSelectableProviders: ["openai"] }));
  assert.ok(errors.includes("errSelectableMustBeEnabled"));
});

test("validateFormState: a selectable provider that IS enabled -> no errSelectableMustBeEnabled", () => {
  const errors = validateFormState(formState({ enabledProviders: ["anthropic", "openai"], userSelectableProviders: ["openai"] }));
  assert.equal(errors.includes("errSelectableMustBeEnabled"), false);
});

test("validateFormState: multiple Phase D violations reported together", () => {
  const errors = validateFormState(formState({ enabledProviders: ["anthropic"], allowUserSelection: true, userSelectableProviders: ["openai"] }));
  assert.ok(errors.includes("errSelectableMustBeEnabled"), "openai is selectable but disabled");
  // allowUserSelection=true but the ONLY selectable entry is invalid --
  // still reports errSelectableMustBeEnabled; errAllowSelectionRequiresSelectable
  // is specifically about an EMPTY list, which this is not, so it must
  // NOT also fire (mutually exclusive by construction).
  assert.equal(errors.includes("errAllowSelectionRequiresSelectable"), false);
});

// ---- buildCandidate ----

test("buildCandidate: mode is always fixed to 'AUTO' -- never emits 'MANUAL' from this UI", () => {
  const candidate = buildCandidate(formState({ defaultProvider: "openai" }));
  assert.equal(candidate.mode, "AUTO");
});

test("buildCandidate: allowUserSelection/userSelectableProviders now reflect the LIVE form state (Phase D) -- no longer hardcoded", () => {
  const candidate = buildCandidate(formState({ allowUserSelection: true, userSelectableProviders: ["openai"] }));
  assert.equal(candidate.allowUserSelection, true);
  assert.deepEqual(candidate.userSelectableProviders, ["openai"]);
});

test("buildCandidate: allowUserSelection=false + empty userSelectableProviders (the pre-Phase-D default) still produces the exact same shape as before", () => {
  const candidate = buildCandidate(formState({ enabledProviders: ["anthropic"], defaultProvider: "anthropic" }));
  assert.equal(candidate.allowUserSelection, false);
  assert.deepEqual(candidate.userSelectableProviders, []);
});

test("buildCandidate: fallbackOrder is derived, defaultProvider/enabledProviders/fallbackEnabled reflect the form state exactly", () => {
  const candidate = buildCandidate(formState({ defaultProvider: "openai", fallbackEnabled: false }));
  assert.equal(candidate.defaultProvider, "openai");
  assert.deepEqual(candidate.enabledProviders, ["anthropic", "openai"]);
  assert.equal(candidate.fallbackEnabled, false);
  assert.deepEqual(candidate.fallbackOrder, ["openai", "anthropic"]);
});

test("buildCandidate: never includes an apiKey/secret/token/credential field -- structurally impossible, only the 7 ProviderPolicy fields are set", () => {
  const candidate = buildCandidate(formState({ enabledProviders: ["anthropic"], defaultProvider: "anthropic" }));
  assert.deepEqual(
    Object.keys(candidate).sort(),
    ["mode", "defaultProvider", "fallbackOrder", "enabledProviders", "userSelectableProviders", "allowUserSelection", "fallbackEnabled"].sort(),
  );
});

test("buildCandidate: produces a candidate that survives the real Phase B/D validator (validateProviderPolicyCandidate) -- selection OFF", async () => {
  const { validateProviderPolicyCandidate } = await import("../../lib/radar-intelligence/provider-policy.ts");
  const candidate = buildCandidate(formState());
  const result = validateProviderPolicyCandidate(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.errors));
});

test("buildCandidate: produces a candidate that survives the real validator -- selection ON with a valid selectable set", async () => {
  const { validateProviderPolicyCandidate } = await import("../../lib/radar-intelligence/provider-policy.ts");
  const candidate = buildCandidate(formState({ allowUserSelection: true, userSelectableProviders: ["anthropic", "openai"] }));
  const result = validateProviderPolicyCandidate(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.errors));
});

test("buildCandidate: a single-provider-enabled candidate also survives the real Phase B validator", async () => {
  const { validateProviderPolicyCandidate } = await import("../../lib/radar-intelligence/provider-policy.ts");
  const candidate = buildCandidate(formState({ enabledProviders: ["openai"], defaultProvider: "openai", fallbackEnabled: false }));
  const result = validateProviderPolicyCandidate(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.errors));
});

test("buildCandidate: a CLIENT-INVALID state (allowUserSelection=true, empty selectable) also fails the real server validator -- client and server rules agree", async () => {
  const { validateProviderPolicyCandidate } = await import("../../lib/radar-intelligence/provider-policy.ts");
  const candidate = buildCandidate(formState({ allowUserSelection: true, userSelectableProviders: [] }));
  const result = validateProviderPolicyCandidate(candidate);
  assert.equal(result.ok, false);
});
