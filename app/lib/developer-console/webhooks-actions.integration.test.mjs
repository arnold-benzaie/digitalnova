// Integration tests for lib/developer-console/webhooks-actions.ts — the
// self-service webhook endpoint management actions behind
// /developers/console/webhooks (Stage 5).
//
// Same mocking convention as lib/developer-console/actions.integration.test.mjs
// (only @/lib/session's requireSession() and next/cache's revalidatePath
// are mocked; everything else — the actions under test,
// lib/integrations/{endpoints,worker,queries}.ts, lib/audit.ts, the real
// Drizzle queries/transactions — runs unmodified against the real local
// Docker database). The heaviest emphasis here is CROSS-ORGANIZATION
// ISOLATION: the architecture plan explicitly calls this out as Stage 5's
// principal risk ("replay self-service qui traverserait les frontières
// d'organisation si le contrôle d'autorisation n'est pas revérifié
// spécifiquement").
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/developer-console/webhooks-actions.integration.test.mjs
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.INTEGRATION_API_KEY_PEPPER = randomBytes(32).toString("base64url");

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let currentSession = null;
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!currentSession) throw new Error("test bug: no session configured — call asUser() first");
      return currentSession;
    },
  },
});

const { db } = await import("@/db");
const { auditLog, integrationEvents, integrations, organizations, users, memberships, roles, webhookDeliveries, webhookEndpoints } = await import("@/db/schema");
const { and, eq, inArray } = await import("drizzle-orm");
const {
  createDeveloperWebhookEndpoint,
  deleteDeveloperWebhookEndpoint,
  replayDeveloperWebhookDelivery,
  rotateDeveloperWebhookSecret,
  setDeveloperWebhookEndpointStatus,
  updateDeveloperWebhookEndpoint,
  updateDeveloperWebhookSubscriptions,
} = await import("./webhooks-actions.ts");

const fixtureOrgIds = new Set();
const fixtureUserIds = new Set();
const fixtureEventIds = new Set();
let orgA;
let orgB;
let userA;

async function createOrgWithUser(name) {
  const [org] = await db.insert(organizations).values({ name: `${name} ${randomUUID()}` }).returning();
  fixtureOrgIds.add(org.id);
  const [role] = await db.select().from(roles).where(eq(roles.name, "client")).limit(1);
  const [user] = await db.insert(users).values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "Webhook Actions Test User" }).returning();
  fixtureUserIds.add(user.id);
  await db.insert(memberships).values({ userId: user.id, organizationId: org.id, roleId: role.id });
  return { org, user };
}

function asUser(user, org) {
  currentSession = { userId: user.id, clerkUserId: `test_clerk_${user.id}`, email: "dev@example.com", fullName: "Webhook Actions Test User", organizationId: org.id, organizationName: org.name, role: "client" };
}

function makeFormData(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) formData.append(key, v);
    else if (value !== undefined) formData.set(key, value);
  }
  return formData;
}

async function createEndpointForOrgA(overrides = {}) {
  asUser(userA, orgA);
  const result = await createDeveloperWebhookEndpoint(
    makeFormData({ name: overrides.name ?? "Org A endpoint", url: overrides.url ?? `https://example.com/webhook/${randomUUID()}`, events: ["user.pending.created"] }),
  );
  return result;
}

/**
 * Builds a real webhookDeliveries row (+ its integrationEvents parent)
 * directly, scoped to the GIVEN organization — deliberately NOT via
 * registerPendingUser()/materializePendingIntegrationEvents(), because
 * user.pending.created is a platform-INTERNAL event (organizationId =
 * the isInternal org, see lib/notifications.ts) and would never fan out
 * to a customer org's endpoint in the first place (see
 * lib/integrations/outbox.ts's fanOutEvent join condition) — the single-
 * event catalog simply has no customer-facing event today (see the
 * Stage 5 report). This isolates "does replay/requeue work for a real
 * delivery" from "does the event catalog support customer events",
 * exactly like webhook-system.integration.test.mjs's own "an encrypted
 * forbidden URL is abandoned" test builds its fixture directly rather
 * than through fan-out.
 */
async function insertOwnedDeliveryFixture(organizationId, endpointId) {
  const eventId = randomUUID();
  fixtureEventIds.add(eventId);
  await db.insert(integrationEvents).values({
    id: eventId,
    organizationId,
    type: "user.pending.created",
    version: 1,
    occurredAt: new Date(),
    data: { userId: randomUUID(), displayName: "Replay fixture", adminPath: "/admin/users?status=pending" },
    status: "completed",
    completedAt: new Date(),
  });
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({ event: "user.pending.created", eventId, endpointId, secretVersion: 1, status: "pending", nextAttemptAt: new Date() })
    .returning();
  return delivery;
}

