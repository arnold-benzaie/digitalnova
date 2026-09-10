// RADAR INTELLIGENCE V1 — safe provider failure diagnostics — pure error
// classification. NO network, NO DB, NO provider. Proves that the coarse
// `failureClass` bucket is attached correctly and that NO raw provider
// text / status number / secret ever rides along on the normalized error.
//
// Run: npx tsx --test lib/radar-intelligence/errors.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_FAILURE_CLASSES,
  SAFE_ERROR_MESSAGES,
  classifyHttpStatus,
  isProviderFailureClass,
  makeIntelligenceError,
  toIntelligenceError,
} from "./errors.ts";

// ---------------- classifyHttpStatus ----------------

test("classifyHttpStatus: 400–499 -> PROVIDER_4XX", () => {
  for (const s of [400, 401, 402, 403, 404, 408, 409, 422, 429, 451, 499]) {
    assert.equal(classifyHttpStatus(s), "PROVIDER_4XX", `status ${s}`);
  }
});

test("classifyHttpStatus: 500–599 -> PROVIDER_5XX", () => {
  for (const s of [500, 501, 502, 503, 504, 505, 520, 529, 599]) {
    assert.equal(classifyHttpStatus(s), "PROVIDER_5XX", `status ${s}`);
  }
});

test("classifyHttpStatus: anything outside 400–599 (or non-finite) -> undefined", () => {
  for (const s of [0, 100, 200, 204, 301, 302, 399, 600, 700, -1, NaN, Infinity]) {
    assert.equal(classifyHttpStatus(s), undefined, `status ${s}`);
  }
});

test("PROVIDER_FAILURE_CLASSES is exactly the six coarse buckets", () => {
  assert.deepEqual(
    [...PROVIDER_FAILURE_CLASSES].sort(),
    ["PROVIDER_4XX", "PROVIDER_5XX", "PROVIDER_NETWORK", "PROVIDER_PARSE", "PROVIDER_TIMEOUT", "PROVIDER_UNKNOWN"].sort(),
  );
  for (const c of PROVIDER_FAILURE_CLASSES) assert.equal(isProviderFailureClass(c), true);
  for (const junk of ["PROVIDER_ERROR", "4xx", "", "provider_4xx", 42, null, undefined]) {
    assert.equal(isProviderFailureClass(junk), false);
  }
});

// ---------------- makeIntelligenceError ----------------

test("makeIntelligenceError: 2-arg call keeps the exact pre-patch shape (no failureClass key)", () => {
  const e = makeIntelligenceError("PROVIDER_ERROR", "anthropic");
  assert.deepEqual(e, {
    code: "PROVIDER_ERROR",
    providerId: "anthropic",
    retryable: false,
    message: SAFE_ERROR_MESSAGES.PROVIDER_ERROR,
  });
  assert.equal("failureClass" in e, false);
});

test("makeIntelligenceError: 3rd arg attaches the coarse class verbatim", () => {
  const e = makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX");
  assert.equal(e.failureClass, "PROVIDER_4XX");
  assert.equal(e.code, "PROVIDER_ERROR");
  assert.equal(e.message, SAFE_ERROR_MESSAGES.PROVIDER_ERROR);
});

// ---------------- toIntelligenceError: class attribution ----------------

test("toIntelligenceError: AbortError / TimeoutError -> PROVIDER_TIMEOUT (code + class), no raw text", () => {
  for (const name of ["AbortError", "TimeoutError"]) {
    const thrown = Object.assign(new Error(`connect ECONNREFUSED 10.0.0.1:443 x-api-key sk-ant-LEAK ${name}`), { name });
    const e = toIntelligenceError(thrown, "anthropic");
    assert.equal(e.code, "PROVIDER_TIMEOUT");
    assert.equal(e.failureClass, "PROVIDER_TIMEOUT");
    assert.equal(e.message, SAFE_ERROR_MESSAGES.PROVIDER_TIMEOUT);
    const s = JSON.stringify(e);
    assert.equal(s.includes("sk-ant-"), false);
    assert.equal(s.includes("ECONNREFUSED"), false);
    assert.equal(s.includes("10.0.0.1"), false);
  }
});

