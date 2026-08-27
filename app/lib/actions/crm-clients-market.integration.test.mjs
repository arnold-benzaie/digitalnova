// Integration tests for P0.2A-4: updateClientMarket
// (lib/actions/crm-clients.ts) — setting/clearing a CRM client's
// commercial market, and confirming P0.2A-3's resolveClientMarket/
// resolveClientMarkets pick up the written value correctly, without ever
// touching an existing quote/invoice's snapshot.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase Preview/
// Production. Same mocking convention as P0.2A-2/P0.2A-3's own test
// files: next/cache's revalidatePath is a no-op, @/lib/session's
// getCurrentSession (the one lib/audit.ts's logCrmAudit calls) is faked
// to return null.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-clients-market.integration.test.mjs
import { test, mock, after } from "node:test";
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
const { crmClients, crmQuoteItems, crmQuotes, organizations } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { updateClientMarket } = await import("./crm-clients.ts");
const { createQuote } = await import("./crm-quotes.ts");
const { resolveClientMarket, resolveClientMarkets } = await import("../crm-service-linking.ts");

const createdClientIds = new Set();
const createdOrgIds = new Set();
const createdQuoteIds = new Set();

async function makeClient(name, organizationId = null) {
  const [client] = await db.insert(crmClients).values({ name, organizationId }).returning();
  createdClientIds.add(client.id);
  return client;
}

async function currentOrgId(clientId) {
  const [row] = await db.select({ organizationId: crmClients.organizationId }).from(crmClients).where(eq(crmClients.id, clientId)).limit(1);
  return row?.organizationId ?? null;
}
async function marketOf(organizationId) {
  const [row] = await db.select({ market: organizations.market }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return row?.market ?? null;
}

after(async () => {
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdOrgIds.size) await db.delete(organizations).where(inArray(organizations.id, [...createdOrgIds]));
  await db.$client.end();
});

// ---- A. no organizationId + CANADA -> organization created/linked, market CANADA ----
test("updateClientMarket: client with no organizationId + CANADA creates and links an organization, sets market", async () => {
  const client = await makeClient("P0.2A-4 Client A");
  assert.equal(await currentOrgId(client.id), null);

  await updateClientMarket(client.id, "CANADA");

  const orgId = await currentOrgId(client.id);
  assert.notEqual(orgId, null, "an organization must now be linked");
  createdOrgIds.add(orgId);
  assert.equal(await marketOf(orgId), "CANADA");
});

// ---- B. no organizationId + EUROPE -> same for EUROPE ----
test("updateClientMarket: client with no organizationId + EUROPE creates and links an organization, sets market", async () => {
  const client = await makeClient("P0.2A-4 Client B");

  await updateClientMarket(client.id, "EUROPE");

  const orgId = await currentOrgId(client.id);
  assert.notEqual(orgId, null);
  createdOrgIds.add(orgId);
  assert.equal(await marketOf(orgId), "EUROPE");
});

// ---- C. client with an existing organization -> market updated correctly ----
test("updateClientMarket: client with an existing organization gets its market updated, no new organization created", async () => {
  const [org] = await db.insert(organizations).values({ name: "P0.2A-4 Org C" }).returning();
  createdOrgIds.add(org.id);
  const client = await makeClient("P0.2A-4 Client C", org.id);

  await updateClientMarket(client.id, "CANADA");

  assert.equal(await currentOrgId(client.id), org.id, "must reuse the same organization, never create a second one");
  assert.equal(await marketOf(org.id), "CANADA");
});

// ---- D/E. CANADA <-> EUROPE change ----
test("updateClientMarket: CANADA -> EUROPE changes correctly", async () => {
  const client = await makeClient("P0.2A-4 Client D");
  await updateClientMarket(client.id, "CANADA");
  const orgId = await currentOrgId(client.id);
  createdOrgIds.add(orgId);
  assert.equal(await marketOf(orgId), "CANADA");

  await updateClientMarket(client.id, "EUROPE");
  assert.equal(await marketOf(orgId), "EUROPE");
  assert.equal(await currentOrgId(client.id), orgId, "same organization throughout — never recreated on a change");
});

test("updateClientMarket: EUROPE -> CANADA changes correctly", async () => {
  const client = await makeClient("P0.2A-4 Client E");
  await updateClientMarket(client.id, "EUROPE");
  const orgId = await currentOrgId(client.id);
  createdOrgIds.add(orgId);
  assert.equal(await marketOf(orgId), "EUROPE");

  await updateClientMarket(client.id, "CANADA");
  assert.equal(await marketOf(orgId), "CANADA");
});

