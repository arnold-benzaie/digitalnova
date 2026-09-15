// RADAR DISCOVERY ENGINE — Phase C-0 — field-masks.ts unit tests. Pure,
// no mocks, no network. Covers the generic (provider-agnostic) half of
// mission section 18 item M (field mask construction) — the
// Google-specific half is in adapters/google-places.test.mjs.
//
// Run: npx tsx --test lib/radar-discovery/field-masks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DISCOVERY_FIELD_SET_FIELDS, resolveCumulativeFields } from "./field-masks.ts";

test("minimal_discovery never includes an enrichment or details field", () => {
  const enrichmentAndDetails = new Set([...DISCOVERY_FIELD_SET_FIELDS.enrichment, ...DISCOVERY_FIELD_SET_FIELDS.details]);
  for (const field of DISCOVERY_FIELD_SET_FIELDS.minimal_discovery) {
    assert.ok(!enrichmentAndDetails.has(field), `${field} must not leak into minimal_discovery`);
  }
});

test("enrichment fields (phone/email/website) are never part of minimal_discovery -- cost control invariant", () => {
  assert.ok(!DISCOVERY_FIELD_SET_FIELDS.minimal_discovery.includes("phone"));
  assert.ok(!DISCOVERY_FIELD_SET_FIELDS.minimal_discovery.includes("email"));
  assert.ok(!DISCOVERY_FIELD_SET_FIELDS.minimal_discovery.includes("website"));
  assert.ok(DISCOVERY_FIELD_SET_FIELDS.enrichment.includes("phone"));
  assert.ok(DISCOVERY_FIELD_SET_FIELDS.enrichment.includes("website"));
});

test("resolveCumulativeFields: minimal_discovery returns exactly its own fields", () => {
  assert.deepEqual([...resolveCumulativeFields("minimal_discovery")], [...DISCOVERY_FIELD_SET_FIELDS.minimal_discovery]);
});

test("resolveCumulativeFields: enrichment includes everything minimal_discovery has, plus its own", () => {
  const fields = resolveCumulativeFields("enrichment");
  for (const f of DISCOVERY_FIELD_SET_FIELDS.minimal_discovery) assert.ok(fields.includes(f));
  for (const f of DISCOVERY_FIELD_SET_FIELDS.enrichment) assert.ok(fields.includes(f));
});

test("resolveCumulativeFields: details includes everything from all three tiers", () => {
  const fields = resolveCumulativeFields("details");
  for (const f of [...DISCOVERY_FIELD_SET_FIELDS.minimal_discovery, ...DISCOVERY_FIELD_SET_FIELDS.enrichment, ...DISCOVERY_FIELD_SET_FIELDS.details]) {
    assert.ok(fields.includes(f));
  }
});

test("resolveCumulativeFields: details is a strict superset of enrichment, which is a strict superset of minimal_discovery", () => {
  const minimal = resolveCumulativeFields("minimal_discovery").length;
  const enrichment = resolveCumulativeFields("enrichment").length;
  const details = resolveCumulativeFields("details").length;
  assert.ok(enrichment > minimal);
  assert.ok(details > enrichment);
});
