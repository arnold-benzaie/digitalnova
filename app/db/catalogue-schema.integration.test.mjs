// Structure-only integration tests for P0.1B.1 — Catalogue Schema
// Foundation (services, service_market_offers, service_relations,
// service_legacy_identifiers). Proves, against a REAL Postgres database,
// that every constraint from the P0.1B.1 design holds: market/currency
// pairing, uniqueness, self-reference rejection, non-negative price,
// decimal precision.
//
// Deliberately named *.integration.test.mjs (not part of `npm test`'s
// curated file list, same convention as chat.integration.test.mjs and
// lib/product-events.integration.test.mjs) — requires a real Postgres
// connection, run separately, never as part of the default suite.
//
// Runs against the same fully isolated local Docker Postgres already used
// by lib/actions/user-approval.test.mjs and
// lib/product-events.integration.test.mjs (public-map-approval-test-db,
// port 5434) — NEVER Supabase Preview/Production. This file inserts ZERO
// business data beyond the disposable rows each test creates and cleans
// up itself; no SERVICE_ID from the real catalogue is ever used here.
//
// Run with: npx tsx --test --experimental-test-module-mocks db/catalogue-schema.integration.test.mjs
import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Preview/Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

const { db } = await import("@/db");
const { services, serviceMarketOffers, serviceRelations, serviceLegacyIdentifiers } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

after(async () => {
  await db.$client.end();
});

// node-postgres/Drizzle wrap the real Postgres error in `.cause` — the
// SQLSTATE code (not the message text, which can change wording between
// Postgres versions) is the robust thing to assert on.
// 23505 = unique_violation, 23503 = foreign_key_violation, 23514 = check_violation
const PG_CODE = { UNIQUE: "23505", FK: "23503", CHECK: "23514" };

async function assertRejectsWithPgCode(promise, expectedCode) {
  try {
    await promise;
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    assert.equal(
      code,
      expectedCode,
      `expected Postgres SQLSTATE ${expectedCode}, got ${code} (${error?.cause?.message ?? error?.message})`,
    );
    return;
  }
  assert.fail("expected the insert/delete to be rejected by a database constraint, but it succeeded");
}

// ---- fixtures (disposable, prefixed to avoid any collision with a real
// future SERVICE_ID — cleaned up after every test) -------------------

function testServiceId(label) {
  return `test_p01b1_${label}_${randomUUID().slice(0, 8)}`;
}

async function insertTestService(overrides = {}) {
  const serviceId = overrides.serviceId ?? testServiceId("svc");
  await db.insert(services).values({
    serviceId,
    type: "INDIVIDUAL_SERVICE",
    displayNameFr: "Service de test",
    displayNameEn: "Test service",
    descriptionFr: "Description de test",
    descriptionEn: "Test description",
    ...overrides,
  });
  return serviceId;
}

const createdServiceIds = [];

afterEach(async () => {
  // Children first (FK RESTRICT means a service with live offers/relations
  // cannot be deleted directly — clean up in dependency order).
  for (const id of createdServiceIds.splice(0)) {
    await db.delete(serviceLegacyIdentifiers).where(eq(serviceLegacyIdentifiers.serviceId, id));
    await db.delete(serviceMarketOffers).where(eq(serviceMarketOffers.serviceId, id));
    await db.delete(serviceRelations).where(eq(serviceRelations.parentServiceId, id));
    await db.delete(serviceRelations).where(eq(serviceRelations.childServiceId, id));
    await db.delete(services).where(eq(services.serviceId, id)).catch(() => {});
  }
});

// ---- 1. tables exist --------------------------------------------------

