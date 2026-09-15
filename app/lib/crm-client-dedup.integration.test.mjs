// PHASE A — CENTRALIZED CRM DEDUPLICATION — real-database integration
// proof.
//
// Unit tests (crm-client-dedup.test.mjs) already exercise the entire
// decision matrix against a FAKE @/db. This file instead proves:
//  1. findCrmClientMatch's real SQL (lower(email)=X, phone E.164 equality,
//     name+city+region) against a REAL Postgres — including the mission's
//     own mandatory non-fusion example ("ABC Services", Montreal vs
//     Quebec City) and a genuine pre-existing-duplicate-email scenario.
//  2. lib/actions/crm-invoices.ts::resolveInvoiceClient() (via the public
//     createInvoice() action) — the PRIORITY fix: a name-only match no
//     longer silently merges; an unambiguous email/phone match still
//     reuses exactly as before.
//  3. lib/chat/leads.ts::captureLead() — the ONE new behavior this phase
//     adds: when historical duplicate email rows already exist, a new
//     row is created instead of an arbitrary pick (chat.integration.test.mjs
//     already covers the ordinary single-match-reuse path, unchanged and
//     still green after this phase's edits).
//  4. lib/actions/crm-clients.ts::createClient() and
//     lib/actions/crm-tickets.ts::createTicket() — confirm the dedup
//     integration is FLAG-ONLY: a detected duplicate never blocks
//     creation on these two paths (see their own code comments for why).
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/crm-client-dedup.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {}, namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const STAFF_SESSION = {
  userId: "dedup-test-staff",
  clerkUserId: "test_clerk_staff_dedup",
  email: "staff-dedup@example.com",
  fullName: "Test Staff",
  firstName: "Test",
  organizationId: "test-org",
  organizationName: "Test Org",
  role: "staff",
  previousLastLoginAt: null,
};
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => STAFF_SESSION,
    // logCrmAudit() resolves its actorUserId via getCurrentSession() and
    // inserts it into a uuid-typed column — STAFF_SESSION.userId here is
    // a readable test label, not a real uuid, so (same convention as
    // crm-invoices-auth.integration.test.mjs) getCurrentSession() itself
    // returns null, which logCrmAudit treats as "no actor" (NULL),
    // exactly like every other integration test file in this repo that
    // doesn't specifically test audit-actor attribution.
    getCurrentSession: async () => null,
  },
});

mock.module("@/lib/email/resend", {
  namedExports: {
    sendEmail: async () => {
      throw new Error("no test in this file should ever trigger a real email send");
    },
  },
});

