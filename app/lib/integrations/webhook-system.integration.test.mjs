// Full integration coverage against the isolated Docker database used by the
// approval suite. No Preview/Production URL is read and every HTTP delivery is
// replaced with an in-process test double.
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.INTEGRATION_API_KEY_PEPPER = randomBytes(32).toString("base64url");

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const {
  integrationEvents,
  integrations,
  notifications,
  organizations,
  users,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints,
  webhookEndpointSecrets,
  webhookSubscriptions,
} = await import("@/db/schema");
const { and, eq, inArray, sql } = await import("drizzle-orm");
const { createWebhookEndpoint } = await import("@/lib/integrations/endpoints");
const { encryptIntegrationValue, generateWebhookSecret, webhookUrlHash } = await import("@/lib/integrations/crypto");
const { materializePendingIntegrationEvents } = await import("@/lib/integrations/outbox");
const {
  MAX_WEBHOOK_ATTEMPTS,
  WEBHOOK_ATTEMPT_DELAYS_MS,
  processWebhookDeliveries,
} = await import("@/lib/integrations/worker");
const { registerPendingUser } = await import("@/lib/pending-user-registration");

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];
const fixtureUserIds = new Set();
const fixtureIntegrationIds = new Set();
let internalOrganizationId;
let createdInternalOrganizationId = null;

async function pendingNotificationRows(userId) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.type, "user.pending_approval"), sql`${notifications.metadata}->>'userId' = ${userId}`));
}

async function userEventRows(userId) {
  return db.select().from(integrationEvents).where(eq(integrationEvents.aggregateId, userId));
}

async function registerFixture(fullName = "Pending Integration User") {
  const input = {
    clerkUserId: `integration_${randomUUID()}`,
    email: `${randomUUID()}@integration.invalid`,
    fullName,
    firstName: fullName?.split(" ")[0] ?? null,
    lastName: fullName?.split(" ").slice(1).join(" ") || null,
  };
  const result = await registerPendingUser(input);
  if (result.user) fixtureUserIds.add(result.user.id);
  return { input, result };
}

async function createIntegration(name = "Automation test") {
  const [integration] = await db
    .insert(integrations)
    .values({ organizationId: internalOrganizationId, name: `${name} ${randomUUID()}`, type: "automation" })
    .returning();
  fixtureIntegrationIds.add(integration.id);
  return integration;
}

async function createSubscribedEndpoint(options = {}) {
  const integration = options.integration ?? await createIntegration();
  const created = await createWebhookEndpoint({
    integrationId: integration.id,
    name: options.name ?? "Endpoint test",
    url: options.url ?? `https://hooks.example.test/${randomUUID()}`,
    subscriptions: options.subscriptions ?? [{ type: "user.pending.created", version: 1 }],
    resolver: PUBLIC_RESOLVER,
  });
  return { integration, ...created };
}

async function prepareDelivery() {
  const endpoint = await createSubscribedEndpoint();
  const registration = await registerFixture();
  await materializePendingIntegrationEvents();
  const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, registration.result.eventId)).limit(1);
  assert.ok(delivery);
  return { ...endpoint, ...registration, delivery };
}

async function deliveryById(id) {
  return (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1))[0];
}

before(async () => {
  const [existing] = await db.select().from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  if (existing) {
    internalOrganizationId = existing.id;
    return;
  }
  const [created] = await db
    .insert(organizations)
    .values({ name: `PUBLIC-MAP integration tests ${randomUUID()}`, isInternal: true })
    .returning();
  internalOrganizationId = created.id;
  createdInternalOrganizationId = created.id;
});

afterEach(async () => {
  if (fixtureIntegrationIds.size > 0) {
    await db.delete(integrations).where(inArray(integrations.id, [...fixtureIntegrationIds]));
    fixtureIntegrationIds.clear();
  }
  for (const userId of fixtureUserIds) {
    await db.delete(integrationEvents).where(eq(integrationEvents.aggregateId, userId));
    await db.delete(notifications).where(sql`${notifications.metadata}->>'userId' = ${userId}`);
    await db.delete(users).where(eq(users.id, userId));
  }
  fixtureUserIds.clear();
});

after(async () => {
  if (createdInternalOrganizationId) {
    await db.delete(organizations).where(eq(organizations.id, createdInternalOrganizationId));
  }
  await db.$client.end();
});

