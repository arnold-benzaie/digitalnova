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
  validateHttpStatus,
  validateProviderErrorType,
  validateProviderErrorCode,
  validateProviderErrorParam,
  KNOWN_OPENAI_ERROR_TYPES,
  KNOWN_OPENAI_ERROR_CODES,
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

test("toIntelligenceError: the returned object exposes ONLY the safe keys (401 now also validates as httpStatus)", () => {
  const e = toIntelligenceError({ status: 401, body: "secret" }, "anthropic");
  assert.deepEqual(Object.keys(e).sort(), ["code", "failureClass", "httpStatus", "message", "providerId", "retryable"].sort());
  assert.equal(e.httpStatus, 401);
});

// ---------------- validateHttpStatus ----------------

test("validateHttpStatus: accepts every integer in 400–599", () => {
  for (const s of [400, 401, 403, 404, 429, 500, 502, 503, 504, 599]) {
    assert.equal(validateHttpStatus(s), s, `status ${s}`);
  }
});

test("validateHttpStatus: rejects out-of-range, non-integer, and non-number values", () => {
  for (const bad of [0, 100, 199, 200, 204, 301, 399, 600, 700, -1, 401.5, NaN, Infinity, -Infinity]) {
    assert.equal(validateHttpStatus(bad), undefined, `should reject ${bad}`);
  }
});

test("validateHttpStatus: NEVER coerces a string — \"401\" is rejected, not parsed", () => {
  assert.equal(validateHttpStatus("401"), undefined);
  assert.equal(validateHttpStatus("400"), undefined);
  assert.equal(validateHttpStatus(""), undefined);
});

test("validateHttpStatus: rejects null, undefined, booleans, objects, arrays", () => {
  for (const bad of [null, undefined, true, false, {}, [], { status: 401 }]) {
    assert.equal(validateHttpStatus(bad), undefined);
  }
});

// ---------------- makeIntelligenceError: httpStatus attachment ----------------

test("makeIntelligenceError: attaches a validated httpStatus as the 4th arg", () => {
  const e = makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_4XX", 400);
  assert.equal(e.httpStatus, 400);
});

test("makeIntelligenceError: SILENTLY drops an out-of-range or non-integer httpStatus — never attaches it", () => {
  for (const bad of [200, 301, 600, 999, 400.5, "401", NaN]) {
    const e = makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_UNKNOWN", bad);
    assert.equal("httpStatus" in e, false, `should have dropped ${bad}`);
  }
});

