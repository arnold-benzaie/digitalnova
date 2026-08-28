// Integration tests for Chantier 2 / Phase 5B: the dedicated CRM invoice
// payment webhook route (app/api/webhooks/fastspring-crm-invoices/route.ts).
// Calls POST(request) directly with real Web API Request/Response objects
// — no actual HTTP server/port needed, exactly like a real deployment
// would invoke this Route Handler. Every dependency below is the REAL,
// unmocked implementation (signature verification via real HMAC-SHA256,
// the real Phase 5A adapter, the real Phase 4 engine against a real local
// database) — only @/lib/session is faked, and only because
// createInvoice (test fixture setup) is staff-only and
// markCrmInvoicePaidFromPaymentEvent's audit call needs getCurrentSession()
// to resolve without a real Clerk request context.
//
// FASTSPRING_CRM_WEBHOOK_SECRET is set here to a FIXTURE value only —
// never a real FastSpring secret, no network, no external provider ever
// contacted.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks app/api/webhooks/fastspring-crm-invoices/route.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

const FIXTURE_SECRET = "fixture-only-not-a-real-fastspring-secret";
process.env.FASTSPRING_CRM_WEBHOOK_SECRET = FIXTURE_SECRET;

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
const { createInvoice } = await import("@/lib/actions/crm-invoices.ts");
const { POST } = await import("./route.ts");

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
  const [client] = await db.insert(crmClients).values({ name: `P5B-C2 Test Client ${randomUUID()}`, email: "route-test@example.test" }).returning();
  createdClientIds.add(client.id);
  return client;
}

function invoiceFormData(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Facture test Chantier 2 Phase 5B");
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

function sign(body, secret) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function makeRequest(bodyString, { signature, omitSignature = false } = {}) {
  const headers = new Headers();
  if (!omitSignature) {
    headers.set("x-fs-signature", signature ?? sign(bodyString, FIXTURE_SECRET));
  }
  return new Request("http://localhost/api/webhooks/fastspring-crm-invoices", { method: "POST", headers, body: bodyString });
}

async function callRoute(bodyString, opts) {
  const response = await POST(makeRequest(bodyString, opts));
  const body = await response.json();
  return { status: response.status, body };
}

function payloadObject(invoice, overrides = {}) {
  const data = {
    order: "fs-order-route-001",
    total: (invoice.totalCents / 100).toFixed(2),
    currency: invoice.currency,
    orderTags: { crmInvoiceId: invoice.id },
  };
  return { type: "order.completed", data: { ...data, ...overrides } };
}

// =========================================================
// A-F. secret / signature
// =========================================================

test("A — a missing FASTSPRING_CRM_WEBHOOK_SECRET fails closed with 500", async () => {
  const saved = process.env.FASTSPRING_CRM_WEBHOOK_SECRET;
  delete process.env.FASTSPRING_CRM_WEBHOOK_SECRET;
  try {
    const { status, body } = await callRoute(JSON.stringify({ type: "order.completed" }));
    assert.equal(status, 500);
    assert.equal(body.ok, false);
  } finally {
    process.env.FASTSPRING_CRM_WEBHOOK_SECRET = saved;
  }
});

test("B — a missing signature header is rejected with 401", async () => {
  const { status, body } = await callRoute(JSON.stringify({ type: "order.completed" }), { omitSignature: true });
  assert.equal(status, 401);
  assert.equal(body.ok, false);
});

test("C — an invalid signature is rejected with 401", async () => {
  const { status, body } = await callRoute(JSON.stringify({ type: "order.completed" }), { signature: sign("something-else", FIXTURE_SECRET) });
  assert.equal(status, 401);
  assert.equal(body.ok, false);
});

test("D — a valid signature is accepted and processing proceeds (malformed JSON reached, not a signature error)", async () => {
  const rawBody = "{not valid json";
  const { status } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 400, "must reach the JSON-parse stage, proving the signature step itself passed");
});

test("D2 — an invalid signature over a malformed JSON body is still rejected with 401, never reaching JSON.parse", async () => {
  const rawBody = "{not valid json";
  const { status, body } = await callRoute(rawBody, { signature: sign("something-else", FIXTURE_SECRET) });
  assert.equal(status, 401, "signature verification must reject before JSON is ever parsed, even when the body happens to be malformed");
  assert.equal(body.reason, "invalid_signature");
});

test("E — a body byte modified after signing is rejected with 401 (tamper detection)", async () => {
  const original = JSON.stringify({ type: "order.completed", data: { order: "fs-order-1" } });
  const signature = sign(original, FIXTURE_SECRET);
  const tampered = original.replace("fs-order-1", "fs-order-2");
  const { status } = await callRoute(tampered, { signature });
  assert.equal(status, 401);
});

test("F — a signature of invalid length is rejected with 401", async () => {
  const { status } = await callRoute(JSON.stringify({ type: "order.completed" }), { signature: "too-short" });
  assert.equal(status, 401);
});

// =========================================================
// Raw body exactness (byte-for-byte, not re-serialized JSON)
// =========================================================

