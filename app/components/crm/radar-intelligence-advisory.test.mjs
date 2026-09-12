// RADAR INTELLIGENCE V1 — Slice 5 — advisory UI tests.
//
// The server action is stubbed. Proves:
//   - idle: only a button, no request on mount
//   - result rendering (via the pure AdvisoryResultView) for every status:
//     ok (deterministic + AI blocks visually separate), unavailable,
//     rate_limited, timeout, error, not_applicable
//   - FR + EN copy
//   - provider-neutral: no "Claude" / "Anthropic" anywhere
//   - no client / task / interaction UUID in the markup
//   - the disclaimer states the advisory is non-authoritative
//   - structural: button is type=button, disabled while pending, has an
//     accessible name; result region is role=status aria-live
//
// Run: npx tsx --test --experimental-test-module-mocks components/crm/radar-intelligence-advisory.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/actions/radar-intelligence", {
  namedExports: { requestRadarIntelligenceAdvisory: async () => ({ status: "unavailable" }) },
});

const { RadarIntelligenceAdvisory, AdvisoryResultView } = await import("./radar-intelligence-advisory.tsx");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.radarIntelligence;
const tEn = dictionaries.en.radarIntelligence;
const CLIENT = "33333333-3333-4333-8333-333333333333";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const SOURCE = readFileSync(fileURLToPath(new URL("./radar-intelligence-advisory.tsx", import.meta.url)), "utf8");
const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const idle = (locale) => decode(renderToStaticMarkup(createElement(RadarIntelligenceAdvisory, { clientId: CLIENT, locale })));
const view = (result, locale) => decode(renderToStaticMarkup(createElement(AdvisoryResultView, { result, locale, t: locale === "en" ? tEn : tFr })));

const noProviderName = (html) => assert.equal(/claude|anthropic/i.test(html), false, "provider name leaked into UI");
const noUuid = (html) => assert.equal(UUID_RE.test(html), false, "a UUID-shaped string is in the markup");

// ---------------- idle ----------------

test("idle: renders only the CTA button + disclaimer; no result region content; clientId not visible", () => {
  const html = idle("fr");
  assert.ok(html.includes(tFr.getAdvisoryCta));
  assert.ok(html.includes(tFr.disclaimer.slice(0, 20)));
  assert.equal(html.includes(CLIENT), false, "the client id is never rendered as text");
  assert.equal(html.includes(tFr.summaryLabel), false, "no advisory content before a request");
  noUuid(html);
  noProviderName(html);
});

test("idle: button is type=button with an accessible name; result region is a live status region", () => {
  const html = idle("fr");
  assert.ok(!/<button(?![^>]*type="button")/.test(html), "every button must be type=button");
  assert.ok(html.includes(`aria-label="${tFr.getAdvisoryCta}"`));
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-busy=/);
});