test("makeIntelligenceError: 2-arg and 3-arg calls are still byte-identical (no httpStatus key at all)", () => {
  assert.equal("httpStatus" in makeIntelligenceError("PROVIDER_ERROR", "anthropic"), false);
  assert.equal("httpStatus" in makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_UNKNOWN"), false);
});

// ---------------- toIntelligenceError: httpStatus by failure class ----------------

test("toIntelligenceError: every genuine 4xx/5xx numeric status attaches the exact same httpStatus", () => {
  for (const status of [400, 401, 403, 404, 429, 500, 502, 503, 504]) {
    const e = toIntelligenceError({ status }, "anthropic");
    assert.equal(e.httpStatus, status, `status ${status}`);
  }
});

test("toIntelligenceError: AbortError / TimeoutError NEVER carries an httpStatus, even if a status field is also present", () => {
  const e = toIntelligenceError(Object.assign(new Error("x"), { name: "AbortError", status: 500 }), "anthropic");
  assert.equal(e.code, "PROVIDER_TIMEOUT");
  assert.equal("httpStatus" in e, false, "a timeout must never carry a fabricated/incidental httpStatus");
});

test("toIntelligenceError: a network fault (TransportNetworkError) NEVER carries an httpStatus", () => {
  const e = toIntelligenceError(Object.assign(new Error("x"), { name: "TransportNetworkError" }), "anthropic");
  assert.equal(e.failureClass, "PROVIDER_NETWORK");
  assert.equal("httpStatus" in e, false);
});

test("toIntelligenceError: an invalid-JSON fault (InvalidJsonError) NEVER carries an httpStatus (it followed a 2xx, outside 400–599)", () => {
  const e = toIntelligenceError(Object.assign(new Error("x"), { name: "InvalidJsonError" }), "anthropic");
  assert.equal(e.failureClass, "PROVIDER_PARSE");
  assert.equal("httpStatus" in e, false);
});

test("toIntelligenceError: an arbitrary 2xx/3xx status is rejected — never exposed as httpStatus", () => {
  for (const status of [200, 204, 301, 302]) {
    const e = toIntelligenceError({ status }, "anthropic");
    assert.equal("httpStatus" in e, false, `status ${status} must not be exposed`);
  }
});

test("toIntelligenceError: an out-of-range status (e.g. 700) is rejected — never exposed as httpStatus", () => {
  const e = toIntelligenceError({ status: 700 }, "anthropic");
  assert.equal(e.failureClass, "PROVIDER_UNKNOWN");
  assert.equal("httpStatus" in e, false);
});

test("toIntelligenceError: a string-shaped status (\"401\") is never coerced into an httpStatus", () => {
  const e = toIntelligenceError({ status: "401" }, "anthropic");
  // the existing `status` extraction itself only accepts typeof "number",
  // so a string status is not even classified as 4xx/5xx — falls through
  // to the generic fallback, and certainly never yields an httpStatus.
  assert.equal(e.code, "PROVIDER_ERROR");
  assert.equal(e.failureClass, "PROVIDER_UNKNOWN");
  assert.equal("httpStatus" in e, false);
});

test("toIntelligenceError: the unrecognizable-thrown-value fallback never carries an httpStatus", () => {
  const e = toIntelligenceError({ message: "boom" }, "anthropic");
  assert.equal(e.failureClass, "PROVIDER_UNKNOWN");
  assert.equal("httpStatus" in e, false);
});

test("toIntelligenceError: httpStatus, when present, never rides alongside any raw body/header text", () => {
  const e = toIntelligenceError({ status: 429, body: "Retry-After: 60; Authorization: Bearer sk-ant-LEAK" }, "anthropic");
  assert.equal(e.httpStatus, 429);
  const s = JSON.stringify(e);
  assert.equal(s.includes("Retry-After"), false);
  assert.equal(s.includes("Bearer"), false);
  assert.equal(s.includes("sk-ant-"), false);
});

// ---------------- V2: safe OpenAI provider-error metadata ----------------

test("validateProviderErrorType: accepts only members of the closed set", () => {
  for (const t of KNOWN_OPENAI_ERROR_TYPES) {
    assert.equal(validateProviderErrorType(t), t);
  }
  assert.equal(validateProviderErrorType("some_future_type"), undefined);
  assert.equal(validateProviderErrorType(""), undefined);
});

test("validateProviderErrorType: rejects non-string values without throwing", () => {
  for (const v of [123, null, undefined, {}, [], true, { type: "invalid_request_error" }]) {
    assert.equal(validateProviderErrorType(v), undefined);
  }
});

test("validateProviderErrorCode: accepts only members of the closed set", () => {
  for (const c of KNOWN_OPENAI_ERROR_CODES) {
    assert.equal(validateProviderErrorCode(c), c);
  }
  assert.equal(validateProviderErrorCode("some_future_code"), undefined);
});

test("validateProviderErrorCode: rejects non-string values without throwing", () => {
  for (const v of [123, null, undefined, {}, [], true]) {
    assert.equal(validateProviderErrorCode(v), undefined);
  }
});

test("validateProviderErrorParam: accepts a short field-path-shaped string", () => {
  assert.equal(validateProviderErrorParam("max_tokens"), "max_tokens");
  assert.equal(validateProviderErrorParam("messages[0].role"), "messages[0].role");
  assert.equal(validateProviderErrorParam("temperature"), "temperature");
});

test("validateProviderErrorParam: rejects an empty string, an oversized string, and unsafe characters", () => {
  assert.equal(validateProviderErrorParam(""), undefined);
  assert.equal(validateProviderErrorParam("x".repeat(65)), undefined);
  assert.equal(validateProviderErrorParam("x".repeat(64)).length, 64, "exactly 64 chars is still accepted");
  assert.equal(validateProviderErrorParam("max_tokens; DROP TABLE"), undefined);
  assert.equal(validateProviderErrorParam("max tokens"), undefined, "whitespace is rejected");
  assert.equal(validateProviderErrorParam("Authorization: Bearer sk-ant-LEAK"), undefined);
});

test("validateProviderErrorParam: rejects non-string values without throwing", () => {
  for (const v of [123, null, undefined, {}, [], true]) {
    assert.equal(validateProviderErrorParam(v), undefined);
  }
});

test("makeIntelligenceError: accepts and re-validates the 5th/6th/7th args (providerErrorType/Code/Param)", () => {
  const e = makeIntelligenceError("PROVIDER_ERROR", "openai", "PROVIDER_4XX", 400, "invalid_request_error", "unsupported_parameter", "max_tokens");
  assert.equal(e.providerErrorType, "invalid_request_error");
  assert.equal(e.providerErrorCode, "unsupported_parameter");
  assert.equal(e.providerErrorParam, "max_tokens");
});

test("makeIntelligenceError: SILENTLY drops unrecognized/malformed providerError* values — never throws, never attaches them", () => {
  const e = makeIntelligenceError("PROVIDER_ERROR", "openai", "PROVIDER_4XX", 400, "not_a_real_type", "not_a_real_code", "unsafe param!!");
  assert.equal("providerErrorType" in e, false);
  assert.equal("providerErrorCode" in e, false);
  assert.equal("providerErrorParam" in e, false);
});

test("makeIntelligenceError: 2-arg / 3-arg / 4-arg calls are still byte-identical (no providerError* keys at all)", () => {
  const e2 = makeIntelligenceError("PROVIDER_ERROR", "anthropic");
  const e4 = makeIntelligenceError("PROVIDER_ERROR", "anthropic", "PROVIDER_5XX", 503);
  for (const e of [e2, e4]) {
    assert.equal("providerErrorType" in e, false);
    assert.equal("providerErrorCode" in e, false);
    assert.equal("providerErrorParam" in e, false);
  }
});

test("makeIntelligenceError: never exposes error.message-shaped free text through providerError* — only the 3 explicit args are ever consulted", () => {
  const e = makeIntelligenceError("PROVIDER_ERROR", "openai", "PROVIDER_4XX", 400, "invalid_request_error", "unsupported_parameter", "max_tokens");
  const s = JSON.stringify(e);
  assert.equal(s.includes("DO NOT PROPAGATE"), false);
  assert.deepEqual(Object.keys(e).sort(), ["code", "failureClass", "httpStatus", "message", "providerErrorCode", "providerErrorParam", "providerErrorType", "providerId", "retryable"].sort());
});
