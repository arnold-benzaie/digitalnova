// Integration tests for P0.2A-2: linking crm_quote_items/crm_invoice_items
// to the canonical Catalogue via serviceId (lib/crm-billing.ts's
// parseLineItems, lib/crm-service-linking.ts's sanitizeServiceIds,
// lib/actions/crm-quotes.ts, lib/actions/crm-invoices.ts).
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase Preview/
// Production. Same mocking convention as
// lib/developer-console/actions.integration.test.mjs: next/cache's
// revalidatePath is a no-op (no real request), and @/lib/session's
// getCurrentSession (the one lib/audit.ts's logCrmAudit actually calls) is
// faked to return null — everything else (the actions under test, the real
// Drizzle queries/transactions) runs unmodified against the real local
// database. getLocale() needs no mock: it already catches
// cookies()/headers() throwing outside a request and falls back to "fr"
// (see lib/i18n/locale.ts).
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-billing-service-linking.integration.test.mjs
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
const { crmClients, crmQuoteItems, crmQuotes, crmInvoiceItems, crmInvoices, services } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createQuote, updateQuote, convertQuoteToInvoice } = await import("./crm-quotes.ts");
const { updateQuoteStatus } = await import("./crm-quotes.ts");
const { createInvoice, updateInvoice } = await import("./crm-invoices.ts");

const SVC_VALID = "p02a2_test_individual";
const SVC_VALID_2 = "p02a2_test_pack";
const SVC_DUO = "p02a2_test_duo";
const SVC_INACTIVE = "p02a2_test_legacy";
const SVC_DOES_NOT_EXIST = "p02a2_test_does_not_exist";

let fixtureClientId;
const createdQuoteIds = new Set();
const createdInvoiceIds = new Set();

before(async () => {
  const [client] = await db.insert(crmClients).values({ name: "P0.2A-2 Test Client" }).returning();
  fixtureClientId = client.id;

  await db.insert(services).values([
    {
      serviceId: SVC_VALID,
      type: "INDIVIDUAL_SERVICE",
      status: "ACTIVE",
      displayNameFr: "Service Individuel Test",
      displayNameEn: "Test Individual Service",
      descriptionFr: "desc fr",
      descriptionEn: "desc en",
      priceDerivation: "NOT_APPLICABLE",
    },
    {
      serviceId: SVC_VALID_2,
      type: "PACK",
      status: "ACTIVE",
      displayNameFr: "Pack Test",
      displayNameEn: "Test Pack",
      descriptionFr: "desc fr",
      descriptionEn: "desc en",
      priceDerivation: "INDEPENDENT",
    },
    {
      serviceId: SVC_DUO,
      type: "DUO",
      status: "ACTIVE",
      displayNameFr: "Duo Test",
      displayNameEn: "Test Duo",
      descriptionFr: "desc fr",
      descriptionEn: "desc en",
      priceDerivation: "SUM_OF_CHILDREN",
    },
    {
      serviceId: SVC_INACTIVE,
      type: "INDIVIDUAL_SERVICE",
      status: "LEGACY",
      displayNameFr: "Service Legacy Test",
      displayNameEn: "Test Legacy Service",
      descriptionFr: "desc fr",
      descriptionEn: "desc en",
      priceDerivation: "NOT_APPLICABLE",
    },
  ]);
});

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  if (fixtureClientId) await db.delete(crmClients).where(eq(crmClients.id, fixtureClientId));
  await db.delete(services).where(inArray(services.serviceId, [SVC_VALID, SVC_VALID_2, SVC_DUO, SVC_INACTIVE]));
  await db.$client.end();
});

function quoteFormData(items, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", fixtureClientId);
  fd.set("title", overrides.title ?? "Devis test P0.2A-2");
  fd.set("currency", "EUR");
  fd.set("items", JSON.stringify(items));
  return fd;
}

function invoiceFormData(items, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", fixtureClientId);
  fd.set("title", overrides.title ?? "Facture test P0.2A-2");
  fd.set("currency", "EUR");
  fd.set("locale", "fr");
  fd.set("items", JSON.stringify(items));
  return fd;
}

async function quoteItemsFor(quoteId) {
  return db.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quoteId)).orderBy(crmQuoteItems.position);
}
async function invoiceItemsFor(invoiceId) {
  return db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, invoiceId)).orderBy(crmInvoiceItems.position);
}

