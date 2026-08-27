// Unit tests for Chantier 2 / Phase 5A: adaptFastSpringOrderCompleted
// (lib/billing/crm-fastspring-adapter.ts) — pure payload translation, no
// DB, no network, no secret. Run with:
// npx tsx --test lib/billing/crm-fastspring-adapter.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptFastSpringOrderCompleted } from "./crm-fastspring-adapter.ts";

const VALID_INVOICE_ID = "11111111-1111-4111-8111-111111111111";

function validPayload(dataOverrides = {}, topOverrides = {}) {
  return {
    type: "order.completed",
    data: {
      order: "fs-order-12345",
      total: "49.99",
      currency: "EUR",
      orderTags: { crmInvoiceId: VALID_INVOICE_ID },
      ...dataOverrides,
    },
    ...topOverrides,
  };
}

// ---- A. valid order.completed ----
test("A — a fully valid order.completed payload produces the correct CrmInvoicePaymentEvent", () => {
  const result = adaptFastSpringOrderCompleted(validPayload());
  assert.deepEqual(result, {
    ok: true,
    event: { eventType: "order.completed", crmInvoiceId: VALID_INVOICE_ID, providerReference: "fs-order-12345", amountCents: 4999, currency: "EUR" },
  });
});

// ---- B. unsupported event type ----
test("B — an unsupported event type is rejected, no event produced", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({}, { type: "subscription.charge.completed" }));
  assert.deepEqual(result, { ok: false, reason: "unsupported_event_type" });
});

// ---- C. crmInvoiceId absent ----
test("C — a missing crmInvoiceId order tag is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ orderTags: {} }));
  assert.deepEqual(result, { ok: false, reason: "invalid_invoice_id" });
});

// ---- D. crmInvoiceId vide ----
test("D — an empty crmInvoiceId order tag is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ orderTags: { crmInvoiceId: "   " } }));
  assert.deepEqual(result, { ok: false, reason: "invalid_invoice_id" });
});

// ---- E. crmInvoiceId UUID invalide ----
test("E — a crmInvoiceId that is not a valid UUID is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ orderTags: { crmInvoiceId: "not-a-real-uuid" } }));
  assert.deepEqual(result, { ok: false, reason: "invalid_invoice_id" });
});

// ---- F. providerReference absente ----
test("F — a missing order/providerReference field is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ order: undefined }));
  assert.deepEqual(result, { ok: false, reason: "invalid_reference" });
});

// ---- G. providerReference vide ----
test("G — an empty order/providerReference field is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ order: "   " }));
  assert.deepEqual(result, { ok: false, reason: "invalid_reference" });
});

// ---- Amount conversion ----
test("H — \"10\" converts to 1000 cents", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "10" }));
  assert.equal(result.ok, true);
  assert.equal(result.event.amountCents, 1000);
});

test("I — \"10.0\" converts to 1000 cents", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "10.0" }));
  assert.equal(result.ok, true);
  assert.equal(result.event.amountCents, 1000);
});

test("J — \"10.00\" converts to 1000 cents", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "10.00" }));
  assert.equal(result.ok, true);
  assert.equal(result.event.amountCents, 1000);
});

test("K — \"49.99\" converts to 4999 cents", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "49.99" }));
  assert.equal(result.ok, true);
  assert.equal(result.event.amountCents, 4999);
});

test("L — \"49.999\" (more than 2 decimals) is rejected, never silently rounded", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "49.999" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });
});

test("L2 — exponential notation (\"1e2\") is rejected, never accidentally accepted as a number", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "1e2" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });
});

test("L3 — a value with surrounding whitespace is trimmed and accepted (the chosen, explicit policy)", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "  49.99  " }));
  assert.equal(result.ok, true);
  assert.equal(result.event.amountCents, 4999);
});

test("M — a zero amount is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "0" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });
  const resultDecimal = adaptFastSpringOrderCompleted(validPayload({ total: "0.00" }));
  assert.deepEqual(resultDecimal, { ok: false, reason: "invalid_amount" });
});

test("N — a negative amount is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "-1" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });
});

test("O — a non-numeric amount is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "abc" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });
});

test("P — Infinity/NaN are rejected, both as literal text and as a raw non-string value", () => {
  assert.deepEqual(adaptFastSpringOrderCompleted(validPayload({ total: "Infinity" })), { ok: false, reason: "invalid_amount" });
  assert.deepEqual(adaptFastSpringOrderCompleted(validPayload({ total: "NaN" })), { ok: false, reason: "invalid_amount" });
  assert.deepEqual(adaptFastSpringOrderCompleted(validPayload({ total: Infinity })), { ok: false, reason: "invalid_amount" });
  assert.deepEqual(adaptFastSpringOrderCompleted(validPayload({ total: NaN })), { ok: false, reason: "invalid_amount" });
});

test("Q — an amount whose cents conversion would overflow safe-integer range is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ total: "99999999999999999.99" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_amount" });
});

// ---- Currency normalization ----
test("R — \"EUR\" is accepted as-is", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ currency: "EUR" }));
  assert.equal(result.ok, true);
  assert.equal(result.event.currency, "EUR");
});

test("S — \"eur\" is normalized to \"EUR\"", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ currency: "eur" }));
  assert.equal(result.ok, true);
  assert.equal(result.event.currency, "EUR");
});

test("T — \" cad \" (whitespace + lowercase) is normalized to \"CAD\"", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ currency: " cad " }));
  assert.equal(result.ok, true);
  assert.equal(result.event.currency, "CAD");
});

test("U — \"USD\" is rejected (unsupported currency)", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ currency: "USD" }));
  assert.deepEqual(result, { ok: false, reason: "invalid_currency" });
});

test("V — an empty currency is rejected", () => {
  const result = adaptFastSpringOrderCompleted(validPayload({ currency: "   " }));
  assert.deepEqual(result, { ok: false, reason: "invalid_currency" });
});
