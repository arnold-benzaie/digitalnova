// Integration tests for the P0.1B.3 catalogue reader (lib/catalogue/queries.ts).
//
// Runs against the same fully isolated local Docker Postgres already used
// by db/catalogue-schema.integration.test.mjs (public-map-approval-test-db,
// port 5434) — NEVER Supabase Preview/Production. Seeds the exact
// canonical dataset (db/catalogue/canonical-dataset.mjs) imported
// verbatim, not a second hand-written copy, so these tests can never
// silently drift from what P0.1B.2 actually approved and inserted into
// Preview. Cleans up everything it inserted; Preview itself is never
// touched, written to, or even read by this file.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/catalogue/queries.integration.test.mjs
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Preview/Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

const { db } = await import("@/db");
const { services, serviceMarketOffers, serviceRelations, serviceLegacyIdentifiers } = await import("@/db/schema");
const { SERVICES, MARKET_OFFERS, RELATIONS, LEGACY_IDENTIFIERS } = await import("@/db/catalogue/canonical-dataset.mjs");
const queries = await import("@/lib/catalogue/queries");

before(async () => {
  // Seed the exact, unmodified canonical dataset — same objects P0.1B.2
  // validated and inserted into Preview, imported here rather than
  // retyped, so this suite tests against the real approved data.
  for (const s of SERVICES) {
    await db.insert(services).values({
      serviceId: s.serviceId,
      type: s.type,
      category: s.category,
      displayNameFr: s.displayNameFr,
      displayNameEn: s.displayNameEn,
      descriptionFr: s.descriptionFr,
      descriptionEn: s.descriptionEn,
      priceDerivation: s.priceDerivation,
    });
  }
  for (const o of MARKET_OFFERS) {
    await db.insert(serviceMarketOffers).values({
      serviceId: o.serviceId,
      market: o.market,
      currency: o.currency,
      price: o.price,
      paymentFrequency: o.paymentFrequency,
      billingType: o.billingType,
      taxDisplay: o.taxDisplay,
      ctaType: o.ctaType,
      checkoutStatus: o.checkoutStatus,
    });
  }
  for (const r of RELATIONS) {
    await db.insert(serviceRelations).values({
      parentServiceId: r.parentServiceId,
      childServiceId: r.childServiceId,
      relationType: r.relationType,
      displayOrder: r.displayOrder,
    });
  }
  for (const l of LEGACY_IDENTIFIERS) {
    await db.insert(serviceLegacyIdentifiers).values({ serviceId: l.serviceId, legacyIdentifier: l.legacyIdentifier, source: l.source });
  }
});

after(async () => {
  await db.delete(serviceLegacyIdentifiers);
  await db.delete(serviceRelations);
  await db.delete(serviceMarketOffers);
  await db.delete(services);
  await db.$client.end();
});

// ---- service lookup ----

test("getServiceById returns an existing service", async () => {
  const row = await queries.getServiceById("ai_visibility");
  assert.ok(row);
  assert.equal(row.displayNameFr, "Visibilité IA — AEO / GEO");
});

test("getServiceById returns undefined for a non-existent service", async () => {
  const row = await queries.getServiceById("does_not_exist");
  assert.equal(row, undefined);
});

test("listServices returns exactly the 32 canonical services", async () => {
  const rows = await queries.listServices();
  assert.equal(rows.length, 32);
});

test("listServices can filter by type", async () => {
  const packs = await queries.listServices({ type: "PACK" });
  assert.equal(packs.length, 6);
  assert.ok(packs.every((p) => p.type === "PACK"));
});

// ---- market offers ----

test("getMarketOffer returns the correct CANADA offer", async () => {
  const offer = await queries.getMarketOffer("ads_campaigns_management", "CANADA");
  assert.ok(offer);
  assert.equal(offer.market, "CANADA");
  assert.equal(offer.currency, "CAD");
  assert.equal(offer.price, "1290.00");
});

