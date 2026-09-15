// RADAR DISCOVERY ENGINE — Phase C-0 — errors.ts unit tests. Pure, no
// mocks, no network. Covers mission section 18 item L (retryable vs
// non-retryable classification) and the general error-model contract.
//
// Run: npx tsx --test lib/radar-discovery/errors.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_ERROR_CODES,
  isDiscoveryErrorCode,
  isRetryableDiscoveryErrorCode,
  makeDiscoveryError,
  noCapableProviderError,
  RETRYABLE_DISCOVERY_ERROR_CODES,
  SAFE_DISCOVERY_ERROR_MESSAGES,
  toDiscoveryError,
} from "./errors.ts";

test("isDiscoveryErrorCode: accepts every real code, rejects anything else", () => {
  for (const code of DISCOVERY_ERROR_CODES) assert.equal(isDiscoveryErrorCode(code), true);
  assert.equal(isDiscoveryErrorCode("NOT_A_REAL_CODE"), false);
  assert.equal(isDiscoveryErrorCode(123), false);
  assert.equal(isDiscoveryErrorCode(null), false);
});

// ---- L. retryable vs non-retryable classification ----

test("L. retryable codes are exactly PROVIDER_TIMEOUT, PROVIDER_RATE_LIMITED, PROVIDER_UNAVAILABLE — never a deterministic failure of intent", () => {
  assert.equal(isRetryableDiscoveryErrorCode("PROVIDER_TIMEOUT"), true);
  assert.equal(isRetryableDiscoveryErrorCode("PROVIDER_RATE_LIMITED"), true);
  assert.equal(isRetryableDiscoveryErrorCode("PROVIDER_UNAVAILABLE"), true);
  assert.equal(isRetryableDiscoveryErrorCode("PROVIDER_ERROR"), false);
  assert.equal(isRetryableDiscoveryErrorCode("NO_CAPABLE_PROVIDER"), false, "retrying a 'nothing configured' state can never succeed");
  assert.equal(isRetryableDiscoveryErrorCode("INVALID_SEARCH_REQUEST"), false, "retrying a malformed request can never succeed");
});

test("RETRYABLE_DISCOVERY_ERROR_CODES and isRetryableDiscoveryErrorCode agree for every code", () => {
  for (const code of DISCOVERY_ERROR_CODES) {
    assert.equal(isRetryableDiscoveryErrorCode(code), RETRYABLE_DISCOVERY_ERROR_CODES.has(code));
  }
});

test("makeDiscoveryError: retryable flag is derived automatically from the code, never settable by the caller", () => {
  const retryable = makeDiscoveryError("PROVIDER_TIMEOUT");
  assert.equal(retryable.retryable, true);
  const notRetryable = makeDiscoveryError("INVALID_SEARCH_REQUEST");
  assert.equal(notRetryable.retryable, false);
});

test("makeDiscoveryError: message is always the fixed, safe, code-indexed copy", () => {
  for (const code of DISCOVERY_ERROR_CODES) {
    const err = makeDiscoveryError(code);
    assert.equal(err.message, SAFE_DISCOVERY_ERROR_MESSAGES[code]);
  }
});

test("makeDiscoveryError: an invalid httpStatus (out of 400-599, or a string) is silently dropped, never attached", () => {
  const err1 = makeDiscoveryError("PROVIDER_ERROR", "google_places", "PROVIDER_4XX", 200);
  assert.equal(err1.httpStatus, undefined);
  const err2 = makeDiscoveryError("PROVIDER_ERROR", "google_places", "PROVIDER_4XX", "404");
  assert.equal(err2.httpStatus, undefined);
});

test("makeDiscoveryError: a valid httpStatus (400-599 integer) is kept", () => {
  const err = makeDiscoveryError("PROVIDER_ERROR", "google_places", "PROVIDER_4XX", 404);
  assert.equal(err.httpStatus, 404);
});

// ---- I. generic provider error -> internal error (transport-level) ----

test("I. toDiscoveryError: AbortError/TimeoutError -> PROVIDER_TIMEOUT", () => {
  assert.equal(toDiscoveryError({ name: "AbortError" }).code, "PROVIDER_TIMEOUT");
  assert.equal(toDiscoveryError({ name: "TimeoutError" }).code, "PROVIDER_TIMEOUT");
});

test("I. toDiscoveryError: HTTP 429 -> PROVIDER_RATE_LIMITED", () => {
  const err = toDiscoveryError({ status: 429 });
  assert.equal(err.code, "PROVIDER_RATE_LIMITED");
  assert.equal(err.failureClass, "PROVIDER_4XX");
  assert.equal(err.httpStatus, 429);
});

test("I. toDiscoveryError: HTTP 502/503/504 -> PROVIDER_UNAVAILABLE", () => {
  for (const status of [502, 503, 504]) {
    assert.equal(toDiscoveryError({ status }).code, "PROVIDER_UNAVAILABLE");
  }
});

test("I. toDiscoveryError: an unrecognized/generic thrown value -> PROVIDER_ERROR with PROVIDER_UNKNOWN class, never leaks the raw value", () => {
  const err = toDiscoveryError(new Error("some raw provider text containing sk-ant-LEAK"));
  assert.equal(err.code, "PROVIDER_ERROR");
  assert.equal(err.failureClass, "PROVIDER_UNKNOWN");
  assert.ok(!JSON.stringify(err).includes("sk-ant-LEAK"), "raw error text must never leak into the safe error object");
});

test("toDiscoveryError: providerId is carried through unchanged", () => {
  const err = toDiscoveryError({ status: 429 }, "google_places");
  assert.equal(err.providerId, "google_places");
});

test("noCapableProviderError: fixed shape, never retryable", () => {
  const err = noCapableProviderError();
  assert.equal(err.code, "NO_CAPABLE_PROVIDER");
  assert.equal(err.retryable, false);
  assert.equal(err.providerId, null);
});
