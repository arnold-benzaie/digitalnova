// lib/radar/radar-copy.test.mjs — PHASE RADAR-CORE-3F.
//
// The deterministic scoring engine (lib/radar/score.ts) now emits stable
// semantic codes; lib/i18n/dictionaries/crm.ts is the single place the
// RADAR "Pourquoi" / "Prochaine étape" columns are localized. This file
// owns two guarantees that used to be asserted against the engine's
// English prose (radar-queue.integration / radar-qualification.integration):
//   1. every RADAR_REASON_CODES / RADAR_NEXT_ACTION_CODES member has
//      exactly one FR entry and one EN entry — no missing code, no extra
//      key, FR/EN key sets identical;
//   2. no FR or EN reason / next-action copy uses predictive / probability
//      wording (RADAR surfaces grounded facts, never a conversion odds).
//
// Imports the RUNTIME code arrays (not the TS union types, which do not
// exist at runtime). NOT wired into package.json's `test` list — run with:
//   npx tsx --test lib/radar/radar-copy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { RADAR_REASON_CODES, RADAR_NEXT_ACTION_CODES } from "./score.ts";
import { dictionaries } from "@/lib/i18n/dictionaries";

const PARAMETRIC_REASON_CODES = ["INDUSTRY_RECORDED", "LOCATION_RECORDED"];

const FR = dictionaries.fr.crm.radar;
const EN = dictionaries.en.crm.radar;

const sorted = (a) => [...a].sort();

// Grounded-facts guarantee: RADAR never states conversion odds. Anchored
// to whole words / stems so it is strict without being absurdly broad.
const PREDICTIVE = /\b(percent|pourcent|probabilit(?:y|é)|likely to|will convert|expected to|susceptible de convertir|va convertir)\b/i;

function copyStrings(block) {
  // Static entries are strings; the two parametric entries are functions —
  // exercise them with a sample value so their rendered output is checked.
  return Object.values(block).map((entry) => (typeof entry === "function" ? entry("Échantillon") : entry));
}

// ---- code coverage + FR/EN symmetry ----

test("3F: crm.radar.reasons has exactly the RADAR_REASON_CODES key set in FR and EN", () => {
  const expected = sorted(RADAR_REASON_CODES);
  assert.deepEqual(sorted(Object.keys(FR.reasons)), expected, "FR reason keys must equal RADAR_REASON_CODES exactly");
  assert.deepEqual(sorted(Object.keys(EN.reasons)), expected, "EN reason keys must equal RADAR_REASON_CODES exactly");
});

test("3F: crm.radar.nextActions has exactly the RADAR_NEXT_ACTION_CODES key set in FR and EN", () => {
  const expected = sorted(RADAR_NEXT_ACTION_CODES);
  assert.deepEqual(sorted(Object.keys(FR.nextActions)), expected);
  assert.deepEqual(sorted(Object.keys(EN.nextActions)), expected);
});

test("3F: FR and EN reason key sets are identical to each other", () => {
  assert.deepEqual(sorted(Object.keys(FR.reasons)), sorted(Object.keys(EN.reasons)));
});

test("3F: FR and EN next-action key sets are identical to each other", () => {
  assert.deepEqual(sorted(Object.keys(FR.nextActions)), sorted(Object.keys(EN.nextActions)));
});

// ---- entry shape ----

test("3F: every static reason entry is a non-empty string; the two 'recorded' entries are functions returning the value", () => {
  for (const block of [FR.reasons, EN.reasons]) {
    for (const code of RADAR_REASON_CODES) {
      const entry = block[code];
      if (PARAMETRIC_REASON_CODES.includes(code)) {
        assert.equal(typeof entry, "function", `${code} must be a (value) => string entry`);
        const out = entry("ZZTOP");
        assert.equal(typeof out, "string");
        assert.ok(out.length > 0);
        assert.ok(out.includes("ZZTOP"), `${code} must interpolate the supplied value`);
      } else {
        assert.equal(typeof entry, "string", `${code} must be a plain string entry`);
        assert.ok(entry.trim().length > 0, `${code} must be non-empty`);
      }
    }
  }
});

test("3F: every next-action entry is a non-empty string in FR and EN", () => {
  for (const block of [FR.nextActions, EN.nextActions]) {
    for (const code of RADAR_NEXT_ACTION_CODES) {
      assert.equal(typeof block[code], "string");
      assert.ok(block[code].trim().length > 0);
    }
  }
});

// ---- grounded-facts guarantee (relocated from the integration tests) ----

test("3F: no FR reason / next-action copy uses predictive or probability wording", () => {
  for (const s of [...copyStrings(FR.reasons), ...Object.values(FR.nextActions)]) {
    assert.doesNotMatch(s, PREDICTIVE, `predictive wording in FR copy: "${s}"`);
  }
});

test("3F: no EN reason / next-action copy uses predictive or probability wording", () => {
  for (const s of [...copyStrings(EN.reasons), ...Object.values(EN.nextActions)]) {
    assert.doesNotMatch(s, PREDICTIVE, `predictive wording in EN copy: "${s}"`);
  }
});

test("3F: no FR/EN reason or next-action copy contains a raw semantic code", () => {
  const codes = [...RADAR_REASON_CODES, ...RADAR_NEXT_ACTION_CODES];
  for (const s of [
    ...copyStrings(FR.reasons),
    ...Object.values(FR.nextActions),
    ...copyStrings(EN.reasons),
    ...Object.values(EN.nextActions),
  ]) {
    for (const code of codes) {
      assert.ok(!s.includes(code), `rendered copy leaked the raw code "${code}": "${s}"`);
    }
  }
});

// ---- distinctness from adjacent radar copy the E2E also asserts ----

test("3F: INTERACTION_NONE reason copy is distinct from crm.radar.noInteraction (independently assertable in E2E)", () => {
  assert.notEqual(FR.reasons.INTERACTION_NONE, FR.noInteraction);
  assert.notEqual(EN.reasons.INTERACTION_NONE, EN.noInteraction);
});
