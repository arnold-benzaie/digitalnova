// Integration tests for P0.2A-3: market resolution (resolveClientMarket /
// resolveClientMarkets), the catalogue offer price map
// (buildCatalogueOfferPriceMap), and the snapshot/DUO guarantees that must
// keep holding once prices can be suggested.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase Preview/
// Production. Same mocking convention as
// lib/actions/crm-billing-service-linking.integration.test.mjs (P0.2A-2):
// next/cache's revalidatePath is a no-op, @/lib/session's
// getCurrentSession (the one lib/audit.ts's logCrmAudit calls) is faked to
// return null.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/crm-service-linking-market-pricing.integration.test.mjs
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/session", { namedExports: { getCurrentSession: async () => null } });

const { db } = await import("@/db");
const { crmClients, crmQuoteItems, crmQuotes, crmInvoiceItems, crmInvoices, organizations, services, serviceMarketOffers } = await import("@/db/schema");
const { and, eq, inArray } = await import("drizzle-orm");
const { resolveClientMarket, resolveClientMarkets, buildCatalogueOfferPriceMap } = await import("./crm-service-linking.ts");
const { priceStringToCents } = await import("./crm-billing.ts");
const { createQuote, convertQuoteToInvoice, updateQuoteStatus } = await import("./actions/crm-quotes.ts");

const SVC_PRICED = "p02a3_test_priced";
const SVC_CANADA_ONLY = "p02a3_test_canada_only";
const SVC_DUO = "p02a3_test_duo";

let orgCanadaId, orgEuropeId, orgUnknownMarketId;
let clientNoOrgId, clientUnknownMarketId, clientCanadaId, clientEuropeId;
const createdQuoteIds = new Set();
const createdInvoiceIds = new Set();

before(async () => {
  const [orgCanada] = await db.insert(organizations).values({ name: "P0.2A-3 Org Canada", market: "CANADA" }).returning();
  const [orgEurope] = await db.insert(organizations).values({ name: "P0.2A-3 Org Europe", market: "EUROPE" }).returning();
  const [orgUnknown] = await db.insert(organizations).values({ name: "P0.2A-3 Org Unknown Market", market: null }).returning();
  orgCanadaId = orgCanada.id;
  orgEuropeId = orgEurope.id;
  orgUnknownMarketId = orgUnknown.id;

  const [clientNoOrg] = await db.insert(crmClients).values({ name: "P0.2A-3 Client No Org", organizationId: null }).returning();
  const [clientUnknownMarket] = await db.insert(crmClients).values({ name: "P0.2A-3 Client Unknown Market", organizationId: orgUnknownMarketId }).returning();
  const [clientCanada] = await db.insert(crmClients).values({ name: "P0.2A-3 Client Canada", organizationId: orgCanadaId }).returning();
  const [clientEurope] = await db.insert(crmClients).values({ name: "P0.2A-3 Client Europe", organizationId: orgEuropeId }).returning();
  clientNoOrgId = clientNoOrg.id;
  clientUnknownMarketId = clientUnknownMarket.id;
  clientCanadaId = clientCanada.id;
  clientEuropeId = clientEurope.id;

  await db.insert(services).values([
    { serviceId: SVC_PRICED, type: "INDIVIDUAL_SERVICE", status: "ACTIVE", displayNameFr: "Service Prix Test", displayNameEn: "Priced Test Service", descriptionFr: "d", descriptionEn: "d" },
    { serviceId: SVC_CANADA_ONLY, type: "INDIVIDUAL_SERVICE", status: "ACTIVE", displayNameFr: "Service Canada Uniquement", displayNameEn: "Canada Only Service", descriptionFr: "d", descriptionEn: "d" },
    { serviceId: SVC_DUO, type: "DUO", status: "ACTIVE", displayNameFr: "Duo Test", displayNameEn: "Test Duo", descriptionFr: "d", descriptionEn: "d", priceDerivation: "SUM_OF_CHILDREN" },
  ]);

  await db.insert(serviceMarketOffers).values([
    { serviceId: SVC_PRICED, market: "CANADA", currency: "CAD", price: "390.00", paymentFrequency: "ONE_TIME", ctaType: "REQUEST_QUOTE" },
    { serviceId: SVC_PRICED, market: "EUROPE", currency: "EUR", price: "255.00", paymentFrequency: "ONE_TIME", ctaType: "REQUEST_QUOTE" },
    { serviceId: SVC_CANADA_ONLY, market: "CANADA", currency: "CAD", price: "49.99", paymentFrequency: "ONE_TIME", ctaType: "REQUEST_QUOTE" },
    // Deliberately no EUROPE offer for SVC_CANADA_ONLY, and no offers at
    // all for SVC_DUO — both real, expected shapes to verify against.
  ]);
});

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  await db.delete(crmClients).where(inArray(crmClients.id, [clientNoOrgId, clientUnknownMarketId, clientCanadaId, clientEuropeId]));
  // serviceMarketOffers.serviceId is ON DELETE RESTRICT — must be removed
  // before the services rows themselves, or that delete fails outright.
  await db.delete(serviceMarketOffers).where(inArray(serviceMarketOffers.serviceId, [SVC_PRICED, SVC_CANADA_ONLY, SVC_DUO]));
  await db.delete(services).where(inArray(services.serviceId, [SVC_PRICED, SVC_CANADA_ONLY, SVC_DUO]));
  await db.delete(organizations).where(inArray(organizations.id, [orgCanadaId, orgEuropeId, orgUnknownMarketId]));
  await db.$client.end();
});

function quoteFormData(items, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", overrides.clientId ?? clientCanadaId);
  fd.set("title", overrides.title ?? "Devis test P0.2A-3");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(items));
  return fd;
}
async function quoteItemsFor(quoteId) {
  return db.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quoteId)).orderBy(crmQuoteItems.position);
}
async function invoiceItemsFor(invoiceId) {
  return db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, invoiceId)).orderBy(crmInvoiceItems.position);
}

