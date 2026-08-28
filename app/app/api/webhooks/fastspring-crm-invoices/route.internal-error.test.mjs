// Chantier 2 / Phase 5B — proves the route never converts an unexpected
// internal exception into a false 200 ACK, and never leaks the exception
// message/stack in its response body.
//
// Deliberately a SEPARATE, self-contained file from
// route.integration.test.mjs: only @/lib/billing/crm-invoice-webhook (the
// Phase 4 engine) is mocked here, to throw on purpose — everything else
// (signature verification, the Phase 5A adapter) stays real. No database
// is touched by this file at all (the mocked engine never reaches @/db),
// so no DATABASE_URL/local-DB setup is needed here, unlike
// route.integration.test.mjs.
//
// Run with: npx tsx --test --experimental-test-module-mocks app/api/webhooks/fastspring-crm-invoices/route.internal-error.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const FIXTURE_SECRET = "fixture-only-not-a-real-fastspring-secret";
process.env.FASTSPRING_CRM_WEBHOOK_SECRET = FIXTURE_SECRET;

mock.module("@/lib/billing/crm-invoice-webhook", {
  namedExports: {
    markCrmInvoicePaidFromPaymentEvent: async () => {
      throw new Error("simulated internal failure — DB connection lost");
    },
  },
});

const { POST } = await import("./route.ts");

function sign(body, secret) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

test("an unexpected internal exception from the engine results in HTTP 500, never a false 200 ACK, and never leaks the error message", async () => {
  const payload = {
    type: "order.completed",
    data: { order: "fs-order-err-1", total: "10.00", currency: "EUR", orderTags: { crmInvoiceId: "11111111-1111-4111-8111-111111111111" } },
  };
  const rawBody = JSON.stringify(payload);
  const signature = sign(rawBody, FIXTURE_SECRET);
  const request = new Request("http://localhost/api/webhooks/fastspring-crm-invoices", {
    method: "POST",
    headers: { "x-fs-signature": signature },
    body: rawBody,
  });

  const response = await POST(request);
  assert.equal(response.status, 500);

  const body = await response.json();
  assert.deepEqual(body, { ok: false, reason: "internal_error" }, "the response must be exactly this minimal shape — nothing else");
  const bodyText = JSON.stringify(body);
  assert.doesNotMatch(bodyText, /DB connection lost|simulated internal failure|at Test|\.ts:\d+/i, "the response must never leak the underlying exception message or a stack trace");
});
