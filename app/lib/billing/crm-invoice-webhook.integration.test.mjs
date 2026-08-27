// Integration tests for Chantier 2 / Phase 4:
// markCrmInvoicePaidFromPaymentEvent (lib/billing/crm-invoice-webhook.ts) —
// the CRM invoice payment-confirmation business logic, deliberately
// decoupled from FastSpring's real transport (no signature, no network,
// no route — see the file's own header comment). This phase implements
// and tests ONLY the business logic; the future route layer that verifies
// a real signed provider payload before ever constructing this input is
// out of scope here.
//
// Same mocking convention as crm-invoices-auth.integration.test.mjs:
// @/lib/session's requireSession() is faked with a fixed staff session
// (needed only for the fixture — createInvoice is staff-only since
// Chantier 2 Phase 1); getCurrentSession() returns null, matching the
// reality that a payment-webhook-driven audit entry has no staff actor.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/billing/crm-invoice-webhook.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => ({
      userId: "test-staff-user",
      clerkUserId: "test_clerk_staff",
      email: "staff@example.com",
      fullName: "Test Staff",
      firstName: "Test",
      organizationId: "test-org",
      organizationName: "Test Org",
      role: "staff",
      previousLastLoginAt: null,
    }),
    getCurrentSession: async () => null,
  },
});

const { db } = await import("@/db");
const { auditLog, crmClients, crmInvoiceItems, crmInvoices } = await import("@/db/schema");
const { eq, and, inArray } = await import("drizzle-orm");
const { createInvoice } = await import("../actions/crm-invoices.ts");
const { markCrmInvoicePaidFromPaymentEvent } = await import("./crm-invoice-webhook.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();

beforeEach(() => {});

after(async () => {
  if (createdInvoiceIds.size) await db.delete(auditLog).where(inArray(auditLog.targetId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [client] = await db.insert(crmClients).values({ name: `P4-C2 Test Client ${randomUUID()}`, email: "invoice-webhook-test@example.test" }).returning();
  createdClientIds.add(client.id);
  return client;
}

function invoiceFormData(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Facture test Chantier 2 Phase 4");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(overrides.items ?? [{ description: "Ligne test", quantity: 1, unitPriceCents: 60000 }]));
  return fd;
}

/** Creates a draft invoice, then directly sets it to the desired status
 * (bypassing updateInvoiceStatus's own business rules on purpose — this is
 * fixture setup, not a test of that function). */
async function makeInvoiceWithStatus(status, overrides = {}) {
  const client = await makeClient();
  const invoice = await createInvoice(invoiceFormData(client.id, overrides));
  createdInvoiceIds.add(invoice.id);
  if (status !== "draft") {
    await db.update(crmInvoices).set({ status }).where(eq(crmInvoices.id, invoice.id));
  }
  return invoice;
}

async function invoiceRow(id) {
  const [row] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  return row;
}

async function auditRowsFor(invoiceId, action) {
  return db.select().from(auditLog).where(and(eq(auditLog.targetId, invoiceId), eq(auditLog.action, action)));
}

function event(invoice, overrides = {}) {
  return {
    eventType: "order.completed",
    crmInvoiceId: invoice.id,
    providerReference: "order-ref-001",
    amountCents: invoice.totalCents,
    currency: invoice.currency,
    ...overrides,
  };
}

// ---- A. sent + correct id/amount/currency -> paid ----
test("A — a matching event on a sent invoice marks it paid, sets paidAt/fastspringReference, exactly one audit", async () => {
  const invoice = await makeInvoiceWithStatus("sent");

  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice));
  assert.deepEqual(result, { ok: true, alreadyPaid: false });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "paid");
  assert.ok(after_.paidAt instanceof Date);
  assert.equal(after_.fastspringReference, "order-ref-001");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1);
  // logCrmAudit stamps clientId into metadata itself (see lib/audit.ts) —
  // the same convention already used by every other CRM audit action in
  // this codebase, not a leak: it's an internal UUID reference, never
  // sensitive provider payload data.
  assert.deepEqual(audits[0].metadata, { status: "paid", invoiceNumber: invoice.invoiceNumber, source: "payment_webhook", clientId: invoice.clientId });
});

// ---- R. unsupported eventType -> rejected before any mutation, even otherwise-valid ----
test("R — an unsupported eventType is rejected before any mutation, even with an otherwise fully valid payload", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { eventType: "subscription.charge.completed" }));
  assert.deepEqual(result, { ok: false, reason: "unsupported_event_type" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
  assert.equal(after_.fastspringReference, null);

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 0);
});

// ---- B. unknown invoice -> no mutation ----
test("B — an unknown crmInvoiceId is rejected", async () => {
  const result = await markCrmInvoicePaidFromPaymentEvent({ eventType: "order.completed", crmInvoiceId: randomUUID(), providerReference: "order-ref", amountCents: 1000, currency: "EUR" });
  assert.deepEqual(result, { ok: false, reason: "invoice_not_found" });
});

// ---- C. amount mismatch -> no mutation ----
test("C — an amount that does not match the invoice's stored total is rejected", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { amountCents: invoice.totalCents + 100 }));
  assert.deepEqual(result, { ok: false, reason: "amount_mismatch" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
  assert.equal(after_.fastspringReference, null);
});

// ---- D. currency mismatch -> no mutation ----
test("D — a currency that does not match the invoice's stored currency is rejected", async () => {
  const invoice = await makeInvoiceWithStatus("sent", { currency: "EUR" });
  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { currency: "CAD" }));
  assert.deepEqual(result, { ok: false, reason: "currency_mismatch" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
  assert.equal(after_.fastspringReference, null);
});