test("pending registration atomically creates one user, notification and outbox event without HTTP", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("HTTP must not run during registration");
  };
  try {
    const { input, result } = await registerFixture();
    const notificationRows = await pendingNotificationRows(result.user.id);
    const eventRows = await userEventRows(result.user.id);

    assert.equal(result.created, true);
    assert.equal(result.user.status, "pending");
    assert.equal(notificationRows.length, 1);
    assert.equal(eventRows.length, 1);
    assert.equal(result.notificationId, notificationRows[0].id);
    assert.equal(result.eventId, notificationRows[0].id);
    assert.equal(eventRows[0].id, notificationRows[0].id);
    assert.equal(eventRows[0].type, "user.pending.created");
    assert.equal(eventRows[0].data.userId, result.user.id);
    assert.equal(eventRows[0].data.displayName, result.user.fullName);
    assert.equal(Object.hasOwn(eventRows[0].data, "email"), false);
    assert.equal(Object.hasOwn(eventRows[0].data, "clerkUserId"), false);
    assert.equal(JSON.stringify(eventRows[0]).includes(input.email), false);
    assert.equal(JSON.stringify(eventRows[0]).includes(input.clerkUserId), false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("two concurrent first sign-ins create only one logical event and eventId", async () => {
  const input = {
    clerkUserId: `concurrent_${randomUUID()}`,
    email: `${randomUUID()}@integration.invalid`,
    fullName: null,
    firstName: null,
    lastName: null,
  };
  const [first, second] = await Promise.all([registerPendingUser(input), registerPendingUser(input)]);
  const user = first.user ?? second.user;
  assert.ok(user);
  fixtureUserIds.add(user.id);

  const notificationRows = await pendingNotificationRows(user.id);
  const eventRows = await userEventRows(user.id);
  assert.equal([first.created, second.created].filter(Boolean).length, 1);
  assert.equal(notificationRows.length, 1);
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0].id, notificationRows[0].id);
  assert.equal(eventRows[0].data.displayName, "Utilisateur en attente");
});

test("fan-out creates exactly one logical delivery per subscribed endpoint", async () => {
  await createSubscribedEndpoint();
  await createSubscribedEndpoint();
  const { result } = await registerFixture();

  await Promise.all([materializePendingIntegrationEvents(), materializePendingIntegrationEvents()]);
  const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, result.eventId));
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.endpointId)).size, 2);
});

test("concurrent delivery workers lease one row and perform one HTTP attempt", async () => {
  const prepared = await prepareDelivery();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };

  await Promise.all([
    processWebhookDeliveries({ resolver: PUBLIC_RESOLVER, fetchImpl }),
    processWebhookDeliveries({ resolver: PUBLIC_RESOLVER, fetchImpl }),
  ]);

  const stored = await deliveryById(prepared.delivery.id);
  assert.equal(calls, 1);
  assert.equal(stored.attemptCount, 1);
  assert.equal(stored.status, "sent");
});

test("disabled endpoints and endpoints without a subscription receive no delivery", async () => {
  const disabled = await createSubscribedEndpoint();
  await db.update(webhookEndpoints).set({ status: "disabled", disabledAt: new Date() }).where(eq(webhookEndpoints.id, disabled.endpoint.id));
  await createSubscribedEndpoint({ subscriptions: [] });
  const { result } = await registerFixture();

  await materializePendingIntegrationEvents();
  const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, result.eventId));
  assert.equal(rows.length, 0);
});

test("2xx delivery signs the exact raw body and never exposes secret or unnecessary identity", async () => {
  const prepared = await prepareDelivery();
  const calls = [];
  const consoleCalls = [];
  const originalError = console.error;
  console.error = (...args) => consoleCalls.push(args);
  try {
    await processWebhookDeliveries({
      resolver: PUBLIC_RESOLVER,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      },
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(calls.length, 1);
  const { init } = calls[0];
  const body = JSON.parse(init.body);
  const timestamp = init.headers["X-Public-Map-Timestamp"];
  const expected = createHmac("sha256", prepared.secret).update(`${timestamp}.${init.body}`, "utf8").digest("hex");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers["X-Public-Map-Event-Id"], prepared.result.eventId);
  assert.equal(init.headers["X-Public-Map-Event-Type"], "user.pending.created");
  assert.equal(init.headers["X-Public-Map-Signature"], `sha256=${expected}`);
  assert.equal(body.id, prepared.result.eventId);
  assert.equal(Object.hasOwn(body.data, "email"), false);
  assert.equal(Object.hasOwn(body.data, "clerkUserId"), false);
  assert.equal(init.body.includes(prepared.input.email), false);
  assert.equal(init.body.includes(prepared.input.clerkUserId), false);
  assert.equal(JSON.stringify(consoleCalls).includes(prepared.secret), false);

  const stored = await deliveryById(prepared.delivery.id);
  const [storedSecret] = await db.select().from(webhookEndpointSecrets).where(eq(webhookEndpointSecrets.endpointId, prepared.endpoint.id));
  assert.equal(stored.status, "sent");
  assert.equal(stored.attemptCount, 1);
  assert.equal(JSON.stringify(stored).includes(prepared.secret), false);
  assert.equal(JSON.stringify(storedSecret).includes(prepared.secret), false);
});

test("an endpoint disabled after fan-out is skipped without HTTP", async () => {
  const prepared = await prepareDelivery();
  await db.update(webhookEndpoints).set({ status: "disabled" }).where(eq(webhookEndpoints.id, prepared.endpoint.id));
  let calls = 0;
  await processWebhookDeliveries({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(calls, 0);
  assert.equal((await deliveryById(prepared.delivery.id)).status, "skipped");
});

test("an encrypted forbidden URL is abandoned before any network request", async () => {
  const integration = await createIntegration();
  const endpointId = randomUUID();
  const secret = generateWebhookSecret();
  const forbiddenUrl = "https://127.0.0.1/private";
  const urlEncrypted = encryptIntegrationValue(forbiddenUrl, `webhook-url:${endpointId}`);
  const secretEncrypted = encryptIntegrationValue(secret, `webhook-secret:${endpointId}:1`);
  await db.transaction(async (tx) => {
    await tx.insert(webhookEndpoints).values({
      id: endpointId,
      integrationId: integration.id,
      name: "Forbidden target",
      urlCiphertext: urlEncrypted.ciphertext,
      urlIv: urlEncrypted.iv,
      urlAuthTag: urlEncrypted.authTag,
      urlOrigin: "https://127.0.0.1",
      urlHash: webhookUrlHash(forbiddenUrl),
    });
    await tx.insert(webhookEndpointSecrets).values({
      endpointId,
      version: 1,
      secretCiphertext: secretEncrypted.ciphertext,
      secretIv: secretEncrypted.iv,
      secretAuthTag: secretEncrypted.authTag,
    });
    await tx.insert(webhookSubscriptions).values({ endpointId, eventType: "user.pending.created", eventVersion: 1 });
  });
  const registration = await registerFixture();
  await materializePendingIntegrationEvents();
  let calls = 0;
  await processWebhookDeliveries({
    resolver: PUBLIC_RESOLVER,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    },
  });
  const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, registration.result.eventId));
  assert.equal(calls, 0);
  assert.equal(delivery.status, "abandoned");
  assert.equal(delivery.lastErrorCode, "unsafe_webhook_url");
  assert.equal(JSON.stringify(delivery).includes(secret), false);
});

