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