// ---- A. création d'un devis avec serviceId valide ----
test("createQuote persists a valid serviceId", async () => {
  const quote = await createQuote(quoteFormData([{ description: "Ligne liée", quantity: 1, unitPriceCents: 10000, serviceId: SVC_VALID }]));
  createdQuoteIds.add(quote.id);

  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, SVC_VALID);
});

// ---- B. création d'une ligne libre avec serviceId null ----
test("createQuote persists a free-text line with serviceId null, unchanged from today's behavior", async () => {
  const quote = await createQuote(quoteFormData([{ description: "Ligne libre", quantity: 1, unitPriceCents: 5000 }]));
  createdQuoteIds.add(quote.id);

  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null);
  assert.equal(item.description, "Ligne libre");
  assert.equal(item.unitPriceCents, 5000);
});

// ---- C. rejet/neutralisation sûre d'un serviceId inexistant (+ règle 7 : DUO jamais sélectionnable) ----
test("createQuote neutralizes an unknown serviceId to null instead of failing or storing it", async () => {
  const quote = await createQuote(
    quoteFormData([{ description: "Ligne suspecte", quantity: 1, unitPriceCents: 2500, serviceId: SVC_DOES_NOT_EXIST }]),
  );
  createdQuoteIds.add(quote.id);

  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null, "an id with no matching services row must never be stored");
  assert.equal(item.description, "Ligne suspecte", "the line's own text/price must survive neutralization unchanged");
});

test("createQuote neutralizes a DUO serviceId (rule 7 — DUOs are never selectable, no SUM_OF_CHILDREN pricing exists)", async () => {
  const quote = await createQuote(quoteFormData([{ description: "Ligne duo", quantity: 1, unitPriceCents: 2500, serviceId: SVC_DUO }]));
  createdQuoteIds.add(quote.id);

  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null);
});

test("createQuote neutralizes an inactive (non-ACTIVE) serviceId", async () => {
  const quote = await createQuote(quoteFormData([{ description: "Ligne inactive", quantity: 1, unitPriceCents: 2500, serviceId: SVC_INACTIVE }]));
  createdQuoteIds.add(quote.id);

  const [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null);
});

// ---- D. updateQuote conservant/modifiant serviceId correctement ----
test("updateQuote preserves, changes, and clears serviceId across successive edits", async () => {
  const quote = await createQuote(quoteFormData([{ description: "Ligne v1", quantity: 1, unitPriceCents: 1000, serviceId: SVC_VALID }]));
  createdQuoteIds.add(quote.id);

  // Preserve the same serviceId across an edit that only touches the price.
  await updateQuote(quote.id, quoteFormData([{ description: "Ligne v1", quantity: 1, unitPriceCents: 1500, serviceId: SVC_VALID }]));
  let [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, SVC_VALID);
  assert.equal(item.unitPriceCents, 1500);

  // Change to a different valid service.
  await updateQuote(quote.id, quoteFormData([{ description: "Ligne v2", quantity: 1, unitPriceCents: 1500, serviceId: SVC_VALID_2 }]));
  [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, SVC_VALID_2);

  // Clear back to a free-text line.
  await updateQuote(quote.id, quoteFormData([{ description: "Ligne libre à nouveau", quantity: 1, unitPriceCents: 1500 }]));
  [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null);
});

// ---- E. convertQuoteToInvoice recopiant serviceId ----
test("convertQuoteToInvoice copies serviceId verbatim for both linked and free-text lines", async () => {
  const quote = await createQuote(
    quoteFormData([
      { description: "Ligne liée", quantity: 2, unitPriceCents: 20000, serviceId: SVC_VALID },
      { description: "Ligne libre", quantity: 1, unitPriceCents: 3000 },
    ]),
  );
  createdQuoteIds.add(quote.id);
  await updateQuoteStatus(quote.id, "sent");
  await updateQuoteStatus(quote.id, "accepted");

  const invoice = await convertQuoteToInvoice(quote.id);
  createdInvoiceIds.add(invoice.id);

  const quoteLines = await quoteItemsFor(quote.id);
  const invoiceLines = await invoiceItemsFor(invoice.id);
  assert.equal(invoiceLines.length, quoteLines.length);
  const byDescription = Object.fromEntries(invoiceLines.map((l) => [l.description, l]));
  assert.equal(byDescription["Ligne liée"].serviceId, SVC_VALID);
  assert.equal(byDescription["Ligne libre"].serviceId, null);
});

