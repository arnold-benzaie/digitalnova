// Targeted unit tests for lib/google/oauth.ts's createGoogleOAuthClient()
// — P1 network audit (2026-10).
//
// CORRECTION (same audit, same day): an earlier version of this file
// asserted that createGoogleOAuthClient() "never sets retry/retryConfig",
// framing that as proof getToken()/refreshAccessToken() never retry.
// That is false, and the fix is NOT to that production code (it never
// added or changed any retry behavior) but to this test's claim.
// Verified directly in the installed google-auth-library@10.5.0 source
// (node_modules/google-auth-library/build/src/auth/oauth2client.js:
// getTokenAsync/refreshTokenNoCache both build their request `opts` as
// `{ ...OAuth2Client.RETRY_CONFIG, method: 'POST', ... }`, and
// AuthClient.RETRY_CONFIG — node_modules/.../authclient.js:276-282 —
// returns `{ retry: true, retryConfig: { httpMethodsToRetry: ['GET',
// 'PUT','POST','HEAD','OPTIONS','DELETE'] } }`, POST included). That
// injection happens INSIDE google-auth-library's own request-building
// code, entirely separate from — and unaffected by — whatever
// createGoogleOAuthClient() passes to the constructor. It was already
// true before this P1 work and remains true after it; this file now
// documents that fact instead of contradicting it.
//
// What's still correctly tested below: the request TIMEOUT genuinely
// flows through (createGoogleOAuthClient()'s own, real addition), and —
// robustly, by reading the REAL, un-mocked google-auth-library class's
// own public static getter rather than re-deriving/guessing at its
// behavior — that retry for these two calls is governed by the library
// itself, not by this module's constructor options.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { OAuth2Client } from "google-auth-library";

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://user:pass@localhost:1/never_queried_in_this_test";

let capturedOptions;
mock.module("googleapis", {
  namedExports: {
    google: {
      auth: {
        OAuth2: class {
          constructor(options) {
            capturedOptions = options;
          }
        },
      },
    },
  },
});

const { createGoogleOAuthClient, GOOGLE_API_REQUEST_TIMEOUT_MS } = await import("./oauth.ts");

test("createGoogleOAuthClient throws if GOOGLE_CLIENT_ID/SECRET are not configured", () => {
  const prevId = process.env.GOOGLE_CLIENT_ID;
  const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    assert.throws(() => createGoogleOAuthClient());
  } finally {
    if (prevId !== undefined) process.env.GOOGLE_CLIENT_ID = prevId;
    if (prevSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = prevSecret;
  }
});

test("createGoogleOAuthClient sets a request timeout via transporterOptions", () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  capturedOptions = undefined;

  createGoogleOAuthClient();

  assert.ok(capturedOptions, "the OAuth2 constructor must have been called");
  assert.deepEqual(capturedOptions.transporterOptions, { timeout: GOOGLE_API_REQUEST_TIMEOUT_MS });
  assert.equal(GOOGLE_API_REQUEST_TIMEOUT_MS, 8000, "sanity check on the exported constant itself");
});

test("createGoogleOAuthClient itself never sets retry/retryConfig at the constructor level — it only ever adds the timeout", () => {
  // This is the full and correct scope of what createGoogleOAuthClient()
  // controls: it does not add, remove, or otherwise touch retry behavior
  // for getToken()/refreshAccessToken() — see the next test for what
  // actually governs their retry behavior.
  capturedOptions = undefined;
  createGoogleOAuthClient();

  assert.ok(capturedOptions);
  assert.equal("retry" in capturedOptions, false, "createGoogleOAuthClient itself sets no top-level retry flag");
  assert.equal("retryConfig" in capturedOptions, false, "createGoogleOAuthClient itself sets no top-level retryConfig");
  assert.ok(capturedOptions.transporterOptions);
  assert.deepEqual(Object.keys(capturedOptions.transporterOptions), ["timeout"], "transporterOptions carries only the timeout");
});

test("documents the REAL retry behavior of getToken()/refreshAccessToken(): governed by google-auth-library's own OAuth2Client.RETRY_CONFIG, not by createGoogleOAuthClient()'s constructor options", () => {
  // Reads the real, un-mocked google-auth-library package's own public
  // static getter directly — not a re-derivation of internal source
  // lines, and not dependent on any private/unstable implementation
  // detail: OAuth2Client.RETRY_CONFIG is the exact object spread into
  // every getToken()/refreshAccessToken() request by the library itself
  // (verified against oauth2client.js — see this file's header comment).
  // This is the one, real decision point for retry on these two calls;
  // createGoogleOAuthClient() (tested above) has no influence over it.
  const retryConfig = OAuth2Client.RETRY_CONFIG;

  assert.equal(retryConfig.retry, true, "google-auth-library enables retry by default for getToken()/refreshAccessToken()");
  assert.ok(retryConfig.retryConfig?.httpMethodsToRetry, "a method allowlist is present");
  assert.ok(
    retryConfig.retryConfig.httpMethodsToRetry.includes("POST"),
    "POST is included — both getToken() and refreshAccessToken() are POST requests, so they ARE retried by the library's own default, independently of anything this codebase configures",
  );
});

test("createGoogleOAuthClient passes the credentials/redirect URI through unchanged (behavior preserved, only the constructor call shape changed)", () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  capturedOptions = undefined;

  createGoogleOAuthClient();

  assert.equal(capturedOptions.clientId, "test-client-id");
  assert.equal(capturedOptions.clientSecret, "test-client-secret");
  assert.equal(typeof capturedOptions.redirectUri, "string");
});