for (const scenario of [
  { name: "429 schedules retry", response: () => new Response(null, { status: 429 }), expected: "retrying", code: "http_429" },
  { name: "500 schedules retry", response: () => new Response(null, { status: 500 }), expected: "retrying", code: "http_500" },
  { name: "timeout schedules retry", response: () => { throw new DOMException("", "TimeoutError"); }, expected: "retrying", code: "timeout" },
  { name: "redirect is never followed and is abandoned", response: () => new Response(null, { status: 302 }), expected: "abandoned", code: "redirect_not_allowed" },
  { name: "other 4xx is abandoned", response: () => new Response(null, { status: 400 }), expected: "abandoned", code: "http_400" },
]) {
  test(scenario.name, async () => {
    const prepared = await prepareDelivery();
    await processWebhookDeliveries({ resolver: PUBLIC_RESOLVER, fetchImpl: async () => scenario.response() });
    const stored = await deliveryById(prepared.delivery.id);
    assert.equal(stored.status, scenario.expected);
    assert.equal(stored.lastErrorCode, scenario.code);
    assert.equal(stored.attemptCount, 1);
  });
}

test("retry policy keeps one eventId and abandons after six attempts", async () => {
  assert.deepEqual(WEBHOOK_ATTEMPT_DELAYS_MS, [0, 30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
  assert.equal(MAX_WEBHOOK_ATTEMPTS, 6);
  const prepared = await prepareDelivery();
  const bodies = [];
  let now = new Date();

  for (let attempt = 1; attempt <= MAX_WEBHOOK_ATTEMPTS; attempt += 1) {
    await processWebhookDeliveries({
      now,
      resolver: PUBLIC_RESOLVER,
      fetchImpl: async (_url, init) => {
        bodies.push(init.body);
        return new Response(null, { status: 500 });
      },
    });
    const stored = await deliveryById(prepared.delivery.id);
    if (attempt < MAX_WEBHOOK_ATTEMPTS) {
      assert.equal(
        stored.nextAttemptAt?.getTime(),
        now.getTime() + WEBHOOK_ATTEMPT_DELAYS_MS[attempt],
      );
    } else {
      assert.equal(stored.nextAttemptAt, null);
    }
    if (stored.nextAttemptAt) now = new Date(stored.nextAttemptAt.getTime() + 1);
  }

  const stored = await deliveryById(prepared.delivery.id);
  const attempts = await db
    .select()
    .from(webhookDeliveryAttempts)
    .where(eq(webhookDeliveryAttempts.deliveryId, prepared.delivery.id));
  assert.equal(stored.status, "abandoned");
  assert.equal(stored.attemptCount, MAX_WEBHOOK_ATTEMPTS);
  assert.equal(attempts.length, MAX_WEBHOOK_ATTEMPTS);
  assert.equal(bodies.length, MAX_WEBHOOK_ATTEMPTS);
  assert.equal(new Set(bodies).size, 1);
  assert.equal(JSON.parse(bodies[0]).id, prepared.result.eventId);
});
