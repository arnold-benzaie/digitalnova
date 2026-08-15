// Pure unit tests for sanitizeGoogleAdsError()'s extraction of the
// structured Google Ads error shape — no network, no DB.
// Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/errors.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { sanitizeGoogleAdsError } = await import("./errors.ts");

test("extracts message/httpStatus/googleErrorStatus from a Google Ads REST error body", () => {
  const err = { response: { status: 400, data: { error: { status: "INVALID_ARGUMENT", message: "Request contains an invalid argument." } } } };
  const sanitized = sanitizeGoogleAdsError(err);
  assert.equal(sanitized.message, "Request contains an invalid argument.");
  assert.equal(sanitized.httpStatus, 400);
  assert.equal(sanitized.googleErrorStatus, "INVALID_ARGUMENT");
});

test("extracts googleErrorCode from error.details[].errors[].errorCode regardless of its category key", () => {
  const err = {
    response: {
      status: 403,
      data: {
        error: {
          status: "PERMISSION_DENIED",
          message: "The caller does not have permission",
          details: [
            {
              "@type": "type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
              errors: [{ errorCode: { authorizationError: "CUSTOMER_NOT_ENABLED" }, message: "The customer account can't be accessed..." }],
              requestId: "abc123",
            },
          ],
        },
      },
    },
  };
  const sanitized = sanitizeGoogleAdsError(err);
  assert.equal(sanitized.googleErrorCode, "CUSTOMER_NOT_ENABLED");
  assert.equal(sanitized.requestId, "abc123");
});

test("extracts googleErrorCode for a different error category (queryError), same shape", () => {
  const err = {
    response: {
      status: 400,
      data: { error: { status: "INVALID_ARGUMENT", message: "bad query", details: [{ errors: [{ errorCode: { queryError: "UNRECOGNIZED_FIELD" } }] }] } },
    },
  };
  assert.equal(sanitizeGoogleAdsError(err).googleErrorCode, "UNRECOGNIZED_FIELD");
});

test("googleErrorCode/requestId are undefined when details are absent — never throws on a minimal error body", () => {
  const sanitized = sanitizeGoogleAdsError({ response: { status: 500, data: { error: { message: "Internal error" } } } });
  assert.equal(sanitized.googleErrorCode, undefined);
  assert.equal(sanitized.requestId, undefined);
});

test("falls back cleanly on a plain Error with no response body at all", () => {
  const sanitized = sanitizeGoogleAdsError(new Error("network failure"));
  assert.equal(sanitized.message, "network failure");
  assert.equal(sanitized.httpStatus, undefined);
  assert.equal(sanitized.googleErrorStatus, undefined);
  assert.equal(sanitized.googleErrorCode, undefined);
  assert.equal(sanitized.requestId, undefined);
});

test("malformed/unexpected details shapes never throw — degrade to undefined fields", () => {
  assert.doesNotThrow(() => sanitizeGoogleAdsError({ response: { data: { error: { details: "not an array" } } } }));
  assert.doesNotThrow(() => sanitizeGoogleAdsError({ response: { data: { error: { details: [{ errors: "not an array" }] } } } }));
  assert.doesNotThrow(() => sanitizeGoogleAdsError({ response: { data: { error: { details: [{ errors: [{ errorCode: "not an object" }] }] } } } }));
});