// ---- F. création directe d'une facture avec serviceId ----
test("createInvoice (direct, not via conversion) persists a valid serviceId", async () => {
  const invoice = await createInvoice(invoiceFormData([{ description: "Ligne facture directe", quantity: 1, unitPriceCents: 8000, serviceId: SVC_VALID }]));
  createdInvoiceIds.add(invoice.id);

  const [item] = await invoiceItemsFor(invoice.id);
  assert.equal(item.serviceId, SVC_VALID);
});

// ---- G. updateInvoice avec serviceId ----
test("updateInvoice persists a changed serviceId on a draft invoice", async () => {
  const invoice = await createInvoice(invoiceFormData([{ description: "Ligne v1", quantity: 1, unitPriceCents: 4000, serviceId: SVC_VALID }]));
  createdInvoiceIds.add(invoice.id);

  await updateInvoice(invoice.id, invoiceFormData([{ description: "Ligne v2", quantity: 1, unitPriceCents: 4000, serviceId: SVC_VALID_2 }]));
  const [item] = await invoiceItemsFor(invoice.id);
  assert.equal(item.serviceId, SVC_VALID_2);
});

// ---- H. absence de recalcul du snapshot prix/description depuis le Catalogue ----
test("linking a service never overwrites the manually-entered price/description, at creation or at conversion time", async () => {
  const customDescription = "Prestation sur mesure — prix négocié";
  const customPriceCents = 987654;
  const quote = await createQuote(
    quoteFormData([{ description: customDescription, quantity: 1, unitPriceCents: customPriceCents, serviceId: SVC_VALID }]),
  );
  createdQuoteIds.add(quote.id);

  let [item] = await quoteItemsFor(quote.id);
  assert.equal(item.description, customDescription);
  assert.equal(item.unitPriceCents, customPriceCents);

  // Even if the catalogue's own display name changes after the quote line
  // was created, the already-persisted line must not be affected, and
  // converting it to an invoice must still copy the ORIGINAL snapshot, not
  // anything re-derived from the (now different) catalogue row.
  await db.update(services).set({ displayNameFr: "Nom catalogue modifié après coup" }).where(eq(services.serviceId, SVC_VALID));

  await updateQuoteStatus(quote.id, "sent");
  await updateQuoteStatus(quote.id, "accepted");
  const invoice = await convertQuoteToInvoice(quote.id);
  createdInvoiceIds.add(invoice.id);

  const [invoiceItem] = await invoiceItemsFor(invoice.id);
  assert.equal(invoiceItem.description, customDescription);
  assert.equal(invoiceItem.unitPriceCents, customPriceCents);
  assert.equal(invoiceItem.serviceId, SVC_VALID);

  // Restore the catalogue row so it doesn't leak a mutation into other tests.
  await db.update(services).set({ displayNameFr: "Service Individuel Test" }).where(eq(services.serviceId, SVC_VALID));
});

// ---- I. compatibilité d'une ancienne ligne serviceId null ----
test("a historical row inserted with serviceId never set (pre-P0.2A-2 shape) survives reads and a normal updateQuote edit", async () => {
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId: fixtureClientId, quoteNumber: "P02A2-HIST-0001", title: "Devis historique", currency: "EUR" })
    .returning();
  createdQuoteIds.add(quote.id);
  // Deliberately omits serviceId entirely, exactly like every row created
  // before migration 0030 existed.
  await db.insert(crmQuoteItems).values({ quoteId: quote.id, description: "Ligne historique", quantity: 1, unitPriceCents: 6000, position: 0 });

  let [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null);

  // A normal edit through the real action must succeed unchanged.
  await updateQuote(quote.id, quoteFormData([{ description: "Ligne historique modifiée", quantity: 1, unitPriceCents: 6500 }]));
  [item] = await quoteItemsFor(quote.id);
  assert.equal(item.serviceId, null);
  assert.equal(item.description, "Ligne historique modifiée");
});
