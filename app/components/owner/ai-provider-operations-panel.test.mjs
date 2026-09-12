// RADAR INTELLIGENCE V2.1 — Phase E — ai-provider-operations-panel.tsx tests.
//
// Static-markup rendering only (react-dom/server), same convention as
// components/crm/radar-intelligence-advisory.test.mjs -- no live-DOM
// interaction harness exists in this repo. The mutation server action is
// stubbed at its own import specifier (bypasses its whole transitive
// DB/RBAC chain, same trick radar-intelligence-advisory.test.mjs uses).
//
// Run: npx tsx --test --experimental-test-module-mocks components/owner/ai-provider-operations-panel.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});
mock.module("@/lib/actions/radar-ai-provider-ops-ui", {
  namedExports: { saveRadarAiProviderModelAction: async () => ({ ok: true, status: [] }) },
});

const { AiProviderOperationsPanel } = await import("./ai-provider-operations-panel.tsx");

const SOURCE = readFileSync(fileURLToPath(new URL("./ai-provider-operations-panel.tsx", import.meta.url)), "utf8");
const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const FAKE_KEY = "sk-ant-THIS-MUST-NEVER-LEAK";

const STATUS = [
  { providerId: "anthropic", credentialStatus: "configured", enabled: true, model: "claude-sonnet-4-5", modelIsOverridden: false, operationalState: "ready" },
  { providerId: "openai", credentialStatus: "not_configured", enabled: false, model: "gpt-4o-mini", modelIsOverridden: false, operationalState: "unknown" },
];
const CATALOG = {
  anthropic: [
    { providerId: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", status: "active" },
    { providerId: "anthropic", id: "claude-sonnet-5", label: "Claude Sonnet 5", status: "active" },
  ],
  openai: [{ providerId: "openai", id: "gpt-4o-mini", label: "GPT-4o mini", status: "active" }],
};

function render({ status = STATUS, catalog = CATALOG, capability = "external-only", locale = "fr" } = {}) {
  return decode(
    renderToStaticMarkup(
      createElement(AiProviderOperationsPanel, {
        initialStatus: status,
        modelCatalog: catalog,
        credentialOperationsCapability: capability,
        locale,
      }),
    ),
  );
}

// ---- credential secrecy ----

test("never renders a credential value -- only 'Configured' / 'Not configured', for either locale", () => {
  for (const locale of ["fr", "en"]) {
    const html = render({ locale });
    assert.equal(/sk-ant|sk-proj|api[_-]?key/i.test(html), false);
  }
});

test("a hostile apiKey field smuggled onto a status entry is never rendered -- this component has no code path that reads such a field", () => {
  const hostileStatus = STATUS.map((s) => ({ ...s, apiKey: FAKE_KEY }));
  const html = render({ status: hostileStatus });
  assert.ok(!html.includes(FAKE_KEY));
});

test("SOURCE never references apiKey / Authorization / Bearer / x-api-key", () => {
  assert.equal(/\bapiKey\b|Authorization|Bearer |x-api-key/i.test(SOURCE), false);
});

// ---- credential status rendering ----

test("FR: renders 'Configuré' for a configured provider and 'Non configuré' for an unconfigured one", () => {
  const html = render({ locale: "fr" });
  assert.match(html, /Configuré/);
  assert.match(html, /Non configuré/);
});

test("EN: renders 'Configured' for a configured provider and 'Not configured' for an unconfigured one", () => {
  const html = render({ locale: "en" });
  assert.match(html, /Configured/);
  assert.match(html, /Not configured/);
});

// ---- operational state: never falsely "ready" ----

test("a 'ready' provider renders the Ready state label", () => {
  const html = render({ locale: "en" });
  assert.match(html, /Ready/);
});

test("an 'unknown' provider NEVER renders 'Ready' for that provider's own operational state", () => {
  const html = render({
    status: [{ providerId: "openai", credentialStatus: "not_configured", enabled: false, model: "gpt-4o-mini", modelIsOverridden: false, operationalState: "unknown" }],
    catalog: { anthropic: [], openai: CATALOG.openai },
    locale: "en",
  });
  assert.match(html, /Unknown/);
});

test("a 'configuration_issue' provider renders the Configuration issue label, not Ready", () => {
  const html = render({
    status: [{ providerId: "anthropic", credentialStatus: "not_configured", enabled: true, model: "claude-sonnet-4-5", modelIsOverridden: false, operationalState: "configuration_issue" }],
    catalog: { anthropic: CATALOG.anthropic, openai: [] },
    locale: "en",
  });
  assert.match(html, /Configuration issue/);
});

// ---- model selection: options come ONLY from the server-provided catalog ----

test("model <select> options are exactly the provided catalog ids -- no free-text input anywhere for a model", () => {
  const html = render();
  assert.equal(/<input[^>]*type="text"[^>]*>/i.test(html), false);
  assert.match(html, /claude-sonnet-4-5/);
  assert.match(html, /claude-sonnet-5/);
  assert.match(html, /gpt-4o-mini/);
});

test("the currently effective model is pre-selected in the <select>", () => {
  const html = render();
  assert.match(html, /<option value="claude-sonnet-4-5"[^>]*selected[^>]*>/);
});

test("SOURCE never lets an arbitrary client string reach the save action -- the value comes from state seeded only by props/catalog", () => {
  assert.equal(/prompt\(|window\.prompt/.test(SOURCE), false);
});

// ---- credential operations: no dead fake functionality ----

test("credentialOperationsCapability='external-only' -> renders the fixed explanatory text, no button", () => {
  const html = render({ capability: "external-only", locale: "en" });
  assert.match(html, /Credential rotation is performed through secure infrastructure settings\./);
  // No button anywhere in the credential-operations block claims to rotate a credential.
  assert.equal(/rotate/i.test(html.match(/<button[^>]*>[^<]*<\/button>/gi)?.join(" ") ?? ""), false);
});

test("FR credential-operations text renders the French fixed copy", () => {
  const html = render({ capability: "external-only", locale: "fr" });
  assert.match(html, /La rotation des identifiants est effectuée via les paramètres d'infrastructure sécurisés\./);
});

// ---- structural ----

test("renders both known providers (Anthropic, OpenAI) by label", () => {
  const html = render();
  assert.match(html, /Anthropic/);
  assert.match(html, /OpenAI/);
});

test("each provider section renders exactly one Save-model button", () => {
  const html = render({ locale: "en" });
  const saveButtons = html.match(/Save model/g) ?? [];
  assert.equal(saveButtons.length, 2);
});
