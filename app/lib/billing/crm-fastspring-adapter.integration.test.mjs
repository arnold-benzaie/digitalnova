// Integration tests for Chantier 2 / Phase 5A: proving the full chain
// adaptFastSpringOrderCompleted -> markCrmInvoicePaidFromPaymentEvent
// against a real invoice row, with the real (unmocked) Phase 4 engine —
// exactly the boundary this phase exists to prove: the adapter's output
// is a valid, correctly-typed CrmInvoicePaymentEvent that the engine
// accepts and processes exactly as it already does when fed by hand in
// crm-invoice-webhook.integration.test.mjs.
//
// Same mocking convention as crm-invoice-webhook.integration.test.mjs:
// @/lib/session's requireSession() is faked with a fixed staff session
// (needed only for the fixture — createInvoice is staff-only since
// Chantier 2 Phase 1); getCurrentSession() returns null.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/billing/crm-fastspring-adapter.integration.test.mjs
import { test, mock, after } from "node:test";
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
const { adaptFastSpringOrderCompleted } = await import("./crm-fastspring-adapter.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();

after(async () => {
  if (createdInvoiceIds.size) await db.delete(auditLog).where(inArray(auditLog.targetId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient() {
  const [client] = await db.insert(crmClients).values({ name: `P5A-C2 Test Client ${randomUUID()}`, email: "adapter-test@example.test" }).returning();
  createdClientIds.add(client.id);
  return client;
}

function invoiceFormData(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Facture test Chantier 2 Phase 5A");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(overrides.items ?? [{ description: "Ligne test", quantity: 1, unitPriceCents: 4999 }]));
  return fd;
}

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

function fastSpringOrderCompleted(invoice, overrides = {}) {
  return {
    type: "order.completed",
    data: {
      order: "fs-order-abc-001",
      total: (invoice.totalCents / 100).toFixed(2),
      currency: invoice.currency,
      orderTags: { crmInvoiceId: invoice.id },
      ...overrides,
    },
  };
}

// ---- full chain: adapter -> engine -> paid ----
test("adapter -> engine: a valid FastSpring order.completed marks the invoice paid, stores providerReference, exactly one audit", async () => {
  const invoice = await makeInvoiceWithStatus("sent", { items: [{ description: "Ligne test", quantity: 1, unitPriceCents: 4999 }] });

  const adapted = adaptFastSpringOrderCompleted(fastSpringOrderCompleted(invoice));
  assert.equal(adapted.ok, true);

  const result = await markCrmInvoicePaidFromPaymentEvent(adapted.event);
  assert.deepEqual(result, { ok: true, alreadyPaid: false });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "paid");
  assert.ok(after_.paidAt instanceof Date);
  assert.equal(after_.fastspringReference, "fs-order-abc-001");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1);
});

// ---- amount mismatch after conversion -> no mutation ----
test("adapter -> engine: an order total that converts to a different amount than the invoice's is rejected, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent", { items: [{ description: "Ligne test", quantity: 1, unitPriceCents: 4999 }] });

  const adapted = adaptFastSpringOrderCompleted(fastSpringOrderCompleted(invoice, { total: "50.00" }));
  assert.equal(adapted.ok, true, "the adapter itself must succeed — the mismatch is a business-layer concern");

  const result = await markCrmInvoicePaidFromPaymentEvent(adapted.event);
  assert.deepEqual(result, { ok: false, reason: "amount_mismatch" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
  assert.equal(after_.fastspringReference, null);
});

// ---- currency mismatch -> no mutation ----
test("adapter -> engine: an order currency that differs from the invoice's is rejected, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent", { currency: "EUR", items: [{ description: "Ligne test", quantity: 1, unitPriceCents: 4999 }] });

  const adapted = adaptFastSpringOrderCompleted(fastSpringOrderCompleted(invoice, { currency: "cad" }));
  assert.equal(adapted.ok, true);
  assert.equal(adapted.event.currency, "CAD", "the adapter normalizes casing before handing off to the engine");

  const result = await markCrmInvoicePaidFromPaymentEvent(adapted.event);
  assert.deepEqual(result, { ok: false, reason: "currency_mismatch" });

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
});

// ---- replay -> idempotent ----
test("adapter -> engine: replaying the exact same FastSpring event is an idempotent no-op", async () => {
  const invoice = await makeInvoiceWithStatus("sent", { items: [{ description: "Ligne test", quantity: 1, unitPriceCents: 4999 }] });
  const payload = fastSpringOrderCompleted(invoice);

  const first = adaptFastSpringOrderCompleted(payload);
  const firstResult = await markCrmInvoicePaidFromPaymentEvent(first.event);
  assert.equal(firstResult.ok, true);
  const afterFirst = await invoiceRow(invoice.id);

  const second = adaptFastSpringOrderCompleted(payload);
  const secondResult = await markCrmInvoicePaidFromPaymentEvent(second.event);
  assert.deepEqual(secondResult, { ok: true, alreadyPaid: true });

  const afterSecond = await invoiceRow(invoice.id);
  assert.equal(afterSecond.paidAt.getTime(), afterFirst.paidAt.getTime());

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1, "no second audit for a replay");
});
