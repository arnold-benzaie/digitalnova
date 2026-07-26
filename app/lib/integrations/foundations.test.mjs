import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

mock.module("server-only", { defaultExport: {} });

let workerCalls = 0;
mock.module("@/lib/integrations/worker", {
  namedExports: {
    runIntegrationWebhookWorker: async () => {
      workerCalls += 1;
      return { outbox: { claimed: 0, materialized: 0 }, deliveries: { claimed: 0, counts: {} } };
    },
  },
});

const {
  decryptIntegrationValue,
  encryptIntegrationValue,
  generateIntegrationApiKey,
  generateWebhookSecret,
  signWebhookBody,
  verifyIntegrationApiKey,
} = await import("@/lib/integrations/crypto");
const { userPendingCreatedEnvelope, serializeIntegrationEvent } = await import("@/lib/integrations/contracts");
const { isForbiddenNetworkAddress, validateWebhookUrl } = await import("@/lib/integrations/url-security");
const { INTEGRATION_SCOPES, INTEGRATION_EVENT_CATALOG } = await import("@/lib/integrations/governance");
const { GET: runWorkerRoute } = await import("@/app/api/cron/integration-webhooks/route");

function randomEncryptionKey() {
  return randomBytes(32).toString("base64");
}

test("API keys use a public lookup id and only a one-way hash is persisted", () => {
  const pepper = randomBytes(32).toString("base64url");
  const generated = generateIntegrationApiKey("test", pepper);

  assert.match(generated.plaintextKey, /^pm_test_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
  assert.equal(generated.keyHash.length, 64);
  assert.equal(generated.keyHash.includes(generated.plaintextKey), false);
  assert.equal(generated.keyPrefix.includes(generated.plaintextKey), false);
  assert.equal(verifyIntegrationApiKey(generated.plaintextKey, generated.keyHash, pepper), true);
  assert.equal(verifyIntegrationApiKey(`${generated.plaintextKey}x`, generated.keyHash, pepper), false);
});

test("webhook URL and endpoint secret use authenticated AES-256-GCM encryption", () => {
  const key = randomEncryptionKey();
  const value = generateWebhookSecret();
  const context = `endpoint:${randomUUID()}`;
  const encrypted = encryptIntegrationValue(value, context, key);

  assert.notEqual(encrypted.ciphertext, value);
  assert.equal(JSON.stringify(encrypted).includes(value), false);
  assert.equal(decryptIntegrationValue(encrypted, context, key), value);
  assert.throws(() => decryptIntegrationValue(encrypted, `${context}:wrong`, key), /could not be decrypted/);
});

test("HMAC signature is reproducible from the exact raw body", () => {
  const secret = generateWebhookSecret();
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const envelope = userPendingCreatedEnvelope({
    id: randomUUID(),
    occurredAt: new Date(),
    userId: randomUUID(),
    displayName: "Pending Test",
  });
  const rawBody = serializeIntegrationEvent(envelope);
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");

  assert.equal(signWebhookBody(secret, timestamp, rawBody), `sha256=${expected}`);
  assert.notEqual(signWebhookBody(secret, timestamp, `${rawBody} `), `sha256=${expected}`);
});

test("user.pending.created contract contains only approved minimal fields", () => {
  const envelope = userPendingCreatedEnvelope({
    id: randomUUID(),
    occurredAt: new Date(),
    userId: randomUUID(),
    displayName: "Pending Test",
  });
  const raw = serializeIntegrationEvent(envelope);

  assert.deepEqual(Object.keys(envelope), ["id", "type", "version", "occurredAt", "data"]);
  assert.deepEqual(Object.keys(envelope.data), ["userId", "displayName", "adminPath"]);
  assert.equal(Object.hasOwn(envelope.data, "email"), false);
  assert.equal(Object.hasOwn(envelope.data, "clerkUserId"), false);
  assert.equal(Object.hasOwn(envelope, "secret"), false);
  assert.equal(raw.includes("@"), false);
});

test("governance catalog is closed to the six approved scopes and one event", () => {
  assert.deepEqual(INTEGRATION_SCOPES, [
    "audits:read",
    "reports:read",
    "clients:read",
    "clients:update",
    "tasks:create",
    "interactions:create",
  ]);
  assert.deepEqual(Object.keys(INTEGRATION_EVENT_CATALOG), ["user.pending.created"]);
});

test("URL policy allows a public HTTPS endpoint after DNS validation", async () => {
  const url = await validateWebhookUrl("https://hooks.example.test/incoming", {
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(url.protocol, "https:");
});

test("URL policy blocks insecure, local, private, link-local and metadata destinations", async () => {
  const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
  const privateResolver = async () => [{ address: "10.0.0.4", family: 4 }];

  await assert.rejects(() => validateWebhookUrl("http://hooks.example.test", { resolver: publicResolver }), /allowed public HTTPS/);
  await assert.rejects(() => validateWebhookUrl("https://localhost/hook", { resolver: publicResolver }), /allowed public HTTPS/);
  await assert.rejects(() => validateWebhookUrl("https://127.0.0.1/hook", { resolver: publicResolver }), /allowed public HTTPS/);
  await assert.rejects(() => validateWebhookUrl("https://[::1]/hook", { resolver: publicResolver }), /allowed public HTTPS/);
  await assert.rejects(() => validateWebhookUrl("https://[0:0:0:0:0:0:0:1]/hook", { resolver: publicResolver }), /allowed public HTTPS/);
  await assert.rejects(() => validateWebhookUrl("https://metadata.google.internal/hook", { resolver: publicResolver }), /allowed public HTTPS/);
  await assert.rejects(() => validateWebhookUrl("https://rebinding.example.test/hook", { resolver: privateResolver }), /allowed public HTTPS/);
  assert.equal(isForbiddenNetworkAddress("169.254.169.254"), true);
  assert.equal(isForbiddenNetworkAddress("192.168.1.20"), true);
  assert.equal(isForbiddenNetworkAddress("fc00::42"), true);
  assert.equal(isForbiddenNetworkAddress("fe80::42"), true);
  assert.equal(isForbiddenNetworkAddress("0:0:0:0:0:0:0:1"), true);
  assert.equal(isForbiddenNetworkAddress("93.184.216.34"), false);
  assert.equal(isForbiddenNetworkAddress("2606:4700:4700::1111"), false);
});

test("internal worker route fails closed and accepts only CRON_SECRET", async () => {
  const original = process.env.CRON_SECRET;
  const cronSecret = randomBytes(32).toString("base64url");
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await runWorkerRoute(new Request("https://app.example.test/api/cron/integration-webhooks"))).status, 503);

    process.env.CRON_SECRET = cronSecret;
    assert.equal((await runWorkerRoute(new Request("https://app.example.test/api/cron/integration-webhooks"))).status, 401);
    const authorized = await runWorkerRoute(new Request("https://app.example.test/api/cron/integration-webhooks", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    }));
    assert.equal(authorized.status, 200);
    assert.equal(workerCalls, 1);
  } finally {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  }
});