test("structural: the button is disabled while pending; no auto request on mount; no useRouter/optimistic", () => {
  assert.match(SOURCE, /disabled=\{isPending\}/);
  assert.equal(/useEffect\(/.test(SOURCE), false, "nothing runs on mount");
  assert.equal(SOURCE.includes("useRouter"), false);
  assert.equal(/optimistic/i.test(SOURCE), false);
  // exactly one action call site
  assert.equal((SOURCE.match(/requestRadarIntelligenceAdvisory\(/g) || []).length, 1);
});

// ---------------- result: ok ----------------

const OK = {
  status: "ok",
  summary: "Proposal is progressing; a timely recap would help.",
  suggestedNextAction: "Send a recap email this week",
  risks: [],
  reasoning: null,
  generatedAt: "2026-09-13T10:00:00.000Z",
  deterministic: { priority: "HIGH", confidence: "MEDIUM", recommendedNextAction: "FOLLOW_UP_PROPOSAL" },
};

test("ok: deterministic RADAR block and AI advisory block are BOTH present and visually separate (FR)", () => {
  const html = view(OK, "fr");
  assert.ok(html.includes(tFr.deterministicHeading));
  assert.match(html, /HIGH/);
  assert.match(html, /FOLLOW_UP_PROPOSAL/);
  assert.ok(html.includes(tFr.indicativeLabel));
  assert.match(html, /Proposal is progressing/);
  assert.match(html, /Send a recap email this week/);
  assert.ok(html.includes(tFr.deterministicNote));
  // two distinct <section> blocks
  assert.equal((html.match(/<section/g) || []).length, 2);
  noProviderName(html);
  noUuid(html);
});

test("ok: EN copy", () => {
  const html = view(OK, "en");
  assert.match(html, /RADAR \(deterministic\)/);
  assert.match(html, /Indicative advisory/);
  assert.match(html, /The RADAR score and priority remain deterministic\./);
});

test("ok: a missing suggestedNextAction just omits that row (no crash)", () => {
  const html = view({ ...OK, suggestedNextAction: null }, "fr");
  assert.match(html, /Proposal is progressing/);
  assert.equal(html.includes(tFr.suggestedNextActionLabel), false);
});

test("ok: nextAction renders under the exact renamed label (\"Prochaine action\" / \"Next action\")", () => {
  const fr = view(OK, "fr");
  assert.equal(tFr.suggestedNextActionLabel, "Prochaine action");
  assert.ok(fr.includes("Prochaine action"));
  assert.ok(fr.includes("Send a recap email this week"));

  const en = view(OK, "en");
  assert.equal(tEn.suggestedNextActionLabel, "Next action");
  assert.ok(en.includes("Next action"));
});

// ---------------- V1.1: risks ----------------

test("ok: risks render as a bulleted list under the Risques/Risks label (FR + EN)", () => {
  const withRisks = { ...OK, risks: ["Budget uncertain", "Decision maker unavailable"] };
  const fr = view(withRisks, "fr");
  assert.ok(fr.includes(tFr.risksLabel));
  assert.match(fr, /<ul[^>]*>[\s\S]*<li[^>]*>Budget uncertain<\/li>[\s\S]*<li[^>]*>Decision maker unavailable<\/li>[\s\S]*<\/ul>/);

  const en = view(withRisks, "en");
  assert.ok(en.includes(tEn.risksLabel));
});

test("ok: an empty risks array renders NO risks section at all (no crash, no empty <ul>)", () => {
  const html = view({ ...OK, risks: [] }, "fr");
  assert.equal(html.includes(tFr.risksLabel), false);
  assert.equal(html.includes("<ul"), false);
});

test("ok: a result built without the risks field (old shape) still renders — defensive fallback, no crash", () => {
  const legacy = { status: "ok", summary: "x", suggestedNextAction: null, generatedAt: OK.generatedAt, deterministic: OK.deterministic };
  assert.doesNotThrow(() => view(legacy, "fr"));
});

// ---------------- V1.1: reasoning ----------------

test("ok: reasoning renders under the Raisonnement/Reasoning label when present", () => {
  const withReasoning = { ...OK, reasoning: "Grounded in the recent proposal discussion." };
  const fr = view(withReasoning, "fr");
  assert.ok(fr.includes(tFr.reasoningLabel));
  assert.ok(fr.includes("Grounded in the recent proposal discussion."));

  const en = view(withReasoning, "en");
  assert.ok(en.includes(tEn.reasoningLabel));
});

test("ok: a null reasoning omits that row entirely (no crash)", () => {
  const html = view({ ...OK, reasoning: null }, "fr");
  assert.equal(html.includes(tFr.reasoningLabel), false);
});

// ---------------- V1.1: SYSTEM_ADMIN-only provider/model footer ----------------

test("providerMeta: when present, renders a small Provider/Model footer — a deliberate, server-gated exception to the provider-neutral rule", () => {
  const html = view({ ...OK, providerMeta: { provider: "anthropic", model: "claude-sonnet-5" } }, "fr");
  assert.match(html, /Provider:\s*Anthropic/);
  assert.match(html, /Model:\s*claude-sonnet-5/);
});

test("providerMeta: absent (the normal, non-SYSTEM_ADMIN case) -> no footer, and the provider-neutral rule holds", () => {
  const html = view(OK, "fr");
  assert.equal(/Provider:|Model:/.test(html), false);
  noProviderName(html);
});

test("providerMeta: an unrecognized future provider id falls back to rendering the raw id, never throws", () => {
  const html = view({ ...OK, providerMeta: { provider: "future-provider", model: "some-model" } }, "fr");
  assert.match(html, /Provider:\s*future-provider/);
});

// ---------------- V2: fallbackUsed line, same SYSTEM_ADMIN-only footer ----------------

test("V2: fallbackUsed:false renders 'Fallback used: No' alongside Provider/Model", () => {
  const html = view({ ...OK, providerMeta: { provider: "anthropic", model: "claude-sonnet-5", fallbackUsed: false } }, "fr");
  assert.match(html, /Provider:\s*Anthropic/);
  assert.match(html, /Model:\s*claude-sonnet-5/);
  assert.match(html, /Fallback used:\s*No/);
});

test("V2: fallbackUsed:true + provider openai renders 'Provider: OpenAI' and 'Fallback used: Yes'", () => {
  const html = view({ ...OK, providerMeta: { provider: "openai", model: "gpt-4o-mini", fallbackUsed: true } }, "fr");
  assert.match(html, /Provider:\s*OpenAI/);
  assert.match(html, /Model:\s*gpt-4o-mini/);
  assert.match(html, /Fallback used:\s*Yes/);
});

test("V2: a pre-V2 providerMeta shape with no fallbackUsed field at all renders no 'Fallback used' line — backward compatible", () => {
  const html = view({ ...OK, providerMeta: { provider: "anthropic", model: "claude-sonnet-5" } }, "fr");
  assert.equal(/Fallback used/.test(html), false);
});

test("V2: providerMeta absent -> still no 'Fallback used' text anywhere, provider-neutral rule holds", () => {
  const html = view(OK, "fr");
  assert.equal(/Fallback used/.test(html), false);
  noProviderName(html);
});

// ---------------- result: failure/unavailable statuses ----------------

for (const [status, frNeedle, enNeedle] of [
  ["unavailable", tFr.unavailable, tEn.unavailable],
  ["rate_limited", tFr.rateLimited, tEn.rateLimited],
  ["timeout", tFr.timeout, tEn.timeout],
  ["error", tFr.genericError, tEn.genericError],
  ["not_applicable", tFr.notApplicable, tEn.notApplicable],
]) {
  test(`${status}: safe localized message only, no provider name, no raw code`, () => {
    const fr = view({ status }, "fr");
    const en = view({ status }, "en");
    assert.match(fr, new RegExp(frNeedle.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(en, new RegExp(enNeedle.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(fr.includes("PROVIDER_"), false, "no raw error code");
    assert.equal(fr.includes("<section"), false, "no deterministic/AI blocks on a failure status");
    noProviderName(fr);
  });
}

// ---------------- operator diagnostic suffix (SYSTEM_ADMIN-only, server-decided) ----------------

test("diagnostic: when the result carries a `diagnostic`, a small labelled suffix is rendered (FR)", () => {
  const html = view({ status: "error", diagnostic: "PROVIDER_4XX" }, "fr");
  assert.ok(html.includes(tFr.genericError), "the safe message is still shown");
  assert.ok(html.includes(tFr.diagnosticPrefix), "the diagnostic label is shown");
  assert.ok(html.includes("PROVIDER_4XX"), "the coarse class is shown");
  assert.equal(html.includes("<section"), false, "still no deterministic/AI blocks on a failure status");
  noProviderName(html);
  noUuid(html);
});

test("diagnostic: EN suffix", () => {
  const html = view({ status: "unavailable", diagnostic: "PROVIDER_5XX" }, "en");
  assert.ok(html.includes(tEn.unavailable));
  assert.ok(html.includes(tEn.diagnosticPrefix));
  assert.ok(html.includes("PROVIDER_5XX"));
});

test("diagnostic: every coarse class renders as a plain token, nothing else", () => {
  for (const cls of ["PROVIDER_4XX", "PROVIDER_5XX", "PROVIDER_TIMEOUT", "PROVIDER_NETWORK", "PROVIDER_PARSE", "PROVIDER_UNKNOWN"]) {
    const html = view({ status: "error", diagnostic: cls }, "fr");
    assert.ok(html.includes(cls));
    noUuid(html);
    noProviderName(html);
    assert.equal(/\b(4\d\d|5\d\d)\b/.test(html.replace(/PROVIDER_[45]XX/g, "")), false, "no raw HTTP status number");
  }
});

test("diagnostic: with NO `diagnostic` on the result, no suffix and no 'PROVIDER_' text is emitted", () => {
  for (const status of ["unavailable", "rate_limited", "timeout", "error", "not_applicable"]) {
    const html = view({ status }, "fr");
    assert.equal(html.includes(tFr.diagnosticPrefix), false, `${status}: no diagnostic label`);
    assert.equal(html.includes("PROVIDER_"), false, `${status}: no raw class token`);
  }
});

// ---------------- httpStatus: renders as "(NNN)" appended to the same line, SYSTEM_ADMIN-only by construction ----------------

test("httpStatus: renders as \"Diagnostic : PROVIDER_4XX (400)\" when the result carries both fields (FR)", () => {
  const html = view({ status: "error", diagnostic: "PROVIDER_4XX", httpStatus: 400 }, "fr");
  assert.ok(html.includes(`${tFr.diagnosticPrefix} PROVIDER_4XX (400)`), "exact expected diagnostic line");
  noUuid(html);
  noProviderName(html);
});

test("httpStatus: renders for every genuine provider status class (401 / 403 / 429 / 500 / 503)", () => {
  for (const [cls, status] of [
    ["PROVIDER_4XX", 401],
    ["PROVIDER_4XX", 403],
    ["PROVIDER_4XX", 429],
    ["PROVIDER_5XX", 500],
    ["PROVIDER_5XX", 503],
  ]) {
    const html = view({ status: "error", diagnostic: cls, httpStatus: status }, "fr");
    assert.ok(html.includes(`${cls} (${status})`), `expected ${cls} (${status})`);
  }
});

test("httpStatus: WITHOUT httpStatus, the line still renders as the plain class only — e.g. \"Diagnostic : PROVIDER_NETWORK\"", () => {
  const html = view({ status: "error", diagnostic: "PROVIDER_NETWORK" }, "fr");
  assert.ok(html.includes(`${tFr.diagnosticPrefix} PROVIDER_NETWORK`));
  assert.equal(/PROVIDER_NETWORK\s*\(/.test(html), false, "no parenthesised number appended when there is none");
});

test("httpStatus: EN rendering, no parentheses when absent", () => {
  const withStatus = view({ status: "unavailable", diagnostic: "PROVIDER_5XX", httpStatus: 503 }, "en");
  assert.ok(withStatus.includes(`${tEn.diagnosticPrefix} PROVIDER_5XX (503)`));

  const withoutStatus = view({ status: "timeout", diagnostic: "PROVIDER_TIMEOUT" }, "en");
  assert.ok(withoutStatus.includes(`${tEn.diagnosticPrefix} PROVIDER_TIMEOUT`));
  assert.equal(withoutStatus.includes("("), false);
});


test("diagnostic: the component itself does no RBAC — the server action is the sole authority", () => {
  // no permission evaluation, no role catalogue, no session read, no
  // gateway/registry/transport call in the client component
  assert.equal(SOURCE.includes("evaluateStaffPermission"), false);
  assert.equal(SOURCE.includes("requireSession"), false);
  assert.equal(/hasPermission|staffMembers|staff_roles/.test(SOURCE), false);
  assert.equal(/createRadarIntelligenceGateway|createConfiguredRadarIntelligenceRegistry|AnthropicHttpTransport/.test(SOURCE), false);
  // the ONLY server touchpoint is the one gated action
  assert.equal((SOURCE.match(/requestRadarIntelligenceAdvisory\(/g) || []).length, 1);
});

test("diagnostic: diagnosticPrefix exists in FR + EN, non-empty, provider-neutral", () => {
  for (const t of [tFr, tEn]) {
    assert.equal(typeof t.diagnosticPrefix, "string");
    assert.ok(t.diagnosticPrefix.length > 0);
    assert.equal(/claude|anthropic/i.test(t.diagnosticPrefix), false);
  }
});

// ---------------- disclaimer / non-authoritative ----------------

test("disclaimer names the things the advisory does NOT change (FR + EN)", () => {
  for (const t of [tFr, tEn]) {
    assert.match(t.disclaimer, /(priorité|priority)/i);
    assert.match(t.disclaimer, /(score)/i);
    assert.match(t.disclaimer, /(qualification)/i);
    assert.match(t.disclaimer, /(attribution|assignment)/i);
    assert.match(t.disclaimer, /(relances|follow-ups)/i);
  }
});

test("i18n: FR and EN key sets are identical, all non-empty; no 'Claude'/'Anthropic' in any string", () => {
  assert.deepEqual(Object.keys(tFr).sort(), Object.keys(tEn).sort());
  for (const t of [tFr, tEn]) {
    for (const [k, v] of Object.entries(t)) {
      assert.equal(typeof v, "string");
      assert.ok(v.length > 0, `${k} empty`);
      assert.equal(/claude|anthropic/i.test(v), false, `${k} names a provider`);
    }
  }
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase D: per-request provider selector
// =====================================================================

const idleWithSelection = (locale, selectionOptions) =>
  decode(renderToStaticMarkup(createElement(RadarIntelligenceAdvisory, { clientId: CLIENT, locale, selectionOptions })));

test("Phase D: selectionOptions omitted -> selector absent, byte-identical to pre-Phase-D markup", () => {
  const withSelection = idleWithSelection("fr", undefined);
  const withoutProp = idle("fr");
  assert.equal(withSelection, withoutProp);
  assert.equal(withSelection.includes("<select"), false);
});

test("Phase D: selectionOptions with an empty selectableProviders array -> selector hidden (covers both 'not allowed' and 'nothing usable')", () => {
  const html = idleWithSelection("fr", { selectableProviders: [] });
  assert.equal(html.includes("<select"), false);
  assert.equal(html.includes(tFr.aiProviderLabel), false);
});

test("Phase D: selectionOptions with providers -> selector appears, labelled, with Automatic always first", () => {
  const html = idleWithSelection("fr", { selectableProviders: ["anthropic", "openai"] });
  assert.ok(html.includes("<select"));
  assert.ok(html.includes(tFr.aiProviderLabel));
  assert.match(html, /<option value=""[^>]*>\s*Automatique/);
});

test("Phase D: only the OWNER-authorized providers are rendered as options -- never a hardcoded third option", () => {
  const html = idleWithSelection("fr", { selectableProviders: ["anthropic"] });
  assert.match(html, /<option[^>]*value="anthropic"[^>]*>\s*Anthropic/);
  assert.equal(/value="openai"/.test(html), false, "OpenAI must not be offered when the OWNER policy did not authorize it");
});

test("Phase D: an unsupported/unexpected id in selectionOptions still renders (defensive fallback to the raw id, never throws) -- authorization already happened server-side before this prop was built", () => {
  assert.doesNotThrow(() => idleWithSelection("fr", { selectableProviders: ["some-future-id"] }));
  const html = idleWithSelection("fr", { selectableProviders: ["some-future-id"] });
  assert.match(html, /value="some-future-id"/);
});

test("Phase D: EN selector copy", () => {
  const html = idleWithSelection("en", { selectableProviders: ["openai"] });
  assert.ok(html.includes(tEn.aiProviderLabel));
  assert.match(html, /<option value=""[^>]*>\s*Automatic/);
  assert.match(html, /value="openai"[^>]*>\s*OpenAI/);
});

test("Phase D: the selector is disabled while a request is pending, same as the CTA button (structural — no live-interaction harness in this repo)", () => {
  assert.match(SOURCE, /disabled=\{isPending\}/g);
  // Both the CTA button and the new <select> share the identical
  // disabled-while-pending expression — count at least 2 occurrences.
  assert.ok((SOURCE.match(/disabled=\{isPending\}/g) || []).length >= 2, "both the button and the selector must disable while pending");
});

test("Phase D: the selected provider id is what gets sent to the server action, never a second/parallel request path", () => {
  // Structural: exactly one call site (already asserted elsewhere), and
  // that ONE call site passes selectedProviderId as the second argument.
  assert.match(SOURCE, /requestRadarIntelligenceAdvisory\(clientId,\s*selectedProviderId\)/);
});

test("Phase D: no persistence of the selected provider -- no localStorage/sessionStorage USAGE anywhere in this component; state resets to Automatic on remount", () => {
  // Property-access check, not a bare word match: this file's own
  // docstring/comments legitimately mention "localStorage" to explain
  // its deliberate absence, so a naive substring test would false-positive.
  assert.equal(/\blocalStorage\.|\blocalStorage\[|\bsessionStorage\.|\bsessionStorage\[/.test(SOURCE), false);
  assert.match(SOURCE, /useState<string \| null>\(null\)/);
});

test("Phase D: provider names are shown ONLY inside the selector's own markup when authorized -- the disclaimer/idle text remains provider-neutral", () => {
  const html = idleWithSelection("fr", { selectableProviders: ["anthropic", "openai"] });
  assert.ok(html.includes(tFr.disclaimer.slice(0, 20)));
  // The disclaimer text itself never names a provider, independent of
  // whether the selector is shown.
  assert.equal(/claude|anthropic|openai/i.test(tFr.disclaimer), false);
});

test("Phase D: selector-shown markup still leaks no API key / env value / secret alongside the provider names", () => {
  const html = idleWithSelection("fr", { selectableProviders: ["anthropic", "openai"] });
  assert.equal(/sk-ant-|sk-proj-|apiKey|DATABASE_URL/i.test(html), false);
  noUuid(html);
});

test("Phase D: getRadarAiProviderSelectionOptions is never imported/called from this client component -- the parent page resolves it server-side", () => {
  assert.equal(SOURCE.includes("getRadarAiProviderSelectionOptions"), false);
});