const { db } = await import("@/db");
const { crmClients, crmInvoices, crmInvoiceItems, tickets } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { findCrmClientMatch } = await import("./crm-client-dedup.ts");
const { createInvoice } = await import("./actions/crm-invoices.ts");
const { captureLead } = await import("./chat/leads.ts");
const { createClient } = await import("./actions/crm-clients.ts");
const { createTicket } = await import("./actions/crm-tickets.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();
const createdTicketIds = new Set();

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdTicketIds.size) await db.delete(tickets).where(inArray(tickets.id, [...createdTicketIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const [client] = await db
    .insert(crmClients)
    .values({ name: `Dedup Test ${randomUUID()}`, stage: "lead", ...overrides })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

function uniqueEmail() {
  return `dedup-${randomUUID()}@example.test`;
}

let phoneCounter = 0;
function uniquePhone() {
  // Fixed area code + exchange (514 555, Montreal) already proven VALID
  // per this exact libphonenumber-js build/metadata by
  // crm-client-dedup.test.mjs's own normalizeCrmPhoneToE164 unit test —
  // only the last 4 digits vary, so every call is both unique and
  // guaranteed to parse as a valid E.164 number (an arbitrary random
  // 10-digit string is NOT guaranteed valid under real NANP area-code/
  // exchange-code rules, which made this flaky before).
  phoneCounter += 1;
  return `+1514555${String(phoneCounter).padStart(4, "0")}`;
}

// ---- 1. findCrmClientMatch against real Postgres ----

test("real DB: email exact match, single candidate -> EXACT_MATCH", async () => {
  const email = uniqueEmail();
  const client = await makeClient({ email });
  const result = await findCrmClientMatch({ email });
  assert.equal(result.outcome, "EXACT_MATCH");
  assert.equal(result.clientId, client.id);
});

test("real DB: phone E.164 exact match, single candidate -> EXACT_MATCH", async () => {
  const phone = uniquePhone();
  const client = await makeClient({ phone });
  const result = await findCrmClientMatch({ phone });
  assert.equal(result.outcome, "EXACT_MATCH");
  assert.equal(result.clientId, client.id);
});

test("real DB: archived clients are never matched (email signal)", async () => {
  const email = uniqueEmail();
  await makeClient({ email, archivedAt: new Date() });
  const result = await findCrmClientMatch({ email });
  assert.equal(result.outcome, "NO_MATCH");
});

test("real DB — MANDATORY NON-FUSION EXAMPLE FROM THE MISSION: 'ABC Services' in Montreal and 'ABC Services' in Quebec City must NEVER be treated as a match of each other", async () => {
  const suffix = randomUUID();
  const name = `ABC Services ${suffix}`;
  const montreal = await makeClient({ name, city: "Montreal", region: "Quebec", country: "Canada" });
  await makeClient({ name, city: "Quebec City", region: "Quebec", country: "Canada" });

  // Searching for the Montreal one by its own name+city+region: matches
  // itself only (AMBIGUOUS_MATCH -- surfaced for confirmation, never
  // auto-merged), never the Quebec City one.
  const result = await findCrmClientMatch({ name, city: "Montreal", region: "Quebec", country: "Canada" });
  assert.equal(result.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(result.candidateClientIds, [montreal.id], "must never include the Quebec City client");
});

test("real DB: name + city + region, single match -> AMBIGUOUS_MATCH (confidence MEDIUM), never EXACT_MATCH", async () => {
  const suffix = randomUUID();
  const name = `Corroborating Signal Co ${suffix}`;
  const client = await makeClient({ name, city: "Lyon", region: "Auvergne-Rhone-Alpes", country: "France" });
  const result = await findCrmClientMatch({ name, city: "Lyon", region: "Auvergne-Rhone-Alpes", country: "France" });
  assert.equal(result.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(result.candidateClientIds, [client.id]);
  assert.equal(result.confidence, "MEDIUM");
});

test("real DB: name alone (no city) never matches, even against a client sharing that exact name", async () => {
  const suffix = randomUUID();
  const name = `Bare Name Only ${suffix}`;
  await makeClient({ name, city: "Paris" });
  const result = await findCrmClientMatch({ name });
  assert.equal(result.outcome, "NO_MATCH");
});

test("real DB: pre-existing duplicate rows sharing the same email -> AMBIGUOUS_MATCH, both surfaced, never an arbitrary pick", async () => {
  const email = uniqueEmail();
  const first = await makeClient({ email });
  const second = await makeClient({ email });
  const result = await findCrmClientMatch({ email });
  assert.equal(result.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(result.candidateClientIds.sort(), [first.id, second.id].sort());
});

test("real DB: contradictory signals — email matches one client, phone matches a DIFFERENT client -> AMBIGUOUS_MATCH", async () => {
  const email = uniqueEmail();
  const phone = uniquePhone();
  const clientA = await makeClient({ email });
  const clientB = await makeClient({ phone });
  const result = await findCrmClientMatch({ email, phone });
  assert.equal(result.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(result.candidateClientIds.sort(), [clientA.id, clientB.id].sort());
});

// ---- 2. resolveInvoiceClient (via createInvoice) — the PRIORITY fix ----

function invoiceFormData(overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", "__new__");
  fd.set("title", "Dedup Phase A test invoice");
  fd.set("currency", "EUR");
  fd.set("items", JSON.stringify([{ description: "Test line", quantity: 1, unitPriceCents: 10000 }]));
  fd.set("newClientName", overrides.name);
  if (overrides.email) fd.set("newClientEmail", overrides.email);
  if (overrides.phone) fd.set("newClientPhone", overrides.phone);
  if (overrides.city) fd.set("newClientCity", overrides.city);
  if (overrides.region) fd.set("newClientRegion", overrides.region);
  if (overrides.country) fd.set("newClientCountry", overrides.country);
  fd.set("saveNewClient", "true");
  return fd;
}

test("real DB — resolveInvoiceClient: unambiguous email match REUSES the existing client, exactly like before this phase", async () => {
  const email = uniqueEmail();
  const existing = await makeClient({ email, name: "Existing Invoice Client" });
  const invoice = await createInvoice(invoiceFormData({ name: "A brand new typed name", email }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, existing.id, "must reuse the existing client, not create a duplicate");
  const allClients = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.email, email));
  assert.equal(allClients.length, 1, "no duplicate client row was created");
});

test("real DB — resolveInvoiceClient: THE PRIORITY FIX (part 1) — 'ABC Services' Montreal already exists; a new 'ABC Services' Quebec City invoice client creates a genuinely SEPARATE row, never merges into the Montreal one — the OLD lower(name)=lower(name) code would have wrongly reused it", async () => {
  const suffix = randomUUID();
  const name = `ABC Services Invoice ${suffix}`;
  const montreal = await makeClient({ name, city: "Montreal", region: "Quebec", country: "Canada" });

  const invoice = await createInvoice(invoiceFormData({ name, city: "Quebec City", region: "Quebec", country: "Canada" }));
  createdInvoiceIds.add(invoice.id);

  assert.notEqual(invoice.clientId, montreal.id, "must never merge into the Montreal client just because the name matches");

  const rows = await db.select({ id: crmClients.id, city: crmClients.city }).from(crmClients).where(eq(crmClients.name, name));
  createdClientIds.add(invoice.clientId);
  assert.equal(rows.length, 2, "two distinct clients now legitimately share this name — expected and correct");
  assert.ok(rows.some((r) => r.city === "Montreal"));
  assert.ok(rows.some((r) => r.city === "Quebec City"));
});

test("real DB — resolveInvoiceClient: THE PRIORITY FIX (part 2) — same name AND same city/region as an existing client, no email/phone -> creation is REFUSED, never silently merged", async () => {
  const suffix = randomUUID();
  const name = `Same Name Same City Invoice ${suffix}`;
  await makeClient({ name, city: "Montreal", region: "Quebec", country: "Canada" });

  await assert.rejects(
    () => createInvoice(invoiceFormData({ name, city: "Montreal", region: "Quebec", country: "Canada" })),
    /correspondre|match/i,
    "must throw the ambiguous-match error, never silently create or merge",
  );

  const rows = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.name, name));
  assert.equal(rows.length, 1, "no second client was created by the rejected attempt");
});

test("real DB — resolveInvoiceClient: same name AND same city/region (genuinely ambiguous corroborating signal) -> creation is REFUSED, not auto-merged", async () => {
  const suffix = randomUUID();
  const name = `Same City Co ${suffix}`;
  await makeClient({ name, city: "Lyon", region: "Auvergne-Rhone-Alpes", country: "France" });

  await assert.rejects(() => createInvoice(invoiceFormData({ name, city: "Lyon", region: "Auvergne-Rhone-Alpes", country: "France" })), /correspondre|match/i);

  const rows = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.name, name));
  assert.equal(rows.length, 1, "name+city alone must never be treated as sufficient for an automatic merge");
});

test("real DB — resolveInvoiceClient: no match at all -> a genuinely new client is created, exactly like before this phase", async () => {
  const suffix = randomUUID();
  const name = `Genuinely New Invoice Client ${suffix}`;
  const invoice = await createInvoice(invoiceFormData({ name, city: "Brussels", country: "Belgium" }));
  createdInvoiceIds.add(invoice.id);
  const [client] = await db.select().from(crmClients).where(eq(crmClients.name, name)).limit(1);
  assert.ok(client);
  createdClientIds.add(client.id);
  assert.equal(invoice.clientId, client.id);
});

// ---- 3. captureLead — the new "never arbitrarily pick" behavior ----

function anonymousContext() {
  return { kind: "anonymous", visitorId: randomUUID(), locale: "fr" };
}

test("real DB — captureLead: historical duplicate rows already sharing the same email -> a NEW row is created, never an arbitrary pick", async () => {
  const email = uniqueEmail();
  const dup1 = await makeClient({ email });
  const dup2 = await makeClient({ email });

  const result = await captureLead(anonymousContext(), {
    fullName: "Ambiguous Visitor",
    email,
    message: "hello, is this the same company as before?",
  });
  createdClientIds.add(result.crmClientId);

  assert.equal(result.reused, false, "must never silently merge into one of the pre-existing ambiguous rows");
  assert.notEqual(result.crmClientId, dup1.id);
  assert.notEqual(result.crmClientId, dup2.id);
});

test("real DB — captureLead: a single unambiguous existing email still reuses exactly as before this phase", async () => {
  const email = uniqueEmail();
  const existing = await makeClient({ email, notes: "prior note" });
  const result = await captureLead(anonymousContext(), { fullName: "Returning Visitor", email, message: "hi again" });
  assert.equal(result.reused, true);
  assert.equal(result.crmClientId, existing.id);
});

// ---- 4. createClient / createTicket — flag-only, never blocks ----

test("real DB — createClient: a detected duplicate (matching email) NEVER blocks creation — flag-only integration", async () => {
  const email = uniqueEmail();
  const existing = await makeClient({ email });

  const fd = new FormData();
  fd.set("name", "A deliberately duplicated new client");
  fd.set("email", email);
  const created = await createClient(fd);
  createdClientIds.add(created.id);

  assert.notEqual(created.id, existing.id, "createClient always creates a new row in this phase — never auto-reuses");
  const rows = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.email, email));
  assert.equal(rows.length, 2, "both the pre-existing and the newly created client now share this email — expected, flag-only behavior");
});

test("real DB — createTicket: the inline 'new client' path (name only) never blocks creation, dedup is structurally inert given its current form fields", async () => {
  const suffix = randomUUID();
  const name = `Ticket Inline Client ${suffix}`;
  await makeClient({ name, city: "Somewhere" }); // even a same-named+city existing client never blocks, since the ticket form collects no city

  const fd = new FormData();
  fd.set("clientId", "__new__");
  fd.set("newClientName", name);
  fd.set("subject", "Dedup Phase A ticket test");
  const result = await createTicket(fd);
  assert.equal(result, undefined, "no error returned");

  const rows = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.name, name));
  assert.equal(rows.length, 2, "a new client row was created regardless of the existing same-named one");
  for (const row of rows) createdClientIds.add(row.id);
  const ticketRows = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.subject, "Dedup Phase A ticket test"));
  for (const row of ticketRows) createdTicketIds.add(row.id);
});