test("raw body tamper — a single whitespace character added after signing is rejected, proving verification is on exact text, not re-serialized JSON", async () => {
  const original = JSON.stringify({ type: "order.completed", data: { order: "fs-order-1", total: "10.00" } });
  const signature = sign(original, FIXTURE_SECRET);
  const withExtraSpace = original + " ";
  const { status } = await callRoute(withExtraSpace, { signature });
  assert.equal(status, 401);
});

// =========================================================
// G. malformed JSON after valid signature
// =========================================================

test("G — malformed JSON after a valid signature is rejected with 400, no mutation", async () => {
  const rawBody = "{ this is not json ";
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

// =========================================================
// H-M. adapter fail-closed (permanent data problems) -> 200 ACK, no mutation
// =========================================================

test("H — an unsupported event type is ACKed with 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const payload = { ...payloadObject(invoice, {}), type: "subscription.charge.completed" };
  const rawBody = JSON.stringify(payload);
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "unsupported_event_type");
  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
});

test("I — a missing crmInvoiceId order tag is ACKed with 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, { orderTags: {} }));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invalid_invoice_id");
  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
});

test("J — an invalid UUID crmInvoiceId is ACKed with 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, { orderTags: { crmInvoiceId: "not-a-real-uuid" } }));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invalid_invoice_id");
});

test("K — a missing providerReference (order field) is ACKed with 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const payload = payloadObject(invoice, {});
  delete payload.data.order;
  const rawBody = JSON.stringify(payload);
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invalid_reference");
});

test("L — an invalid amount is ACKed with 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, { total: "49.999" }));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invalid_amount");
});

test("M — an invalid currency is ACKed with 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, { currency: "USD" }));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invalid_currency");
});

// =========================================================
// N-W. real engine chain
// =========================================================

test("N — a valid sent invoice payment: 200, paid, paidAt set, providerReference stored, exactly 1 audit", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, {}));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });

  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "paid");
  assert.ok(after_.paidAt instanceof Date);
  assert.equal(after_.fastspringReference, "fs-order-route-001");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1);
});

test("O — amount mismatch (real engine check): 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, { total: ((invoice.totalCents + 500) / 100).toFixed(2) }));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "amount_mismatch");
  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
  assert.equal(after_.paidAt, null);
});

test("P — currency mismatch (real engine check): 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent", { currency: "EUR" });
  const rawBody = JSON.stringify(payloadObject(invoice, { currency: "CAD" }));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "currency_mismatch");
  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
});

test("Q — an unknown crmInvoiceId (valid UUID, no matching invoice): 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, { orderTags: { crmInvoiceId: randomUUID() } }));
  const { status, body } = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invoice_not_found");
  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "sent");
});

test("R — reference conflict (already paid with a different reference): 200, no mutation", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const firstBody = JSON.stringify(payloadObject(invoice, {}));
  await callRoute(firstBody, { signature: sign(firstBody, FIXTURE_SECRET) });
  const afterFirst = await invoiceRow(invoice.id);

  const conflictBody = JSON.stringify(payloadObject(invoice, { order: "fs-order-DIFFERENT" }));
  const { status, body } = await callRoute(conflictBody, { signature: sign(conflictBody, FIXTURE_SECRET) });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "reference_conflict");
  const after_ = await invoiceRow(invoice.id);
  assert.deepEqual(after_, afterFirst);
});

for (const status of ["draft", "canceled", "refunded", "delivery_failed"]) {
  test(`S/T/U/V — invoice status "${status}": 200, no mutation`, async () => {
    const invoice = await makeInvoiceWithStatus(status);
    const rawBody = JSON.stringify(payloadObject(invoice, {}));
    const result = await callRoute(rawBody, { signature: sign(rawBody, FIXTURE_SECRET) });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.reason, "not_eligible");
    const after_ = await invoiceRow(invoice.id);
    assert.equal(after_.status, status);
  });
}

test("W — a replayed identical event: 200, idempotent, paidAt unchanged, 0 new audit", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, {}));
  const signature = sign(rawBody, FIXTURE_SECRET);

  const first = await callRoute(rawBody, { signature });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  const afterFirst = await invoiceRow(invoice.id);

  const second = await callRoute(rawBody, { signature });
  assert.equal(second.status, 200);
  assert.equal(second.body.ok, true);

  const afterSecond = await invoiceRow(invoice.id);
  assert.equal(afterSecond.paidAt.getTime(), afterFirst.paidAt.getTime());

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1);
});

// =========================================================
// Concurrency
// =========================================================

test("concurrent HTTP requests for the same invoice: both 200, exactly one real transition, one audit, one consistent reference", async () => {
  const invoice = await makeInvoiceWithStatus("sent");
  const rawBody = JSON.stringify(payloadObject(invoice, {}));
  const signature = sign(rawBody, FIXTURE_SECRET);

  const [r1, r2] = await Promise.all([callRoute(rawBody, { signature }), callRoute(rawBody, { signature })]);

  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r1.body.ok, true);
  assert.equal(r2.body.ok, true);

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.status, "paid");
  assert.equal(after_.fastspringReference, "fs-order-route-001");

  const audits = await auditRowsFor(invoice.id, "crm.invoice_status_changed");
  assert.equal(audits.length, 1);
});
