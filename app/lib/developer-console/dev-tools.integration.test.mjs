// Integration tests for lib/developer-console/dev-tools.ts — the Stage 4
// Playground / Webhook test tool / signature verifier / API key format
// inspector server actions.
//
// Same session-mocking convention as lib/developer-console/actions.integration.test.mjs.
// sendAdhocWebhookTest is only exercised on its REJECTION path here (a
// malformed or SSRF-unsafe URL never reaches fetch() or logAudit(), so no
// real network call or DB write happens) — a real successful delivery
// against a real public HTTPS target is covered by manual "real HTTP
// test" verification, not this automated suite, exactly like
// lib/integrations/webhook-system.integration.test.mjs only exercises the
// SSRF-rejection path automatically for the same reason.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/developer-console/dev-tools.integration.test.mjs
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_API_KEY_PEPPER = "developer-console-test-pepper-not-a-real-secret";

mock.module("server-only", { defaultExport: {} });

let currentSession = {
  userId: "test-user-id",
  clerkUserId: "test_clerk_id",
  email: "dev@example.com",
  fullName: "Dev Tools Test User",
  organizationId: "test-org-id",
  organizationName: "Dev Tools Test Org",
  role: "client",
};

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => currentSession,
  },
});

let currentLocale = "fr";
mock.module("@/lib/i18n/locale", {
  namedExports: {
    getLocale: async () => currentLocale,
  },
});

const {
  sendAdhocWebhookTest,
  verifyWebhookSignatureAction,
  inspectApiKeyFormatAction,
} = await import("./dev-tools.ts");
const { signWebhookBody, generateIntegrationApiKey } = await import("@/lib/integrations/crypto");
const { db } = await import("@/db");

function formDataOf(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) formData.set(key, value);
  }
  return formData;
}

before(() => {
  currentLocale = "fr";
});

after(async () => {
  await db.$client.end();
});

test("sendAdhocWebhookTest: rejects a non-HTTPS URL before ever calling fetch", async () => {
  await assert.rejects(
    () => sendAdhocWebhookTest(formDataOf({ url: "http://example.com/webhook" })),
    /HTTPS|autoris/i,
  );
});

test("sendAdhocWebhookTest: rejects a loopback/private URL (SSRF guard) even over HTTPS", async () => {
  await assert.rejects(
    () => sendAdhocWebhookTest(formDataOf({ url: "https://127.0.0.1/webhook" })),
    /autoris/i,
  );
  await assert.rejects(
    () => sendAdhocWebhookTest(formDataOf({ url: "https://localhost/webhook" })),
    /autoris/i,
  );
  await assert.rejects(
    () => sendAdhocWebhookTest(formDataOf({ url: "https://169.254.169.254/latest/meta-data" })),
    /autoris/i,
    "cloud metadata endpoint must be blocked, exactly like real webhook endpoints",
  );
});

test("sendAdhocWebhookTest: rejects a syntactically invalid URL — same message as an unsafe one, by design (see url-security.ts's UnsafeWebhookUrlError)", async () => {
  await assert.rejects(() => sendAdhocWebhookTest(formDataOf({ url: "not a url" })), /invalide|autoris/i);
});

test("sendAdhocWebhookTest: an EN session sees the English rejection message", async () => {
  currentLocale = "en";
  await assert.rejects(
    () => sendAdhocWebhookTest(formDataOf({ url: "https://127.0.0.1/webhook" })),
    /allowed/i,
  );
  currentLocale = "fr";
});

test("verifyWebhookSignatureAction: a correctly-signed body verifies as valid", async () => {
  const secret = "test-secret-value";
  const timestamp = "1700000000";
  const body = JSON.stringify({ hello: "world" });
  const signature = signWebhookBody(secret, timestamp, body);

  const result = await verifyWebhookSignatureAction(formDataOf({ secret, timestamp, body, signature }));
  assert.equal(result.valid, true);
  assert.equal(result.expectedSignature, signature);
});

test("verifyWebhookSignatureAction: a tampered body is reported invalid, never throws", async () => {
  const secret = "test-secret-value";
  const timestamp = "1700000000";
  const originalBody = JSON.stringify({ hello: "world" });
  const signature = signWebhookBody(secret, timestamp, originalBody);
  const tamperedBody = JSON.stringify({ hello: "tampered" });

  const result = await verifyWebhookSignatureAction(formDataOf({ secret, timestamp, body: tamperedBody, signature }));
  assert.equal(result.valid, false);
  assert.notEqual(result.expectedSignature, signature);
});

test("verifyWebhookSignatureAction: a wrong secret is reported invalid", async () => {
  const timestamp = "1700000000";
  const body = JSON.stringify({ hello: "world" });
  const signature = signWebhookBody("real-secret", timestamp, body);

  const result = await verifyWebhookSignatureAction(formDataOf({ secret: "wrong-secret", timestamp, body, signature }));
  assert.equal(result.valid, false);
});

test("verifyWebhookSignatureAction: rejects when a required field is missing", async () => {
  await assert.rejects(
    () => verifyWebhookSignatureAction(formDataOf({ timestamp: "1700000000", body: "{}", signature: "sha256=abc" })),
    /secret/i,
  );
  await assert.rejects(
    () => verifyWebhookSignatureAction(formDataOf({ secret: "s", body: "{}", signature: "sha256=abc" })),
    /horodatage|timestamp/i,
  );
  await assert.rejects(
    () => verifyWebhookSignatureAction(formDataOf({ secret: "s", timestamp: "1700000000", body: "{}" })),
    /signature/i,
  );
});

test("inspectApiKeyFormatAction: a real generated key reports valid with the correct environment/prefix/lookupId", async () => {
  const generated = generateIntegrationApiKey("live");
  const result = await inspectApiKeyFormatAction(formDataOf({ key: generated.plaintextKey }));
  assert.deepEqual(result, {
    valid: true,
    environment: "live",
    keyPrefix: generated.keyPrefix,
    lookupId: generated.lookupId,
  });
});

test("inspectApiKeyFormatAction: a test-environment key is correctly identified", async () => {
  const generated = generateIntegrationApiKey("test");
  const result = await inspectApiKeyFormatAction(formDataOf({ key: generated.plaintextKey }));
  assert.equal(result.valid, true);
  assert.equal(result.environment, "test");
});

test("inspectApiKeyFormatAction: malformed keys are reported invalid, never throw", async () => {
  for (const badKey of ["", "not-a-key", "pm_live_tooshort", "pm_staging_abcdefghijkl_secret", "pm_live_abcdefghijkl"]) {
    const result = await inspectApiKeyFormatAction(formDataOf({ key: badKey }));
    assert.deepEqual(result, { valid: false }, `expected "${badKey}" to be reported invalid`);
  }
});
