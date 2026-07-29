// Integration tests for the Stage 5 additions to lib/integrations/
// {endpoints,worker}.ts: updateWebhookEndpointDetails, requeueWebhookDelivery,
// claimDeliveryById, deliverOne. Same fixture pattern as
// webhook-system.integration.test.mjs (real local Docker database, no
// mocked business logic, only HTTP delivery is a test double).
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/integrations/webhook-endpoint-management.integration.test.mjs
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.INTEGRATION_API_KEY_PEPPER = randomBytes(32).toString("base64url");

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { integrationEvents, integrations, notifications, organizations, users, webhookDeliveries, webhookEndpoints } = await import("@/db/schema");
const { eq, inArray, sql } = await import("drizzle-orm");
const { createWebhookEndpoint, requeueWebhookDelivery, updateWebhookEndpointDetails } = await import("./endpoints.ts");
const { claimDeliveryById, deliverOne } = await import("./worker.ts");
const { materializePendingIntegrationEvents } = await import("./outbox.ts");
const { registerPendingUser } = await import("@/lib/pending-user-registration");

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];
const fixtureIntegrationIds = new Set();
const fixtureUserIds = new Set();
// user.pending.created events (emitted by registerPendingUser) are scoped
// to the platform's "internal" (isInternal:true) organization — see
// lib/notifications.ts's createPendingUserNotificationAndEvent and
// lib/integrations/outbox.ts's fanOutEvent join condition. Endpoints that
// need to actually RECEIVE this event for a real end-to-end replay test
// must belong to that same internal org, exactly like
// webhook-system.integration.test.mjs's internalOrganizationId.
let internalOrganizationId;
let createdInternalOrganizationId = null;
let org;

async function createIntegration(name = "Endpoint mgmt test", organizationId = org.id) {
  const [integration] = await db.insert(integrations).values({ organizationId, name: `${name} ${randomUUID()}`, type: "automation" }).returning();
  fixtureIntegrationIds.add(integration.id);
  return integration;
}

async function createInternalIntegration(name = "Endpoint mgmt test (internal)") {
  return createIntegration(name, internalOrganizationId);
}

async function createEndpoint(overrides = {}) {
  const integration = overrides.integration ?? (await createIntegration());
  const created = await createWebhookEndpoint({
    integrationId: integration.id,
    name: overrides.name ?? "Endpoint test",
    url: overrides.url ?? `https://hooks.example.test/${randomUUID()}`,
    subscriptions: overrides.subscriptions ?? [{ type: "user.pending.created", version: 1 }],
    resolver: PUBLIC_RESOLVER,
  });
  return { integration, ...created };
}

async function prepareDelivery() {
  const created = await createEndpoint({ integration: await createInternalIntegration() });
  const registration = await registerPendingUser({
    clerkUserId: `endpoint_mgmt_${randomUUID()}`,
    email: `${randomUUID()}@integration.invalid`,
    fullName: "Endpoint Mgmt Test User",
    firstName: "Endpoint",
    lastName: "Mgmt",
  });
  fixtureUserIds.add(registration.user.id);
  await materializePendingIntegrationEvents();
  const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, registration.eventId)).limit(1);
  assert.ok(delivery, "outbox materialization must have created a real delivery row");
  return { ...created, registration, delivery };
}

async function endpointById(id) {
  return (await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1))[0];
}

async function deliveryById(id) {
  return (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1))[0];
}

before(async () => {
  const [created] = await db.insert(organizations).values({ name: `webhook-endpoint-mgmt test ${randomUUID()}` }).returning();
  org = created;

  const [existingInternal] = await db.select().from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  if (existingInternal) {
    internalOrganizationId = existingInternal.id;
  } else {
    const [createdInternal] = await db.insert(organizations).values({ name: `PUBLIC-MAP internal (endpoint mgmt test) ${randomUUID()}`, isInternal: true }).returning();
    internalOrganizationId = createdInternal.id;
    createdInternalOrganizationId = createdInternal.id;
  }
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
  await db.delete(organizations).where(eq(organizations.id, org.id));
  if (createdInternalOrganizationId) {
    await db.delete(organizations).where(eq(organizations.id, createdInternalOrganizationId));
  }
  await db.$client.end();
});

