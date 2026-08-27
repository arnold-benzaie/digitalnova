// Unit tests for the pure, DB-free helpers added in P0.2A-3
// (priceStringToCents, resolveCataloguePrefillPriceCents,
// toCatalogueServiceOptions's price enrichment). No mocks, no database —
// these functions take plain values in and return plain values out, which
// is exactly why the market/offer resolution and the numeric->cents
// conversion were kept out of lib/crm-billing.ts (server-only DB access
// lives in lib/crm-service-linking.ts instead, see its own integration
// tests).
//
// Run with: npx tsx --test lib/crm-billing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceStringToCents, resolveCataloguePrefillPriceCents, toCatalogueServiceOptions } from "./crm-billing.ts";

// ---- A. decimal string -> cents ----
test("priceStringToCents: exact conversions from the P0.2A-3 spec", () => {
  assert.equal(priceStringToCents("390.00"), 39000);
  assert.equal(priceStringToCents("49.99"), 4999);
  assert.equal(priceStringToCents("10.5"), 1050);
  assert.equal(priceStringToCents("10"), 1000);
  assert.equal(priceStringToCents("0.01"), 1);
});

test("priceStringToCents: never uses floating-point multiplication — known drift cases stay exact", () => {
  // parseFloat("49.99") * 100 === 4998.999999999999 in JS — this function
  // must never go through that path.
  assert.equal(priceStringToCents("49.99"), 4999);
  assert.equal(priceStringToCents("19.99"), 1999);
  assert.equal(priceStringToCents("2990.00"), 299000);
  assert.equal(priceStringToCents("0.1"), 10);
  assert.equal(priceStringToCents("0.30"), 30);
});

test("priceStringToCents: rejects unexpected formats instead of inventing a value", () => {
  assert.equal(priceStringToCents(""), null);
  assert.equal(priceStringToCents("   "), null);
  assert.equal(priceStringToCents("abc"), null);
  assert.equal(priceStringToCents("-10.00"), null, "negative prices are never valid — DB CHECK already forbids them");
  assert.equal(priceStringToCents("10.999"), null, "more than 2 decimals doesn't match numeric(10,2)'s real shape");
  assert.equal(priceStringToCents("10,50"), null, "comma decimal separator is not what numeric(10,2) ever returns");
  assert.equal(priceStringToCents("1e10"), null, "scientific notation is not what numeric(10,2) ever returns");
  assert.equal(priceStringToCents(null), null);
  assert.equal(priceStringToCents(undefined), null);
  assert.equal(priceStringToCents(49.99), null, "a real number, not the DB's own string, must not be silently accepted");
});

// ---- B/C. correct market + matching currency -> prefill ----
test("resolveCataloguePrefillPriceCents: CANADA market + CAD document currency prefills the CANADA price", () => {
  const option = { serviceId: "svc", label: "Svc", canadaPriceCents: 39000, europePriceCents: 25500 };
  assert.equal(resolveCataloguePrefillPriceCents(option, "CANADA", "CAD"), 39000);
});

test("resolveCataloguePrefillPriceCents: EUROPE market + EUR document currency prefills the EUROPE price", () => {
  const option = { serviceId: "svc", label: "Svc", canadaPriceCents: 39000, europePriceCents: 25500 };
  assert.equal(resolveCataloguePrefillPriceCents(option, "EUROPE", "EUR"), 25500);
});

// ---- D/E (resolution itself is integration-tested; this is the pure downstream consequence) ----
test("resolveCataloguePrefillPriceCents: unknown market (null) never prefills", () => {
  const option = { serviceId: "svc", label: "Svc", canadaPriceCents: 39000, europePriceCents: 25500 };
  assert.equal(resolveCataloguePrefillPriceCents(option, null, "CAD"), null);
  assert.equal(resolveCataloguePrefillPriceCents(option, null, "EUR"), null);
});

// ---- F. missing offer -> no prefill ----
test("resolveCataloguePrefillPriceCents: a market with no offer (null price) never prefills, even when the market/currency otherwise match", () => {
  const option = { serviceId: "svc", label: "Svc", canadaPriceCents: null, europePriceCents: 25500 };
  assert.equal(resolveCataloguePrefillPriceCents(option, "CANADA", "CAD"), null);
});

// ---- G/H. currency mismatch -> no prefill ----
test("resolveCataloguePrefillPriceCents: CANADA market but document currency EUR never prefills", () => {
  const option = { serviceId: "svc", label: "Svc", canadaPriceCents: 39000, europePriceCents: 25500 };
  assert.equal(resolveCataloguePrefillPriceCents(option, "CANADA", "EUR"), null);
});

test("resolveCataloguePrefillPriceCents: EUROPE market but document currency CAD never prefills", () => {
  const option = { serviceId: "svc", label: "Svc", canadaPriceCents: 39000, europePriceCents: 25500 };
  assert.equal(resolveCataloguePrefillPriceCents(option, "EUROPE", "CAD"), null);
});

// ---- enrichment never invents a price for a service missing from the offer map ----
test("toCatalogueServiceOptions: a service absent from offersByServiceId gets null/null, never a fabricated price", () => {
  const rows = [{ serviceId: "svc_no_offers", displayNameFr: "FR", displayNameEn: "EN" }];
  const [option] = toCatalogueServiceOptions(rows, "fr", new Map());
  assert.equal(option.canadaPriceCents, null);
  assert.equal(option.europePriceCents, null);
});

test("toCatalogueServiceOptions: omitting offersByServiceId entirely still works (P0.2A-2 backward compatibility)", () => {
  const rows = [{ serviceId: "svc", displayNameFr: "FR", displayNameEn: "EN" }];
  const [option] = toCatalogueServiceOptions(rows, "fr");
  assert.equal(option.canadaPriceCents, null);
  assert.equal(option.europePriceCents, null);
  assert.equal(option.label, "FR");
});

test("toCatalogueServiceOptions: converts real decimal-string offers to cents correctly", () => {
  const rows = [{ serviceId: "svc", displayNameFr: "FR", displayNameEn: "EN" }];
  const offers = new Map([["svc", { canada: "390.00", europe: "255.00" }]]);
  const [option] = toCatalogueServiceOptions(rows, "fr", offers);
  assert.equal(option.canadaPriceCents, 39000);
  assert.equal(option.europePriceCents, 25500);
});
