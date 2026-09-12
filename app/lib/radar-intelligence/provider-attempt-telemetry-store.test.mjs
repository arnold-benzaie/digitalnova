// RADAR INTELLIGENCE V2.1 — Phase G2 — provider-attempt-telemetry-store.ts tests.
//
// @/db is mocked to a fake in-memory stand-in (same convention as
// provider-policy-store.test.mjs / provider-runtime-config-store.test.mjs)
// -- no live Postgres, no DATABASE_URL.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/provider-attempt-telemetry-store.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/** @type {Array<Record<string, unknown>>} */
let insertedRows = [];
/** @type {{ throw?: unknown }} */
let insertBehavior = {};

const fakeDb = {
  insert: () => ({
    values: (values) => {
      if (insertBehavior.throw) return Promise.reject(insertBehavior.throw);
      insertedRows.push(values);
      return Promise.resolve();
    },
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { recordRadarAiProviderAttempt } = await import("./provider-attempt-telemetry-store.ts");

function validInput(overrides = {}) {
  return {
    aiRequestId: "air_abc123",
    actorUserId: "11111111-1111-4111-8111-111111111111",
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    selectionMode: "automatic",
    status: "success",
    errorCode: null,
    failureClass: null,
    httpStatus: null,
    latencyMs: 1234,
    attemptCount: 1,
    fallbackUsed: false,
    inputTokens: 100,
    outputTokens: 50,
    providerRequestId: "req_abc",
    ...overrides,
  };
}

test.beforeEach(() => {
  insertedRows = [];
  insertBehavior = {};
});

// ---- happy path ----

test("recordRadarAiProviderAttempt: a valid success record is inserted with exactly the expected columns", async () => {
  await recordRadarAiProviderAttempt(validInput());
  assert.equal(insertedRows.length, 1);
  const row = insertedRows[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      "aiRequestId",
      "actorUserId",
      "providerId",
      "modelId",
      "selectionMode",
      "status",
      "errorCode",
      "failureClass",
      "httpStatus",
      "latencyMs",
      "attemptCount",
      "fallbackUsed",
      "inputTokens",
      "outputTokens",
      "providerRequestId",
    ].sort(),
  );
  assert.equal(row.providerId, "anthropic");
  assert.equal(row.modelId, "claude-sonnet-4-5");
  assert.equal(row.selectionMode, "automatic");
  assert.equal(row.status, "success");
  assert.equal(row.latencyMs, 1234);
  assert.equal(row.attemptCount, 1);
  assert.equal(row.fallbackUsed, false);
  assert.equal(row.inputTokens, 100);
  assert.equal(row.outputTokens, 50);
  assert.equal(row.providerRequestId, "req_abc");
});

test("recordRadarAiProviderAttempt: a valid failure record is inserted with errorCode/failureClass/httpStatus set, tokens null", async () => {
  await recordRadarAiProviderAttempt(
    validInput({ status: "failure", errorCode: "PROVIDER_TIMEOUT", failureClass: "PROVIDER_TIMEOUT", httpStatus: null, inputTokens: null, outputTokens: null, providerRequestId: null }),
  );
  const row = insertedRows[0];
  assert.equal(row.status, "failure");
  assert.equal(row.errorCode, "PROVIDER_TIMEOUT");
  assert.equal(row.failureClass, "PROVIDER_TIMEOUT");
  assert.equal(row.httpStatus, null);
  assert.equal(row.inputTokens, null);
  assert.equal(row.outputTokens, null);
});

test("recordRadarAiProviderAttempt: a 5xx failure carries a validated httpStatus", async () => {
  await recordRadarAiProviderAttempt(validInput({ status: "failure", errorCode: "PROVIDER_ERROR", failureClass: "PROVIDER_5XX", httpStatus: 503 }));
  assert.equal(insertedRows[0].httpStatus, 503);
});

test("recordRadarAiProviderAttempt: fallbackUsed true + attemptCount 2 is stored faithfully", async () => {
  await recordRadarAiProviderAttempt(validInput({ providerId: "openai", modelId: "gpt-4o-mini", fallbackUsed: true, attemptCount: 2 }));
  assert.equal(insertedRows[0].fallbackUsed, true);
  assert.equal(insertedRows[0].attemptCount, 2);
  assert.equal(insertedRows[0].providerId, "openai");
});

test("recordRadarAiProviderAttempt: explicit selectionMode is stored faithfully", async () => {
  await recordRadarAiProviderAttempt(validInput({ selectionMode: "explicit" }));
  assert.equal(insertedRows[0].selectionMode, "explicit");
});

test("recordRadarAiProviderAttempt: a null actorUserId is accepted", async () => {
  await recordRadarAiProviderAttempt(validInput({ actorUserId: null }));
  assert.equal(insertedRows[0].actorUserId, null);
});

// ---- defense-in-depth: invalid/forged values are dropped, never inserted raw ----

test("recordRadarAiProviderAttempt: an unknown provider id -> the row is dropped entirely (never inserted)", async () => {
  await recordRadarAiProviderAttempt(validInput({ providerId: "gemini" }));
  assert.equal(insertedRows.length, 0);
});

test("recordRadarAiProviderAttempt: an unknown selectionMode -> dropped entirely", async () => {
  await recordRadarAiProviderAttempt(validInput({ selectionMode: "manual-override-forged" }));
  assert.equal(insertedRows.length, 0);
});

test("recordRadarAiProviderAttempt: an unknown status -> dropped entirely", async () => {
  await recordRadarAiProviderAttempt(validInput({ status: "partial-forged" }));
  assert.equal(insertedRows.length, 0);
});

test("recordRadarAiProviderAttempt: an attemptCount outside {1,2} -> dropped entirely", async () => {
  await recordRadarAiProviderAttempt(validInput({ attemptCount: 0 }));
  assert.equal(insertedRows.length, 0);
  await recordRadarAiProviderAttempt(validInput({ attemptCount: 3 }));
  assert.equal(insertedRows.length, 0);
});

test("recordRadarAiProviderAttempt: an unknown errorCode is silently nulled, row still inserted", async () => {
  await recordRadarAiProviderAttempt(validInput({ status: "failure", errorCode: "TOTALLY_FORGED_CODE" }));
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].errorCode, null);
});