// ---- F. explicit null clears the market ----
test("updateClientMarket: explicit empty-string ('Non défini') clears an existing market to null", async () => {
  const client = await makeClient("P0.2A-4 Client F");
  await updateClientMarket(client.id, "CANADA");
  const orgId = await currentOrgId(client.id);
  createdOrgIds.add(orgId);
  assert.equal(await marketOf(orgId), "CANADA");

  await updateClientMarket(client.id, "");
  assert.equal(await marketOf(orgId), null);
  assert.equal(await currentOrgId(client.id), orgId, "the organization link itself is untouched by clearing the market");
});

test("updateClientMarket: explicit '' on a client with no organization yet is a safe no-op (never creates one just to hold null)", async () => {
  const client = await makeClient("P0.2A-4 Client F2");
  await updateClientMarket(client.id, "");
  assert.equal(await currentOrgId(client.id), null, "no organization should have been created for a no-op clear");
});

// ---- G. invalid value rejected, zero DB mutation ----
test("updateClientMarket: an invalid value is rejected and mutates nothing", async () => {
  const client = await makeClient("P0.2A-4 Client G");
  for (const bad of ["canada", "FRANCE", "CANADA ", " EUROPE", "null", "undefined", "0"]) {
    await assert.rejects(() => updateClientMarket(client.id, bad));
  }
  assert.equal(await currentOrgId(client.id), null, "rejection must never create/link an organization as a side effect");
});

// ---- H/I. resolveClientMarket / resolveClientMarkets reflect the write ----
test("resolveClientMarket reflects updateClientMarket's write immediately", async () => {
  const client = await makeClient("P0.2A-4 Client H");
  await updateClientMarket(client.id, "EUROPE");
  const orgId = await currentOrgId(client.id);
  createdOrgIds.add(orgId);

  assert.equal(await resolveClientMarket(orgId), "EUROPE");
});

test("resolveClientMarkets reflects updateClientMarket's write immediately, for a batch of clients", async () => {
  const clientCanada = await makeClient("P0.2A-4 Client I1");
  const clientEurope = await makeClient("P0.2A-4 Client I2");
  const clientUnset = await makeClient("P0.2A-4 Client I3");

  await updateClientMarket(clientCanada.id, "CANADA");
  await updateClientMarket(clientEurope.id, "EUROPE");

  const orgCanadaId = await currentOrgId(clientCanada.id);
  const orgEuropeId = await currentOrgId(clientEurope.id);
  createdOrgIds.add(orgCanadaId);
  createdOrgIds.add(orgEuropeId);

  const rows = [
    { id: clientCanada.id, organizationId: orgCanadaId },
    { id: clientEurope.id, organizationId: orgEuropeId },
    { id: clientUnset.id, organizationId: null },
  ];
  const result = await resolveClientMarkets(rows);
  assert.equal(result[clientCanada.id], "CANADA");
  assert.equal(result[clientEurope.id], "EUROPE");
  assert.equal(result[clientUnset.id], null);
});

// ---- J. changing the market never modifies an existing quote's snapshot ----
test("changing a client's market after a quote already exists never touches that quote's stored serviceId/description/price/currency", async () => {
  const client = await makeClient("P0.2A-4 Client J");
  await updateClientMarket(client.id, "CANADA");

  const fd = new FormData();
  fd.set("clientId", client.id);
  fd.set("title", "Devis test P0.2A-4");
  fd.set("currency", "CAD");
  fd.set("items", JSON.stringify([{ description: "Ligne test", quantity: 1, unitPriceCents: 12345 }]));
  const quote = await createQuote(fd);
  createdQuoteIds.add(quote.id);

  const before_ = await db.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quote.id));
  const [beforeQuote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, quote.id));

  await updateClientMarket(client.id, "EUROPE");

  const after_ = await db.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quote.id));
  const [afterQuote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, quote.id));

  assert.deepEqual(after_, before_, "quote line items must be byte-for-byte identical after a market change");
  assert.equal(afterQuote.currency, beforeQuote.currency, "the document's own currency is never touched by a market change");
  assert.equal(afterQuote.totalCents, beforeQuote.totalCents);
});
