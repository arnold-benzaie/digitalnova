import { mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { defaultExport: {} });
// Never actually connected to — these tests only exercise the pure
// parsing/envelope helpers, not authenticateApiRequest's DB queries.
process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";
process.env.INTEGRATION_API_KEY_PEPPER ??= "unit-test-pepper";

const { ApiAuthError, extractApiKeyFromRequest, parseApiKey } = await import("@/lib/api-v1/auth");
const { generateIntegrationApiKey } = await import("@/lib/integrations/crypto");

test("parseApiKey: accepts a real generated key (live)", () => {
  const generated = generateIntegrationApiKey("live", "pepper");
  const parsed = parseApiKey(generated.plaintextKey);
  assert.ok(parsed);
  assert.equal(parsed.environment, "live");
  assert.equal(parsed.lookupId, generated.lookupId);
  assert.equal(parsed.keyPrefix, generated.keyPrefix);
});

test("parseApiKey: accepts a real generated key (test)", () => {
  const generated = generateIntegrationApiKey("test", "pepper");
  const parsed = parseApiKey(generated.plaintextKey);
  assert.ok(parsed);
  assert.equal(parsed.environment, "test");
});

test("parseApiKey: never uses delimiter-splitting — a secret containing literal underscores still parses correctly", () => {
  // base64url's alphabet includes "_"; construct a key whose secret portion
  // is deliberately underscore-heavy to prove position-based parsing (not
  // .split("_")) is what's actually running.
  const lookupId = "AbCdEfGhIjKl"; // exactly 12 chars, as generateIntegrationApiKey always produces
  const secretWithUnderscores = "___a_b_c___d_e_f___________________________"; // 45 chars, all noise
  const key = `pm_live_${lookupId}_${secretWithUnderscores}`;
  const parsed = parseApiKey(key);
  assert.ok(parsed, "a key whose secret is full of underscores must still parse");
  assert.equal(parsed.lookupId, lookupId);
  assert.equal(parsed.keyPrefix, `pm_live_${lookupId}`);
});

test("parseApiKey: rejects a key not starting with pm_", () => {
  assert.equal(parseApiKey("sk_live_abcdefghijkl_secret"), null);
});

test("parseApiKey: rejects an unknown environment word", () => {
  assert.equal(parseApiKey("pm_staging_abcdefghijkl_secret"), null);
});

test("parseApiKey: rejects a lookupId shorter than 12 characters", () => {
  assert.equal(parseApiKey("pm_live_short_secret"), null);
});

test("parseApiKey: rejects when the 13th character after the env isn't the expected separator", () => {
  // 12 chars immediately after "pm_live_" but followed by something other than "_"
  assert.equal(parseApiKey("pm_live_abcdefghijklXsecret"), null);
});

test("parseApiKey: rejects a key with no secret after the separator", () => {
  assert.equal(parseApiKey("pm_live_abcdefghijkl_"), null);
});

test("parseApiKey: rejects non-string input", () => {
  assert.equal(parseApiKey(undefined), null);
  assert.equal(parseApiKey(null), null);
  assert.equal(parseApiKey(42), null);
  assert.equal(parseApiKey(""), null);
});

test("extractApiKeyFromRequest: reads Authorization: Bearer", () => {
  const request = new Request("https://example.com/api/v1/ping", { headers: { authorization: "Bearer pm_live_abc" } });
  assert.equal(extractApiKeyFromRequest(request), "pm_live_abc");
});

test("extractApiKeyFromRequest: Bearer is case-insensitive", () => {
  const request = new Request("https://example.com/api/v1/ping", { headers: { authorization: "bearer pm_live_abc" } });
  assert.equal(extractApiKeyFromRequest(request), "pm_live_abc");
});

test("extractApiKeyFromRequest: falls back to X-Api-Key when Authorization is absent", () => {
  const request = new Request("https://example.com/api/v1/ping", { headers: { "x-api-key": "pm_live_abc" } });
  assert.equal(extractApiKeyFromRequest(request), "pm_live_abc");
});

test("extractApiKeyFromRequest: Authorization: Bearer takes priority over X-Api-Key when both are present", () => {
  const request = new Request("https://example.com/api/v1/ping", {
    headers: { authorization: "Bearer pm_live_from_bearer", "x-api-key": "pm_live_from_x_api_key" },
  });
  assert.equal(extractApiKeyFromRequest(request), "pm_live_from_bearer");
});

test("extractApiKeyFromRequest: returns null when neither header is present", () => {
  const request = new Request("https://example.com/api/v1/ping");
  assert.equal(extractApiKeyFromRequest(request), null);
});

test("extractApiKeyFromRequest: an Authorization header that isn't Bearer-shaped falls back to X-Api-Key", () => {
  const request = new Request("https://example.com/api/v1/ping", {
    headers: { authorization: "Basic dXNlcjpwYXNz", "x-api-key": "pm_live_fallback" },
  });
  assert.equal(extractApiKeyFromRequest(request), "pm_live_fallback");
});

test("ApiAuthError: carries the right HTTP status per code", () => {
  assert.equal(new ApiAuthError("MISSING_API_KEY", "x").status, 401);
  assert.equal(new ApiAuthError("FORBIDDEN_SCOPE", "x").status, 403);
  assert.equal(new ApiAuthError("SERVICE_NOT_CONFIGURED", "x").status, 503);
});
