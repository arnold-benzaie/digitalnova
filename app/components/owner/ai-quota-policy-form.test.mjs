// RADAR INTELLIGENCE V2.1 — Phase G4A — components/owner/ai-quota-policy-form.tsx tests.
//
// Two layers, mirroring the established pattern for this codebase's other
// client-form components (see components/workforce/add-workforce-member-form.test.mjs):
//   1. Pure, exported parsing/formatting functions are unit-tested directly
//      -- this is where the actual validation LOGIC lives and is fully
//      exercised, with no DOM/event simulation needed (no jsdom in this repo).
//   2. `renderToStaticMarkup` (react-dom/server) verifies the STATIC initial
//      render only -- values populated from `initialPolicy`, no error/saved
//      message on first render, no fake consumption/remaining number ever
//      present, since G4A stores configuration only.
//
// @/lib/actions/radar-ai-quota-policy is mocked so this component's own
// action import never resolves to a real "use server" file (which the
// action-file-execution constraint forbids importing in a plain node:test
// run in some configurations) and so the suite dispatches zero DB/network
// calls regardless.
//
// Run: npx tsx --test --experimental-test-module-mocks components/owner/ai-quota-policy-form.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/actions/radar-ai-quota-policy", {
  namedExports: {
    updateRadarAiQuotaPolicy: async () => {
      throw new Error("must never be called during a static (un-submitted) render");
    },
  },
});

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ refresh: () => {} }),
  },
});

const { QuotaPolicyForm, limitToInputValue, parseLimitInput, parseThresholdInput } = await import("./ai-quota-policy-form.tsx");

const T_FR = {
  enforcementNotice: "Ces paramètres définissent une limite configurée. L'application automatique de cette limite n'est pas encore active.",
  enabledLabel: "Couche IA externe activée",
  dailyRequestLimitLabel: "Limite quotidienne de requêtes",
  dailyRequestLimitHint: "Laisser vide pour aucune limite.",
  dailyTokenLimitLabel: "Limite quotidienne de tokens",
  dailyTokenLimitHint: "Laisser vide pour aucune limite.",
  warningThresholdLabel: "Seuil d'avertissement (%)",
  warningThresholdHint: "Pourcentage de la limite à partir duquel un avertissement futur sera affiché.",
  saveButtonLabel: "Enregistrer",
  savedMessage: "Politique de quota enregistrée.",
  validationErrorMessage: "Valeurs invalides — vérifiez les champs ci-dessus.",
};

const decodeEntities = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function render(initialPolicy) {
  return decodeEntities(renderToStaticMarkup(React.createElement(QuotaPolicyForm, { initialPolicy, t: T_FR })));
}

// ---- pure function: limitToInputValue ----

test("limitToInputValue: null -> empty string (no limit configured)", () => {
  assert.equal(limitToInputValue(null), "");
});

test("limitToInputValue: 0 -> '0' (a real, literal zero-limit value, never confused with empty)", () => {
  assert.equal(limitToInputValue(0), "0");
});

test("limitToInputValue: a positive integer -> its decimal string", () => {
  assert.equal(limitToInputValue(500), "500");
});

// ---- pure function: parseLimitInput ----

test("parseLimitInput: empty/whitespace-only string -> null (no limit)", () => {
  assert.equal(parseLimitInput(""), null);
  assert.equal(parseLimitInput("   "), null);
});

test("parseLimitInput: '0' -> 0 (a real zero limit, not null)", () => {
  assert.equal(parseLimitInput("0"), 0);
});

test("parseLimitInput: a positive integer string -> the integer", () => {
  assert.equal(parseLimitInput("500"), 500);
});

test("parseLimitInput: a negative number string -> 'invalid'", () => {
  assert.equal(parseLimitInput("-1"), "invalid");
});

test("parseLimitInput: a float string -> 'invalid'", () => {
  assert.equal(parseLimitInput("10.5"), "invalid");
});

test("parseLimitInput: a non-numeric string -> 'invalid'", () => {
  assert.equal(parseLimitInput("abc"), "invalid");
  assert.equal(parseLimitInput("1e10"), "invalid");
  assert.equal(parseLimitInput("Infinity"), "invalid");
});

// ---- pure function: parseThresholdInput ----

test("parseThresholdInput: 0 and 100 (inclusive boundaries) are valid", () => {
  assert.equal(parseThresholdInput("0"), 0);
  assert.equal(parseThresholdInput("100"), 100);
});

test("parseThresholdInput: 101 (just above the boundary) -> 'invalid'", () => {
  assert.equal(parseThresholdInput("101"), "invalid");
});

test("parseThresholdInput: an empty string -> 'invalid' (no 'no threshold' state exists)", () => {
  assert.equal(parseThresholdInput(""), "invalid");
});

test("parseThresholdInput: a negative or non-numeric string -> 'invalid'", () => {
  assert.equal(parseThresholdInput("-1"), "invalid");
  assert.equal(parseThresholdInput("abc"), "invalid");
});

// ---- static initial render ----

const ENABLED_POLICY = { enabled: true, dailyRequestLimit: 500, dailyTokenLimit: 200000, warningThresholdPercent: 80 };
const DISABLED_UNLIMITED_POLICY = { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 50 };

test("initial render: shows every configured label and the enforcement notice", () => {
  const html = render(ENABLED_POLICY);
  for (const label of [T_FR.enforcementNotice, T_FR.enabledLabel, T_FR.dailyRequestLimitLabel, T_FR.dailyTokenLimitLabel, T_FR.warningThresholdLabel, T_FR.saveButtonLabel]) {
    assert.ok(html.includes(label), `expected label to render: ${label}`);
  }
});

test("initial render: an enabled+limited policy renders a CHECKED checkbox and the configured numeric values", () => {
  const html = render(ENABLED_POLICY);
  assert.ok(html.includes("checked"), "enabled=true must render a checked checkbox");
  assert.ok(html.includes('value="500"'));
  assert.ok(html.includes('value="200000"'));
  assert.ok(html.includes('value="80"'));
});

test("initial render: a disabled+unlimited policy renders an UNCHECKED checkbox and empty limit inputs", () => {
  const html = render(DISABLED_UNLIMITED_POLICY);
  assert.equal(html.includes("checked"), false, "enabled=false must render an unchecked checkbox (no 'checked' attribute at all)");
  assert.ok(html.includes('value=""'), "a null limit must render as an empty input, never '0' or 'null'");
});

test("initial render: no error message and no saved message on first render (never shown until a real submit)", () => {
  const html = render(ENABLED_POLICY);
  assert.equal(html.includes(T_FR.validationErrorMessage), false);
  assert.equal(html.includes(T_FR.savedMessage), false);
});

test("initial render: no fake consumption/remaining/usage number ever appears -- G4A is configuration-only", () => {
  const html = render(ENABLED_POLICY);
  assert.equal(/remaining|consumption|consommation|restant|current usage|utilisé/i.test(html), false);
});

test("initial render: no secret-shaped value (apiKey/credential/token) appears anywhere in the markup", () => {
  const html = render(ENABLED_POLICY);
  assert.equal(/apiKey|sk-ant-|sk-proj-|credential|secret/i.test(html), false);
});
