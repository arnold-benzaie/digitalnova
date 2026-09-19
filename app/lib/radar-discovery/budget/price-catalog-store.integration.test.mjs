// RADAR DISCOVERY ENGINE — MISSION C-2D-6-B — real-database integration
// proof for price-catalog-store.ts. Same isolated local Docker Postgres
// as every other *.integration.test.mjs file (public-map-approval-test-db,
// port 5434).
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/budget/price-catalog-store.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { namedExports: {} });

const { db } = await import("@/db");
const { discoveryPriceCatalog, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { resolvePrice, upsertPriceCatalogEntry } = await import("./price-catalog-store.ts");

const createdCatalogIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdCatalogIds.size) await db.delete(discoveryPriceCatalog).where(inArray(discoveryPriceCatalog.id, [...createdCatalogIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function makeActorUserId() {
  const [row] = await db.insert(users).values({ clerkUserId: `price_it_${randomUUID()}`, email: `price-test-${randomUUID()}@example.com`, status: "active" }).returning();
  createdUserIds.add(row.id);
  return row.id;
}

test("resolvePrice: unknown when no entry exists at all", async () => {
  const outcome = await resolvePrice("provider_x", "search", `fs-${randomUUID()}`);
  assert.equal(outcome.status, "unknown");
});

test("resolvePrice: unknown when the entry's price is NULL (a known SKU never yet priced) -- never coerced to free", async () => {
  const actor = await makeActorUserId();
  const fieldSet = `fs-${randomUUID()}`;
  const entry = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: null, currency: null, source: "test" }, actor);
  createdCatalogIds.add(entry.id);

  const outcome = await resolvePrice("provider_x", "search", fieldSet);
  assert.equal(outcome.status, "unknown");
});

test("resolvePrice: known when a real price is set, exposes the exact catalog values", async () => {
  const actor = await makeActorUserId();
  const fieldSet = `fs-${randomUUID()}`;
  const entry = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: 0.032, currency: "USD", source: "test" }, actor);
  createdCatalogIds.add(entry.id);

  const outcome = await resolvePrice("provider_x", "search", fieldSet);
  assert.equal(outcome.status, "known");
  assert.equal(outcome.price.price, 0.032);
  assert.equal(outcome.price.currency, "USD");
  assert.equal(outcome.price.catalogEntryId, entry.id);
});

test("resolvePrice: a DISABLED entry is treated as unknown", async () => {
  const actor = await makeActorUserId();
  const fieldSet = `fs-${randomUUID()}`;
  const entry = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: 1, currency: "USD", source: "test" }, actor);
  createdCatalogIds.add(entry.id);
  await db.update(discoveryPriceCatalog).set({ enabled: false }).where(eq(discoveryPriceCatalog.id, entry.id));

  const outcome = await resolvePrice("provider_x", "search", fieldSet);
  assert.equal(outcome.status, "unknown");
});

test("resolvePrice: an entry effective only in the future is unknown NOW", async () => {
  const actor = await makeActorUserId();
  const fieldSet = `fs-${randomUUID()}`;
  const entry = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: 1, currency: "USD", source: "test" }, actor);
  createdCatalogIds.add(entry.id);
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await db.update(discoveryPriceCatalog).set({ effectiveFrom: future }).where(eq(discoveryPriceCatalog.id, entry.id));

  const outcome = await resolvePrice("provider_x", "search", fieldSet);
  assert.equal(outcome.status, "unknown");
});

test("resolvePrice: an entry whose effectiveTo has already passed is unknown", async () => {
  const actor = await makeActorUserId();
  const fieldSet = `fs-${randomUUID()}`;
  const entry = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: 1, currency: "USD", source: "test" }, actor);
  createdCatalogIds.add(entry.id);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.update(discoveryPriceCatalog).set({ effectiveTo: past }).where(eq(discoveryPriceCatalog.id, entry.id));

  const outcome = await resolvePrice("provider_x", "search", fieldSet);
  assert.equal(outcome.status, "unknown");
});

test("upsertPriceCatalogEntry: versioning -- a second call closes the first entry's effectiveTo and increments version, never mutates the first row's price", async () => {
  const actor = await makeActorUserId();
  const fieldSet = `fs-${randomUUID()}`;
  const first = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: 1, currency: "USD", source: "test" }, actor);
  createdCatalogIds.add(first.id);
  assert.equal(first.version, 1);

  const second = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: 2, currency: "USD", source: "test" }, actor);
  createdCatalogIds.add(second.id);
  assert.equal(second.version, 2);

  const [firstRow] = await db.select().from(discoveryPriceCatalog).where(eq(discoveryPriceCatalog.id, first.id)).limit(1);
  assert.equal(firstRow.price, 1, "the OLD entry's price must never be mutated -- versioning creates a new row");
  assert.notEqual(firstRow.effectiveTo, null, "the old entry must be closed out (effectiveTo set)");

  const outcome = await resolvePrice("provider_x", "search", fieldSet);
  assert.equal(outcome.status, "known");
  assert.equal(outcome.price.price, 2, "resolvePrice must return the NEWEST effective entry");
});

test("upsertPriceCatalogEntry: never fabricates a price -- price: null is stored verbatim, never coerced to 0", async () => {
  const actor = await makeActorUserId();
  const fieldSet = `fs-${randomUUID()}`;
  const entry = await upsertPriceCatalogEntry({ provider: "provider_x", sku: "sku_x", operation: "search", fieldSet, unit: "per_request", price: null, currency: null, source: "test" }, actor);
  createdCatalogIds.add(entry.id);

  const [row] = await db.select().from(discoveryPriceCatalog).where(eq(discoveryPriceCatalog.id, entry.id)).limit(1);
  assert.equal(row.price, null);
});