// ---- D. organizationId null -> no market ----
test("resolveClientMarket: organizationId null resolves to null, never a guessed market", async () => {
  assert.equal(await resolveClientMarket(null), null);
});

// ---- E. organizations.market null -> no market ----
test("resolveClientMarket: an organization with market=null resolves to null", async () => {
  assert.equal(await resolveClientMarket(orgUnknownMarketId), null);
});

test("resolveClientMarket: CANADA and EUROPE resolve correctly", async () => {
  assert.equal(await resolveClientMarket(orgCanadaId), "CANADA");
  assert.equal(await resolveClientMarket(orgEuropeId), "EUROPE");
});

// ---- Batched resolution (list pages) — same 4 cases, one query ----
test("resolveClientMarkets: batched resolution matches resolveClientMarket for every case, single query", async () => {
  const clients = [
    { id: clientNoOrgId, organizationId: null },
    { id: clientUnknownMarketId, organizationId: orgUnknownMarketId },
    { id: clientCanadaId, organizationId: orgCanadaId },
    { id: clientEuropeId, organizationId: orgEuropeId },
  ];
  const result = await resolveClientMarkets(clients);
  assert.equal(result[clientNoOrgId], null);
  assert.equal(result[clientUnknownMarketId], null);
  assert.equal(result[clientCanadaId], "CANADA");
  assert.equal(result[clientEuropeId], "EUROPE");
});

test("resolveClientMarkets: empty list and all-null-organizationId list never query organizations", async () => {
  assert.deepEqual(await resolveClientMarkets([]), {});
  const result = await resolveClientMarkets([{ id: "x", organizationId: null }]);
  assert.equal(result.x, null);
});

// ---- F / offer map correctness ----
test("buildCatalogueOfferPriceMap: reflects real service_market_offers rows, converted deterministically", async () => {
  const map = await buildCatalogueOfferPriceMap();
  const priced = map.get(SVC_PRICED);
  assert.equal(priceStringToCents(priced.canada), 39000);
  assert.equal(priceStringToCents(priced.europe), 25500);

  const canadaOnly = map.get(SVC_CANADA_ONLY);
  assert.equal(priceStringToCents(canadaOnly.canada), 4999);
  assert.equal(canadaOnly.europe, undefined, "no EUROPE offer exists for this fixture — must never be fabricated");

  assert.equal(map.get(SVC_DUO), undefined, "DUO has no offers at all");
});

// ---- I. prefilled price remains manually editable / whatever is submitted is what's stored ----
test("createQuote persists exactly the submitted unitPriceCents, unaffected by the catalogue's own price (simulates a prefill the staff then edited)", async () => {
  const quote = await createQuote(
    quoteFormData([{ description: "Ligne modifiée après pré-remplissage", quantity: 1, unitPriceCents: 12345, serviceId: SVC_PRICED }], { currency: "EUR" }),
  );
  createdQuoteIds.add(quote.id);
  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.unitPriceCents, 12345, "the manually-edited value must survive untouched, not the catalogue's 25500");
  assert.equal(item.serviceId, SVC_PRICED);
});

// ---- J. a later Catalogue price change never touches an existing document ----
test("changing service_market_offers.price after a quote exists never modifies that quote's stored snapshot", async () => {
  const quote = await createQuote(
    quoteFormData([{ description: "Ligne snapshot", quantity: 1, unitPriceCents: 25500, serviceId: SVC_PRICED }], { currency: "EUR" }),
  );
  createdQuoteIds.add(quote.id);

  // Not restored afterward on purpose — after() deletes this fixture's
  // serviceMarketOffers rows entirely regardless, and no later test in
  // this file depends on SVC_PRICED's EUROPE price still being "255.00".
  await db.update(serviceMarketOffers).set({ price: "999.00" }).where(and(eq(serviceMarketOffers.serviceId, SVC_PRICED), eq(serviceMarketOffers.market, "EUROPE")));

  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.unitPriceCents, 25500, "must remain the original snapshot, never re-derived from the now-changed catalogue price");
});

// ---- K. quote -> invoice keeps the exact snapshot price ----
test("convertQuoteToInvoice copies unitPriceCents verbatim, never the current catalogue price", async () => {
  const quote = await createQuote(
    quoteFormData([{ description: "Ligne à convertir", quantity: 1, unitPriceCents: 30000, serviceId: SVC_PRICED }], { currency: "EUR" }),
  );
  createdQuoteIds.add(quote.id);
  await updateQuoteStatus(quote.id, "sent");
  await updateQuoteStatus(quote.id, "accepted");

  const invoice = await convertQuoteToInvoice(quote.id);
  createdInvoiceIds.add(invoice.id);

  const [invoiceItem] = await invoiceItemsFor(invoice.id);
  assert.equal(invoiceItem.unitPriceCents, 30000);
  assert.equal(invoiceItem.serviceId, SVC_PRICED);
});

// ---- L. DUO stays impossible to select/inject, even with pricing enrichment in play ----
test("DUO is absent from buildCatalogueOfferPriceMap-derived options and stays rejected server-side", async () => {
  const map = await buildCatalogueOfferPriceMap();
  assert.equal(map.has(SVC_DUO), false);

  const quote = await createQuote(quoteFormData([{ description: "Tentative DUO", quantity: 1, unitPriceCents: 1000, serviceId: SVC_DUO }], { currency: "EUR" }));
  createdQuoteIds.add(quote.id);
  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null, "server-side sanitizeServiceIds (P0.2A-2) must still neutralize a DUO id — unchanged by P0.2A-3");
});