test("1. the four catalogue tables exist and accept a minimal valid row each", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);

  const [row] = await db.select().from(services).where(eq(services.serviceId, serviceId));
  assert.equal(row.status, "ACTIVE", "default status should apply");
  assert.equal(row.priceDerivation, "NOT_APPLICABLE", "default price_derivation should apply");

  await db.insert(serviceMarketOffers).values({
    serviceId,
    market: "CANADA",
    currency: "CAD",
    price: "100.00",
    paymentFrequency: "ONE_TIME",
    ctaType: "REQUEST_QUOTE",
  });
  const [offer] = await db.select().from(serviceMarketOffers).where(eq(serviceMarketOffers.serviceId, serviceId));
  assert.equal(offer.checkoutStatus, "MOCK", "default checkout_status should apply");
  assert.equal(offer.taxDisplay, "UNSPECIFIED", "default tax_display should apply");

  const parentId = serviceId;
  const childId = await insertTestService();
  createdServiceIds.push(childId);
  await db.insert(serviceRelations).values({ parentServiceId: parentId, childServiceId: childId, relationType: "PACK_INCLUDES" });
  const [relation] = await db.select().from(serviceRelations).where(eq(serviceRelations.parentServiceId, parentId));
  assert.equal(relation.relationType, "PACK_INCLUDES");

  await db.insert(serviceLegacyIdentifiers).values({ serviceId, legacyIdentifier: testServiceId("legacy") });
  const [legacy] = await db.select().from(serviceLegacyIdentifiers).where(eq(serviceLegacyIdentifiers.serviceId, serviceId));
  assert.ok(legacy.id);
});

// ---- 2. FK validity -----------------------------------------------------

test("2. service_market_offers rejects a non-existent service_id (FK)", async () => {
  await assertRejectsWithPgCode(
    db.insert(serviceMarketOffers).values({
      serviceId: "does_not_exist_" + randomUUID(),
      market: "CANADA",
      currency: "CAD",
      price: "10.00",
      paymentFrequency: "ONE_TIME",
      ctaType: "REQUEST_QUOTE",
    }),
    PG_CODE.FK,
  );
});

// ---- 3. enum validity ---------------------------------------------------

test("3. services.type rejects a value outside the enum", async () => {
  await assertRejectsWithPgCode(
    db.insert(services).values({
      serviceId: testServiceId("badtype"),
      type: "NOT_A_REAL_TYPE",
      displayNameFr: "x",
      displayNameEn: "x",
      descriptionFr: "x",
      descriptionEn: "x",
    }),
    PG_CODE.CHECK,
  );
});

// ---- 4. duplicate service_id rejected ------------------------------------

test("4. duplicate service_id is rejected (primary key)", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await assertRejectsWithPgCode(
    db.insert(services).values({
      serviceId,
      type: "INDIVIDUAL_SERVICE",
      displayNameFr: "dup",
      displayNameEn: "dup",
      descriptionFr: "dup",
      descriptionEn: "dup",
    }),
    PG_CODE.UNIQUE,
  );
});

// ---- 5. duplicate (service_id, market) rejected --------------------------

test("5. duplicate (service_id, market) is rejected (unique constraint)", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await db.insert(serviceMarketOffers).values({
    serviceId,
    market: "CANADA",
    currency: "CAD",
    price: "50.00",
    paymentFrequency: "ONE_TIME",
    ctaType: "REQUEST_QUOTE",
  });
  await assertRejectsWithPgCode(
    db.insert(serviceMarketOffers).values({
      serviceId,
      market: "CANADA",
      currency: "CAD",
      price: "999.00",
      paymentFrequency: "ANNUAL",
      ctaType: "DIRECT_CHECKOUT",
    }),
    PG_CODE.UNIQUE,
  );
});

// ---- 6 & 7. market/currency pairing rejected in both wrong directions ----

test("6. CANADA + EUR is rejected", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await assertRejectsWithPgCode(
    db.insert(serviceMarketOffers).values({
      serviceId,
      market: "CANADA",
      currency: "EUR",
      price: "10.00",
      paymentFrequency: "ONE_TIME",
      ctaType: "REQUEST_QUOTE",
    }),
    PG_CODE.CHECK,
  );
});

test("7. EUROPE + CAD is rejected", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await assertRejectsWithPgCode(
    db.insert(serviceMarketOffers).values({
      serviceId,
      market: "EUROPE",
      currency: "CAD",
      price: "10.00",
      paymentFrequency: "ONE_TIME",
      ctaType: "REQUEST_QUOTE",
    }),
    PG_CODE.CHECK,
  );
});

// ---- 8 & 9. valid pairs accepted -----------------------------------------

test("8. CANADA + CAD is accepted", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await db.insert(serviceMarketOffers).values({
    serviceId,
    market: "CANADA",
    currency: "CAD",
    price: "10.00",
    paymentFrequency: "ONE_TIME",
    ctaType: "REQUEST_QUOTE",
  });
  const [row] = await db.select().from(serviceMarketOffers).where(eq(serviceMarketOffers.serviceId, serviceId));
  assert.equal(row.market, "CANADA");
  assert.equal(row.currency, "CAD");
});

