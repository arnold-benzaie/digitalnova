// Pure data validation for the P0.1B.2 canonical dataset — no database
// connection, no I/O. Confirms the dataset matches exactly what was
// human-approved before any insertion is attempted. If this fails, the
// insertion script must refuse to run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICES, MARKET_OFFERS, RELATIONS, LEGACY_IDENTIFIERS } from "./canonical-dataset.mjs";

test("exactly 32 services", () => {
  assert.equal(SERVICES.length, 32);
});

test("no duplicate SERVICE_ID", () => {
  const ids = SERVICES.map((s) => s.serviceId);
  assert.equal(new Set(ids).size, ids.length);
});

test("exactly 52 market offers (26 non-duo services x 2 markets)", () => {
  assert.equal(MARKET_OFFERS.length, 52);
  const nonDuo = SERVICES.filter((s) => s.type !== "DUO");
  assert.equal(nonDuo.length, 26);
});

test("every non-duo service has exactly a CANADA and a EUROPE offer, duos have none", () => {
  for (const s of SERVICES) {
    const offers = MARKET_OFFERS.filter((o) => o.serviceId === s.serviceId);
    if (s.type === "DUO") {
      assert.equal(offers.length, 0, `${s.serviceId} is a DUO and must have no market_offer row`);
    } else {
      assert.equal(offers.length, 2, `${s.serviceId} must have exactly 2 offers`);
      assert.deepEqual(offers.map((o) => o.market).sort(), ["CANADA", "EUROPE"]);
    }
  }
});

test("market/currency pairing: CANADA=CAD, EUROPE=EUR on every row, no exceptions", () => {
  for (const o of MARKET_OFFERS) {
    if (o.market === "CANADA") assert.equal(o.currency, "CAD", `${o.serviceId} CANADA row must be CAD`);
    if (o.market === "EUROPE") assert.equal(o.currency, "EUR", `${o.serviceId} EUROPE row must be EUR`);
  }
});

test("Ads canonical price is exactly 1290 CAD / 890 EUR, never the legacy 990/690", () => {
  const ca = MARKET_OFFERS.find((o) => o.serviceId === "ads_campaigns_management" && o.market === "CANADA");
  const eu = MARKET_OFFERS.find((o) => o.serviceId === "ads_campaigns_management" && o.market === "EUROPE");
  assert.equal(ca.price, "1290.00");
  assert.equal(eu.price, "890.00");
});

test("no price is negative, all prices are valid decimal strings", () => {
  for (const o of MARKET_OFFERS) {
    assert.ok(/^\d+\.\d{2}$/.test(o.price), `${o.serviceId}/${o.market} price "${o.price}" is not a clean decimal`);
    assert.ok(Number(o.price) >= 0);
  }
});

test("exactly 19 relations: 7 PACK_INCLUDES + 12 DUO_INCLUDES", () => {
  assert.equal(RELATIONS.length, 19);
  assert.equal(RELATIONS.filter((r) => r.relationType === "PACK_INCLUDES").length, 7);
  assert.equal(RELATIONS.filter((r) => r.relationType === "DUO_INCLUDES").length, 12);
});

test("no self-relations", () => {
  for (const r of RELATIONS) assert.notEqual(r.parentServiceId, r.childServiceId);
});

test("no duplicate relations", () => {
  const keys = RELATIONS.map((r) => `${r.parentServiceId}|${r.childServiceId}|${r.relationType}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("every relation references a real, existing SERVICE_ID on both sides", () => {
  const ids = new Set(SERVICES.map((s) => s.serviceId));
  for (const r of RELATIONS) {
    assert.ok(ids.has(r.parentServiceId), `unknown parent ${r.parentServiceId}`);
    assert.ok(ids.has(r.childServiceId), `unknown child ${r.childServiceId}`);
  }
});

test("no nested pack relations (a PACK_INCLUDES child must never itself be type PACK)", () => {
  const typeOf = Object.fromEntries(SERVICES.map((s) => [s.serviceId, s.type]));
  for (const r of RELATIONS.filter((r) => r.relationType === "PACK_INCLUDES")) {
    assert.notEqual(typeOf[r.childServiceId], "PACK", `${r.parentServiceId} -> ${r.childServiceId} is a pack-in-pack relation, explicitly forbidden`);
  }
});

test("pack_local_growth -> pack_gbp_seo_launch is ABSENT (Option B decision)", () => {
  const found = RELATIONS.some((r) => r.parentServiceId === "pack_local_growth" && r.childServiceId === "pack_gbp_seo_launch");
  assert.equal(found, false);
});

test("pack_local_growth -> ai_visibility is PRESENT", () => {
  const found = RELATIONS.some(
    (r) => r.parentServiceId === "pack_local_growth" && r.childServiceId === "ai_visibility" && r.relationType === "PACK_INCLUDES",
  );
  assert.equal(found, true);
});

test("exactly 30 legacy identifiers, all unique (0 collisions)", () => {
  assert.equal(LEGACY_IDENTIFIERS.length, 30);
  const idents = LEGACY_IDENTIFIERS.map((l) => l.legacyIdentifier);
  assert.equal(new Set(idents).size, idents.length, "a legacy_identifier is claimed by more than one row");
});

test("every legacy identifier references a real SERVICE_ID", () => {
  const ids = new Set(SERVICES.map((s) => s.serviceId));
  for (const l of LEGACY_IDENTIFIERS) assert.ok(ids.has(l.serviceId), `unknown service ${l.serviceId} for legacy id "${l.legacyIdentifier}"`);
});

test("maps_security and maps_products are present as SERVICE_ID, unchanged", () => {
  const ids = new Set(SERVICES.map((s) => s.serviceId));
  assert.ok(ids.has("maps_security"));
  assert.ok(ids.has("maps_products"));
});

test("all 32 services have both a French and an English description", () => {
  const missing = SERVICES.filter((s) => s.descriptionEn === null || s.descriptionFr === null).map((s) => s.serviceId);
  assert.equal(missing.length, 0, `still missing description: ${missing.join(", ")}`);
});

test("the 12 human-approved English descriptions are correctly flagged", () => {
  const approved = SERVICES.filter((s) => s.descriptionEnStatus === "HUMAN_APPROVED").map((s) => s.serviceId).sort();
  const expected = [
    "ads_campaigns_management", "duo_brand_foundation", "duo_digital_care", "duo_lead_automation",
    "duo_local_trust", "duo_maps_activity", "duo_seo_growth", "google_maps_profile_optimization",
    "pack_gbp_seo_launch", "pack_international_seo", "pack_local_growth", "pack_website_automation",
  ].sort();
  assert.equal(approved.length, 12);
  assert.deepEqual(approved, expected);
});