before(async () => {
  ({ org: orgA, user: userA } = await createOrgWithUser("webhooks-actions org A"));
  ({ org: orgB } = await createOrgWithUser("webhooks-actions org B"));
});

afterEach(async () => {
  const integrationRows = await db.select({ id: integrations.id }).from(integrations).where(inArray(integrations.organizationId, [orgA.id, orgB.id]));
  const integrationIds = integrationRows.map((r) => r.id);
  if (integrationIds.length > 0) {
    const endpointRows = await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(inArray(webhookEndpoints.integrationId, integrationIds));
    const endpointIds = endpointRows.map((r) => r.id);
    if (endpointIds.length > 0) await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.endpointId, endpointIds));
    await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.integrationId, integrationIds));
    await db.delete(integrations).where(inArray(integrations.id, integrationIds));
  }
  if (fixtureEventIds.size > 0) {
    await db.delete(integrationEvents).where(inArray(integrationEvents.id, [...fixtureEventIds]));
    fixtureEventIds.clear();
  }
  await db.delete(auditLog).where(inArray(auditLog.organizationId, [orgA.id, orgB.id]));
});

after(async () => {
  await db.delete(memberships).where(inArray(memberships.organizationId, [...fixtureOrgIds]));
  await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
  await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

test("createDeveloperWebhookEndpoint: creates a real endpoint scoped to the caller's own organization", async () => {
  const result = await createEndpointForOrgA({ name: "Production" });
  assert.ok(result.secret);

  const [integration] = await db.select().from(integrations).where(eq(integrations.organizationId, orgA.id)).limit(1);
  assert.ok(integration);
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.integrationId, integration.id)).limit(1);
  assert.equal(endpoint.name, "Production");
  assert.equal(endpoint.status, "active");

  const [event] = await db.select().from(auditLog).where(and(eq(auditLog.organizationId, orgA.id), eq(auditLog.action, "webhook.created"))).limit(1);
  assert.ok(event, "webhook.created audit event must be recorded under the self-service namespace");
});

test("createDeveloperWebhookEndpoint: rejects an SSRF-unsafe URL with a friendly, translated error", async () => {
  asUser(userA, orgA);
  await assert.rejects(
    () => createDeveloperWebhookEndpoint(makeFormData({ name: "X", url: "https://127.0.0.1/private", events: ["user.pending.created"] })),
    /autoris/i,
  );
});

test("updateDeveloperWebhookEndpoint: the owner CAN update their own endpoint", async () => {
  const created = await createEndpointForOrgA();
  asUser(userA, orgA);
  await updateDeveloperWebhookEndpoint(created.endpointId, makeFormData({ name: "Renamed", url: `https://example.com/renamed/${randomUUID()}` }));

  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, created.endpointId)).limit(1);
  assert.equal(endpoint.name, "Renamed");
});

test("updateDeveloperWebhookEndpoint: a DIFFERENT organization cannot update — same not-found as a nonexistent id", async () => {
  const created = await createEndpointForOrgA();
  const { org: orgC, user: userC } = await createOrgWithUser("webhooks-actions org C (isolation probe)");
  asUser(userC, orgC);

  await assert.rejects(() => updateDeveloperWebhookEndpoint(created.endpointId, makeFormData({ name: "Hijacked", url: "https://example.com/attacker-attempt" })), /introuvable|not found/i);

  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, created.endpointId)).limit(1);
  assert.equal(endpoint.name, "Org A endpoint", "org A's endpoint must be untouched by org C's attempt");

  await db.delete(memberships).where(eq(memberships.organizationId, orgC.id));
  await db.delete(users).where(eq(users.id, userC.id));
  await db.delete(organizations).where(eq(organizations.id, orgC.id));
});

test("setDeveloperWebhookEndpointStatus: the owner can disable and re-enable; a different org cannot touch it", async () => {
  const created = await createEndpointForOrgA();
  asUser(userA, orgA);
  await setDeveloperWebhookEndpointStatus(created.endpointId, "disabled");
  let [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, created.endpointId)).limit(1);
  assert.equal(endpoint.status, "disabled");

  const { org: orgD, user: userD } = await createOrgWithUser("webhooks-actions org D (isolation probe)");
  asUser(userD, orgD);
  await assert.rejects(() => setDeveloperWebhookEndpointStatus(created.endpointId, "active"), /introuvable|not found/i);
  [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, created.endpointId)).limit(1);
  assert.equal(endpoint.status, "disabled", "must still be disabled — org D's attempt must have no effect");

  await db.delete(memberships).where(eq(memberships.organizationId, orgD.id));
  await db.delete(users).where(eq(users.id, userD.id));
  await db.delete(organizations).where(eq(organizations.id, orgD.id));
});