test("recordRadarAiProviderAttempt: an unknown failureClass is silently nulled, row still inserted", async () => {
  await recordRadarAiProviderAttempt(validInput({ status: "failure", failureClass: "TOTALLY_FORGED_CLASS" }));
  assert.equal(insertedRows[0].failureClass, null);
});

test("recordRadarAiProviderAttempt: an out-of-range httpStatus (200, 999, 'abc') is silently nulled, never inserted raw", async () => {
  for (const bad of [200, 999, "abc", 401.5]) {
    await recordRadarAiProviderAttempt(validInput({ status: "failure", httpStatus: bad }));
  }
  for (const row of insertedRows) assert.equal(row.httpStatus, null);
});

test("recordRadarAiProviderAttempt: negative or non-integer token counts are silently nulled", async () => {
  await recordRadarAiProviderAttempt(validInput({ inputTokens: -5, outputTokens: 3.7 }));
  assert.equal(insertedRows[0].inputTokens, null);
  assert.equal(insertedRows[0].outputTokens, null);
});

test("recordRadarAiProviderAttempt: a negative or absurdly large latencyMs is clamped, never stored as-is", async () => {
  await recordRadarAiProviderAttempt(validInput({ latencyMs: -100 }));
  assert.equal(insertedRows[0].latencyMs, 0);
  await recordRadarAiProviderAttempt(validInput({ latencyMs: 999_999_999 }));
  assert.equal(insertedRows[1].latencyMs, 5 * 60 * 1000);
});

test("recordRadarAiProviderAttempt: an oversized providerRequestId is truncated to 128 chars, never stored unbounded", async () => {
  await recordRadarAiProviderAttempt(validInput({ providerRequestId: "x".repeat(500) }));
  assert.equal(insertedRows[0].providerRequestId.length, 128);
});

test("recordRadarAiProviderAttempt: an empty-string providerRequestId is nulled", async () => {
  await recordRadarAiProviderAttempt(validInput({ providerRequestId: "" }));
  assert.equal(insertedRows[0].providerRequestId, null);
});

// ---- fail-safe contract ----

test("recordRadarAiProviderAttempt: a DB insert failure never throws, never rejects", async () => {
  insertBehavior = { throw: new Error("connection refused") };
  await assert.doesNotReject(() => recordRadarAiProviderAttempt(validInput()));
  assert.equal(insertedRows.length, 0);
});

test("recordRadarAiProviderAttempt: resolves to undefined on both success and failure", async () => {
  const okResult = await recordRadarAiProviderAttempt(validInput());
  assert.equal(okResult, undefined);
  insertBehavior = { throw: new Error("boom") };
  const failResult = await recordRadarAiProviderAttempt(validInput());
  assert.equal(failResult, undefined);
});

// ---- secrecy ----

test("this module never touches an actual credential field/value, prompt, or advisory text", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("./provider-attempt-telemetry-store.ts", import.meta.url), "utf8");
  assert.equal(/\bapiKey\b|\bapi_key\b|x-api-key|Authorization|Bearer |process\.env|\bprompt\b|advisoryText|summary:/i.test(source), false);
});

test("a hostile fake key smuggled into a free-text-shaped field (modelId/providerRequestId) is stored as opaque data but never a DEDICATED secret field exists on the row", async () => {
  const FAKE_KEY = "sk-ant-THIS-MUST-NEVER-BE-A-DEDICATED-COLUMN";
  await recordRadarAiProviderAttempt(validInput({ modelId: FAKE_KEY }));
  // modelId is a free-text (bounded) display field by design (Phase E's
  // own established position: model ids are configuration, not secrets)
  // -- this test's real point is structural: assert no column NAME on
  // the row could ever be mistaken for a secret store.
  // "inputTokens"/"outputTokens" (legitimate token COUNT columns) must
  // not false-positive this check -- only a credential-shaped name
  // (apiKey, credential, secret, authToken, accessToken, bearerToken)
  // would indicate an actual secret store.
  const row = insertedRows[0];
  assert.equal(/apiKey|credential|secret|authToken|accessToken|bearerToken/i.test(Object.keys(row).join(" ")), false);
});