test("9. EUROPE + EUR is accepted", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await db.insert(serviceMarketOffers).values({
    serviceId,
    market: "EUROPE",
    currency: "EUR",
    price: "10.00",
    paymentFrequency: "ONE_TIME",
    ctaType: "REQUEST_QUOTE",
  });
  const [row] = await db.select().from(serviceMarketOffers).where(eq(serviceMarketOffers.serviceId, serviceId));
  assert.equal(row.market, "EUROPE");
  assert.equal(row.currency, "EUR");
});

// ---- 10. invalid relation rejected ---------------------------------------

test("10. service_relations rejects a non-existent parent/child (FK)", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await assertRejectsWithPgCode(
    db.insert(serviceRelations).values({
      parentServiceId: serviceId,
      childServiceId: "does_not_exist_" + randomUUID(),
      relationType: "PACK_INCLUDES",
    }),
    PG_CODE.FK,
  );
});

// ---- 11. self relation rejected -------------------------------------------

test("11. a service cannot be its own child (self-reference check)", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await assertRejectsWithPgCode(
    db.insert(serviceRelations).values({
      parentServiceId: serviceId,
      childServiceId: serviceId,
      relationType: "PACK_INCLUDES",
    }),
    PG_CODE.CHECK,
  );
});

// ---- 12. duplicate relation rejected ---------------------------------------

test("12. the exact same (parent, child, relation_type) triplet twice is rejected", async () => {
  const parentId = await insertTestService();
  const childId = await insertTestService();
  createdServiceIds.push(parentId, childId);
  await db.insert(serviceRelations).values({ parentServiceId: parentId, childServiceId: childId, relationType: "PACK_INCLUDES" });
  await assertRejectsWithPgCode(
    db.insert(serviceRelations).values({ parentServiceId: parentId, childServiceId: childId, relationType: "PACK_INCLUDES" }),
    PG_CODE.UNIQUE,
  );
});

// ---- 13 & 14. price validation ---------------------------------------------

test("13. a negative price is rejected", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await assertRejectsWithPgCode(
    db.insert(serviceMarketOffers).values({
      serviceId,
      market: "CANADA",
      currency: "CAD",
      price: "-1.00",
      paymentFrequency: "ONE_TIME",
      ctaType: "REQUEST_QUOTE",
    }),
    PG_CODE.CHECK,
  );
});

test("14. a decimal price (e.g. 1290.50) is accepted without precision loss", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await db.insert(serviceMarketOffers).values({
    serviceId,
    market: "CANADA",
    currency: "CAD",
    price: "1290.50",
    paymentFrequency: "ANNUAL",
    ctaType: "REQUEST_QUOTE",
  });
  const [row] = await db.select().from(serviceMarketOffers).where(eq(serviceMarketOffers.serviceId, serviceId));
  assert.equal(row.price, "1290.50", "numeric(10,2) must preserve the exact decimal value, no float rounding");
});

// ---- extra: legacy identifier global uniqueness (§9 design rationale) ----

test("legacy_identifier is unique across the whole table, not just per service", async () => {
  const serviceA = await insertTestService();
  const serviceB = await insertTestService();
  createdServiceIds.push(serviceA, serviceB);
  const sharedLegacyId = testServiceId("shared-legacy");
  await db.insert(serviceLegacyIdentifiers).values({ serviceId: serviceA, legacyIdentifier: sharedLegacyId });
  await assertRejectsWithPgCode(
    db.insert(serviceLegacyIdentifiers).values({ serviceId: serviceB, legacyIdentifier: sharedLegacyId }),
    PG_CODE.UNIQUE,
  );
});

// ---- extra: RESTRICT actually blocks deletion of a referenced service ----

test("deleting a service that still has a market offer is blocked (ON DELETE RESTRICT)", async () => {
  const serviceId = await insertTestService();
  createdServiceIds.push(serviceId);
  await db.insert(serviceMarketOffers).values({
    serviceId,
    market: "CANADA",
    currency: "CAD",
    price: "10.00",
    paymentFrequency: "ONE_TIME",
    ctaType: "REQUEST_QUOTE",
  });
  await assertRejectsWithPgCode(db.delete(services).where(eq(services.serviceId, serviceId)), PG_CODE.FK);
});

// ---- 15. rollback possible (structural, not executed here — see
// db/migrations/ROLLBACK.md for the exact DROP TABLE sequence; verified
// manually against this same local database, never against Preview/Prod) ----