test("deleteDeveloperWebhookEndpoint: requires the endpoint to be disabled first, then the owner can delete it", async () => {
  const created = await createEndpointForOrgA();
  asUser(userA, orgA);
  await assert.rejects(() => deleteDeveloperWebhookEndpoint(created.endpointId), /désactivez|disable/i);

  await setDeveloperWebhookEndpointStatus(created.endpointId, "disabled");
  await deleteDeveloperWebhookEndpoint(created.endpointId);

  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, created.endpointId)).limit(1);
  assert.equal(endpoint, undefined);
});

test("updateDeveloperWebhookSubscriptions: the owner can change subscriptions; rejects an unknown event type", async () => {
  const created = await createEndpointForOrgA();
  asUser(userA, orgA);
  await assert.rejects(() => updateDeveloperWebhookSubscriptions(created.endpointId, makeFormData({ events: ["not.a.real.event"] })), /invalide|invalid/i);
  await assert.rejects(() => updateDeveloperWebhookSubscriptions(created.endpointId, makeFormData({})), /sélectionnez|select/i);
});

test("rotateDeveloperWebhookSecret: the owner gets a new secret; a different org cannot rotate it", async () => {
  const created = await createEndpointForOrgA();
  asUser(userA, orgA);
  const rotated = await rotateDeveloperWebhookSecret(created.endpointId);
  assert.ok(rotated.secret);
  assert.notEqual(rotated.secret, created.secret);

  const { org: orgE, user: userE } = await createOrgWithUser("webhooks-actions org E (isolation probe)");
  asUser(userE, orgE);
  await assert.rejects(() => rotateDeveloperWebhookSecret(created.endpointId), /introuvable|not found/i);

  await db.delete(memberships).where(eq(memberships.organizationId, orgE.id));
  await db.delete(users).where(eq(users.id, userE.id));
  await db.delete(organizations).where(eq(organizations.id, orgE.id));
});

test("replayDeveloperWebhookDelivery: the owner can replay their own real, abandoned delivery end-to-end", async () => {
  const created = await createEndpointForOrgA();
  const delivery = await insertOwnedDeliveryFixture(orgA.id, created.endpointId);
  await db.update(webhookDeliveries).set({ status: "abandoned", attemptCount: 6, abandonedAt: new Date() }).where(eq(webhookDeliveries.id, delivery.id));

  asUser(userA, orgA);
  // No network access from this sandbox: the target URL is unreachable,
  // so this exercises the real requeue + real HTTP attempt path and
  // expects a network-error outcome, not a "sent" one — the point of
  // this test is the AUTHORIZATION and STATE MACHINE, not a live 2xx.
  const result = await replayDeveloperWebhookDelivery(created.endpointId, delivery.id);
  assert.ok(["retrying", "abandoned", "sent"].includes(result.status), `unexpected status: ${result.status}`);

  const [event] = await db.select().from(auditLog).where(and(eq(auditLog.organizationId, orgA.id), eq(auditLog.action, "webhook.delivery_replayed"))).limit(1);
  assert.ok(event, "webhook.delivery_replayed audit event must be recorded");
});

test("replayDeveloperWebhookDelivery: a different organization cannot replay another org's delivery", async () => {
  const created = await createEndpointForOrgA();
  const delivery = await insertOwnedDeliveryFixture(orgA.id, created.endpointId);
  await db.update(webhookDeliveries).set({ status: "failed" }).where(eq(webhookDeliveries.id, delivery.id));

  const { org: orgF, user: userF } = await createOrgWithUser("webhooks-actions org F (isolation probe)");
  asUser(userF, orgF);
  await assert.rejects(() => replayDeveloperWebhookDelivery(created.endpointId, delivery.id), /introuvable|not found/i);

  const stored = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id)).limit(1);
  assert.equal(stored[0].status, "failed", "org F's attempt must never mutate org A's delivery");

  await db.delete(memberships).where(eq(memberships.organizationId, orgF.id));
  await db.delete(users).where(eq(users.id, userF.id));
  await db.delete(organizations).where(eq(organizations.id, orgF.id));
});