// ---- E/F/G/H. non-eligible statuses -> rejected ----
for (const status of ["draft", "canceled", "refunded", "delivery_failed"]) {
  test(`E/F/G/H — an invoice with status "${status}" is rejected as not eligible`, async () => {
    const invoice = await makeInvoiceWithStatus(status);
    const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice));
    assert.deepEqual(result, { ok: false, reason: "not_eligible" });

    const after_ = await invoiceRow(invoice.id);
    assert.equal(after_.status, status);
    assert.equal(after_.paidAt, null);
    assert.equal(after_.fastspringReference, null);
  });
}

// ---- I. paid + same providerReference -> idempotent no-op ----
test("I — replaying the exact same event on an already-paid invoice is an idempotent no-op", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const first = await markCrmInvoicePaidFromPaymentEvent(event(invoice));
  assert.equal(first.ok, true);
  const afterFirst = await invoiceRow(invoice.id);

  const second = await markCrmInvoicePaidFromPaymentEvent(event(invoice));
  assert.deepEqual(second, { ok: true, alreadyPaid: true });

  const afterSecond = await invoiceRow(invoice.id);
  assert.equal(afterSecond.paidAt.getTime(), afterFirst.paidAt.getTime(), "paidAt must not be rewritten by a replay");
  assert.equal(afterSecond.fastspringReference, afterFirst.fastspringReference);

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1, "no second audit entry for a replay");
});

// ---- J. paid + different providerReference -> conflict, no mutation ----
test("J — an event with a different providerReference on an already-paid invoice is a conflict, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  await markCrmInvoicePaidFromPaymentEvent(event(invoice));
  const afterFirst = await invoiceRow(invoice.id);

  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { providerReference: "order-ref-DIFFERENT" }));
  assert.deepEqual(result, { ok: false, reason: "reference_conflict" });

  const after_ = await invoiceRow(invoice.id);
  assert.deepEqual(after_, afterFirst, "the row must be completely unchanged by the conflicting event");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1, "still exactly one audit — from the original transition only");
});

// ---- P. paid + same providerReference + WRONG amount -> NOT a valid replay ----
test("P — same providerReference but a wrong amount on an already-paid invoice is a mismatch, never a silent replay", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  await markCrmInvoicePaidFromPaymentEvent(event(invoice));
  const afterFirst = await invoiceRow(invoice.id);

  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { amountCents: invoice.totalCents + 1 }));
  assert.deepEqual(result, { ok: false, reason: "amount_mismatch" });

  const after_ = await invoiceRow(invoice.id);
  assert.deepEqual(after_, afterFirst, "the row must be completely unchanged");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1, "still exactly one audit — from the original transition only, no new one");
});

// ---- Q. paid + same providerReference + WRONG currency -> NOT a valid replay ----
test("Q — same providerReference but a wrong currency on an already-paid invoice is a mismatch, never a silent replay", async () => {
  const invoice = await makeInvoiceWithStatus("sent", { currency: "EUR" });
  await markCrmInvoicePaidFromPaymentEvent(event(invoice));
  const afterFirst = await invoiceRow(invoice.id);

  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { currency: "CAD" }));
  assert.deepEqual(result, { ok: false, reason: "currency_mismatch" });

  const after_ = await invoiceRow(invoice.id);
  assert.deepEqual(after_, afterFirst, "the row must be completely unchanged");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1, "still exactly one audit — from the original transition only, no new one");
});

// ---- K. two concurrent identical events -> exactly one real transition, one audit ----
test("K — two concurrent identical events for the same invoice produce exactly one real transition and one audit", async () => {
  const invoice = await makeInvoiceWithStatus("sent");

  const [r1, r2] = await Promise.all([markCrmInvoicePaidFromPaymentEvent(event(invoice)), markCrmInvoicePaidFromPaymentEvent(event(invoice))]);

  const results = [r1, r2];
  const realTransitions = results.filter((r) => r.ok && !r.alreadyPaid);
  const idempotentEchoes = results.filter((r) => r.ok && r.alreadyPaid);
  assert.equal(realTransitions.length, 1, "exactly one call must perform the real transition");
  assert.equal(idempotentEchoes.length, 1, "the other call must observe it as already paid");

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "paid");
  assert.equal(after_.fastspringReference, "order-ref-001");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1, "exactly one audit row for the real transition");
});

// ---- L. empty/invalid providerReference -> no mutation ----
test("L — an empty providerReference is rejected before any mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { providerReference: "   " }));
  assert.deepEqual(result, { ok: false, reason: "invalid_reference" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.fastspringReference, null);
});

// ---- M. amount <= 0 -> no mutation ----
test("M — a zero or negative amount is rejected before any mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { amountCents: 0 }));
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.fastspringReference, null);
});

// ---- N. unsupported currency -> no mutation ----
test("N — an unsupported currency is rejected before any mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { currency: "USD" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_currency" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.fastspringReference, null);
});

// ---- O. pre-existing different fastspringReference on a still-"sent" invoice -> conflict ----
test("O — a pre-existing, different fastspringReference on a still-sent invoice is rejected as a conflict", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  await db.update(crmInvoices).set({ fastspringReference: "pre-existing-unrelated-ref" }).where(eq(crmInvoices.id, invoice.id));

  const result = await markCrmInvoicePaidFromPaymentEvent(event(invoice, { providerReference: "order-ref-001" }));
  assert.deepEqual(result, { ok: false, reason: "reference_conflict" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent", "status must remain untouched");
  assert.equal(after_.paidAt, null);
  assert.equal(after_.fastspringReference, "pre-existing-unrelated-ref", "the pre-existing reference must never be silently overwritten");
});