test("toIntelligenceError: status 429 -> RATE_LIMITED + PROVIDER_4XX; body never copied", () => {
  const e = toIntelligenceError({ status: 429, body: "Retry-After: 60; org_abc; Authorization: Bearer sk-ant-LEAK" }, "anthropic");
  assert.equal(e.code, "PROVIDER_RATE_LIMITED");
  assert.equal(e.failureClass, "PROVIDER_4XX");
  const s = JSON.stringify(e);
  assert.equal(s.includes("Bearer"), false);
  assert.equal(s.includes("sk-ant-"), false);
  assert.equal(s.includes("org_abc"), false);
});

test("toIntelligenceError: status 502/503/504 -> UNAVAILABLE + PROVIDER_5XX", () => {
  for (const status of [502, 503, 504]) {
    const e = toIntelligenceError({ status }, "anthropic");
    assert.equal(e.code, "PROVIDER_UNAVAILABLE");
    assert.equal(e.failureClass, "PROVIDER_5XX");
  }
});

test("toIntelligenceError: fixed transport error NAMES map to NETWORK / PARSE, code stays PROVIDER_ERROR", () => {
  const net = toIntelligenceError(Object.assign(new Error("anthropic transport request failed"), { name: "TransportNetworkError" }), "anthropic");
  assert.equal(net.code, "PROVIDER_ERROR");
  assert.equal(net.failureClass, "PROVIDER_NETWORK");

  const parse = toIntelligenceError(Object.assign(new Error("anthropic transport request failed"), { name: "InvalidJsonError" }), "anthropic");
  assert.equal(parse.code, "PROVIDER_ERROR");
  assert.equal(parse.failureClass, "PROVIDER_PARSE");
});

test("toIntelligenceError: a bare numeric status (not 429/5xx-special) is bucketed by range", () => {
  assert.equal(toIntelligenceError({ status: 400 }, "anthropic").failureClass, "PROVIDER_4XX");
  assert.equal(toIntelligenceError({ status: 401 }, "anthropic").failureClass, "PROVIDER_4XX");
  assert.equal(toIntelligenceError({ status: 403 }, "anthropic").failureClass, "PROVIDER_4XX");
  assert.equal(toIntelligenceError({ status: 500 }, "anthropic").failureClass, "PROVIDER_5XX");
  assert.equal(toIntelligenceError({ status: 418 }, "anthropic").code, "PROVIDER_ERROR");
});

test("toIntelligenceError: an unrecognizable thrown value -> PROVIDER_ERROR + PROVIDER_UNKNOWN, no leaked text", () => {
  const weird = { message: "DATABASE_URL=postgres://u:p@h/db", stack: "at secretThing()", response: { data: { key: "sk-ant-LEAK" } } };
  const e = toIntelligenceError(weird, "anthropic");
  assert.equal(e.code, "PROVIDER_ERROR");
  assert.equal(e.failureClass, "PROVIDER_UNKNOWN");
  assert.equal(e.message, SAFE_ERROR_MESSAGES.PROVIDER_ERROR);
  const s = JSON.stringify(e);
  assert.equal(s.includes("DATABASE_URL"), false);
  assert.equal(s.includes("secretThing"), false);
  assert.equal(s.includes("sk-ant-"), false);
  assert.equal(s.includes("postgres://"), false);
});

test("toIntelligenceError: a raw string throw -> PROVIDER_ERROR + PROVIDER_UNKNOWN", () => {
  const e = toIntelligenceError("boom: key=sk-ant-LEAK", "anthropic");
  assert.equal(e.code, "PROVIDER_ERROR");
  assert.equal(e.failureClass, "PROVIDER_UNKNOWN");
  assert.equal(JSON.stringify(e).includes("sk-ant-"), false);
});

test("toIntelligenceError: the returned object exposes ONLY the safe keys", () => {
  const e = toIntelligenceError({ status: 401, body: "secret" }, "anthropic");
  assert.deepEqual(Object.keys(e).sort(), ["code", "failureClass", "message", "providerId", "retryable"].sort());
});