test("updateWebhookEndpointDetails: updates name/description/URL and re-derives urlOrigin/urlHash", async () => {
  const created = await createEndpoint({ name: "Old name" });
  const newUrl = `https://updated.example.test/${randomUUID()}`;

  const updated = await updateWebhookEndpointDetails({
    endpointId: created.endpoint.id,
    name: "New name",
    description: "New description",
    url: newUrl,
    resolver: PUBLIC_RESOLVER,
  });

  assert.equal(updated.name, "New name");
  assert.equal(updated.description, "New description");
  assert.equal(updated.urlOrigin, "https://updated.example.test");

  const stored = await endpointById(created.endpoint.id);
  assert.equal(stored.name, "New name");
  assert.equal(stored.urlOrigin, "https://updated.example.test");
  assert.notEqual(stored.urlCiphertext, created.endpoint.urlCiphertext, "the URL ciphertext must actually change, not just urlOrigin");
});

test("updateWebhookEndpointDetails: rejects an SSRF-unsafe URL, leaving the endpoint untouched", async () => {
  const created = await createEndpoint();
  await assert.rejects(
    () => updateWebhookEndpointDetails({ endpointId: created.endpoint.id, name: "X", url: "https://127.0.0.1/private", resolver: PUBLIC_RESOLVER }),
    /unsafe|not.*allowed/i,
  );
  const stored = await endpointById(created.endpoint.id);
  assert.equal(stored.urlOrigin, created.endpoint.urlOrigin);
});

test("updateWebhookEndpointDetails: rejects a URL already used by another endpoint on the same integration", async () => {
  const integration = await createIntegration();
  const first = await createEndpoint({ integration, url: "https://shared-target.example.test/a" });
  const second = await createEndpoint({ integration, url: "https://shared-target.example.test/b" });

  await assert.rejects(
    () => updateWebhookEndpointDetails({ endpointId: second.endpoint.id, name: "X", url: "https://shared-target.example.test/a", resolver: PUBLIC_RESOLVER }),
    /already uses this URL/i,
  );
  assert.ok(first.endpoint.id !== second.endpoint.id);
});

test("updateWebhookEndpointDetails: throws for a nonexistent endpoint id", async () => {
  await assert.rejects(
    () => updateWebhookEndpointDetails({ endpointId: randomUUID(), name: "X", url: "https://hooks.example.test/x", resolver: PUBLIC_RESOLVER }),
    /not found/i,
  );
});

test("requeueWebhookDelivery + deliverOne: a real abandoned delivery is reset and successfully redelivered end-to-end", async () => {
  const prepared = await prepareDelivery();
  // Force the delivery into a terminal "abandoned" state, as a real worker would after exhausting retries.
  await db.update(webhookDeliveries).set({ status: "abandoned", attemptCount: 6, lastErrorCode: "http_500", abandonedAt: new Date() }).where(eq(webhookDeliveries.id, prepared.delivery.id));

  await requeueWebhookDelivery(prepared.delivery.id);
  const requeued = await deliveryById(prepared.delivery.id);
  assert.equal(requeued.status, "pending");
  assert.equal(requeued.attemptCount, 0);
  assert.equal(requeued.lastErrorCode, null);
  assert.equal(requeued.abandonedAt, null);

  const status = await deliverOne(prepared.delivery.id, { resolver: PUBLIC_RESOLVER, fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(status, "sent");
  const delivered = await deliveryById(prepared.delivery.id);
  assert.equal(delivered.status, "sent");
  assert.equal(delivered.attemptCount, 1, "replay gets a fresh attempt budget, not a continuation of the old attemptCount");
});

test("requeueWebhookDelivery: rejects a delivery that is not in a replayable (failed/abandoned/skipped) status", async () => {
  const prepared = await prepareDelivery();
  await db.update(webhookDeliveries).set({ status: "sent" }).where(eq(webhookDeliveries.id, prepared.delivery.id));

  await assert.rejects(() => requeueWebhookDelivery(prepared.delivery.id), /can be replayed/i);
  const stored = await deliveryById(prepared.delivery.id);
  assert.equal(stored.status, "sent", "a rejected requeue must never mutate the delivery");
});

test("requeueWebhookDelivery: throws for a nonexistent delivery id", async () => {
  await assert.rejects(() => requeueWebhookDelivery(randomUUID()), /not found/i);
});

test("claimDeliveryById: returns null for a delivery that isn't pending/retrying", async () => {
  const prepared = await prepareDelivery();
  await db.update(webhookDeliveries).set({ status: "sent" }).where(eq(webhookDeliveries.id, prepared.delivery.id));
  const claimed = await claimDeliveryById(prepared.delivery.id, new Date());
  assert.equal(claimed, null);
});

test("deliverOne: returns null (never throws) when nothing is claimable for the given id", async () => {
  const status = await deliverOne(randomUUID());
  assert.equal(status, null);
});