test("getMarketOffer returns the correct EUROPE offer", async () => {
  const offer = await queries.getMarketOffer("ads_campaigns_management", "EUROPE");
  assert.ok(offer);
  assert.equal(offer.market, "EUROPE");
  assert.equal(offer.currency, "EUR");
  assert.equal(offer.price, "890.00");
});

test("getMarketOffer returns undefined for a service with no offer in that market (a DUO)", async () => {
  const offer = await queries.getMarketOffer("duo_brand_foundation", "CANADA");
  assert.equal(offer, undefined, "duos have PRICE_MODE=SUM_OF_CHILDREN and no market_offer row of their own");
});

test("every CANADA offer returned is CAD, every EUROPE offer returned is EUR", async () => {
  const ca = await queries.listMarketOffers("CANADA");
  const eu = await queries.listMarketOffers("EUROPE");
  assert.equal(ca.length, 26);
  assert.equal(eu.length, 26);
  assert.ok(ca.every((o) => o.currency === "CAD"));
  assert.ok(eu.every((o) => o.currency === "EUR"));
});

// ---- legacy resolution ----

test("resolveLegacyIdentifier resolves an existing legacy id to its canonical service", async () => {
  const service = await queries.resolveLegacyIdentifier("maps-security");
  assert.ok(service);
  assert.equal(service.serviceId, "maps_security");
});

test("resolveLegacyIdentifier returns undefined for an unknown legacy id", async () => {
  const service = await queries.resolveLegacyIdentifier("this-was-never-a-real-id");
  assert.equal(service, undefined);
});

// ---- relations ----

test("getPackChildren returns only PACK_INCLUDES rows for that parent", async () => {
  const children = await queries.getPackChildren("pack_all_inclusive_prestige");
  assert.equal(children.length, 5);
  assert.ok(children.every((r) => r.relationType === "PACK_INCLUDES" && r.parentServiceId === "pack_all_inclusive_prestige"));
});

test("getDuoChildren returns only DUO_INCLUDES rows for that parent", async () => {
  const children = await queries.getDuoChildren("duo_seo_growth");
  assert.equal(children.length, 2);
  assert.ok(children.every((r) => r.relationType === "DUO_INCLUDES"));
  assert.deepEqual(children.map((r) => r.childServiceId).sort(), ["keywords_ai", "seo_prestige"]);
});

test("pack_local_growth -> ai_visibility is present via getPackChildren", async () => {
  const children = await queries.getPackChildren("pack_local_growth");
  assert.ok(children.some((r) => r.childServiceId === "ai_visibility"));
});

test("pack_local_growth -> pack_gbp_seo_launch is absent (Option B decision, still honored)", async () => {
  const children = await queries.getPackChildren("pack_local_growth");
  assert.ok(!children.some((r) => r.childServiceId === "pack_gbp_seo_launch"));
});

test("no relation returned anywhere is a self-relation", async () => {
  const allPackParents = SERVICES.filter((s) => s.type === "PACK").map((s) => s.serviceId);
  for (const parent of allPackParents) {
    const children = await queries.getPackChildren(parent);
    assert.ok(children.every((r) => r.parentServiceId !== r.childServiceId));
  }
});

test("no PACK_INCLUDES relation returned points to another PACK (no nested pack)", async () => {
  const allPackParents = SERVICES.filter((s) => s.type === "PACK").map((s) => s.serviceId);
  const typeOf = Object.fromEntries(SERVICES.map((s) => [s.serviceId, s.type]));
  for (const parent of allPackParents) {
    const children = await queries.getPackChildren(parent);
    assert.ok(children.every((r) => typeOf[r.childServiceId] !== "PACK"));
  }
});

// ---- read-only guarantee, exercised from an importable module context ----

test("the queries module exposes no function named like a mutation", () => {
  const forbiddenVerbs = /^(insert|create|update|delete|remove|upsert|seed|mutate|save|write|set|patch)/i;
  for (const name of Object.keys(queries)) {
    assert.ok(!forbiddenVerbs.test(name), `export "${name}" reads like a mutation, not a read`);
  }
});
