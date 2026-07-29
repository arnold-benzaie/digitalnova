// Integration coverage for POST /api/v1/tasks and POST /api/v1/interactions
// (including Idempotency-Key semantics), against the same isolated local
// Docker database as the other lib/api-v1 integration suites.
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_API_KEY_PEPPER = "integration-test-pepper-not-a-real-secret";

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { auditLog, crmClients, integrationApiIdempotencyKeys, integrationApiKeys, integrations, interactions, organizations, tasks } = await import("@/db/schema");
const { and, desc, eq, inArray } = await import("drizzle-orm");
const { generateIntegrationApiKey } = await import("@/lib/integrations/crypto");
const { POST: createTaskRoute } = await import("@/app/api/v1/tasks/route");
const { POST: createInteractionRoute } = await import("@/app/api/v1/interactions/route");

const PEPPER = process.env.INTEGRATION_API_KEY_PEPPER;
const fixtureOrgIds = new Set();
const fixtureIntegrationIds = new Set();
const fixtureClientIds = new Set();
let orgA;
let orgB;

async function createOrg(name) {
  const [org] = await db.insert(organizations).values({ name: `${name} ${randomUUID()}` }).returning();
  fixtureOrgIds.add(org.id);
  return org;
}

async function createApiKey(organizationId, { scopes = ["tasks:create", "interactions:create"], status = "active" } = {}) {
  const [integration] = await db
    .insert(integrations)
    .values({ organizationId, name: `api-v1 tasks/interactions test ${randomUUID()}`, type: "automation", status: "active" })
    .returning();
  fixtureIntegrationIds.add(integration.id);

  const generated = generateIntegrationApiKey("live", PEPPER);
  await db.insert(integrationApiKeys).values({
    integrationId: integration.id,
    lookupId: generated.lookupId,
    keyPrefix: generated.keyPrefix,
    keyHash: generated.keyHash,
    hashVersion: generated.hashVersion,
    scopes,
    status,
  });
  return { plaintextKey: generated.plaintextKey, integrationId: integration.id };
}

async function createClient(organizationId, overrides = {}) {
  const [client] = await db
    .insert(crmClients)
    .values({ name: overrides.name ?? "Café Central", organizationId, stage: "client" })
    .returning();
  fixtureClientIds.add(client.id);
  return client;
}

function requestTo(path, { key, body } = {}, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (key) headers.authorization = `Bearer ${key}`;
  const init = { method: "POST", headers };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  return new Request(`https://example.com${path}`, init);
}

before(async () => {
  orgA = await createOrg("api-v1 tasks/interactions org A");
  orgB = await createOrg("api-v1 tasks/interactions org B");
});

afterEach(async () => {
  if (fixtureClientIds.size > 0) {
    await db.delete(crmClients).where(inArray(crmClients.id, [...fixtureClientIds]));
    fixtureClientIds.clear();
  }
  if (fixtureIntegrationIds.size > 0) {
    await db.delete(integrationApiIdempotencyKeys).where(inArray(integrationApiIdempotencyKeys.integrationId, [...fixtureIntegrationIds]));
  }
});

after(async () => {
  if (fixtureIntegrationIds.size > 0) await db.delete(integrations).where(inArray(integrations.id, [...fixtureIntegrationIds]));
  if (fixtureOrgIds.size > 0) await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

// ---------- tasks ----------

test("POST /api/v1/tasks: creates a task tied to a client of the caller's own organization", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);

  const response = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "Call back" } }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.clientId, client.id);
  assert.equal(body.data.title, "Call back");
  assert.equal(body.data.status, "todo");
  assert.deepEqual(Object.keys(body.data).sort(), ["clientId", "createdAt", "description", "dueDate", "id", "status", "title"]);

  const [row] = await db.select().from(tasks).where(eq(tasks.id, body.data.id)).limit(1);
  assert.equal(row.clientId, client.id);
});

test("POST /api/v1/tasks: a clientId belonging to another organization is rejected (never silently created, never distinguishes 'not found' from 'not yours')", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const clientB = await createClient(orgB.id);

  const response = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: clientB.id, title: "Should not be created" } }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");

  const rows = await db.select().from(tasks).where(eq(tasks.clientId, clientB.id));
  assert.equal(rows.length, 0);
});

test("POST /api/v1/tasks: a key without tasks:create is rejected with FORBIDDEN_SCOPE, nothing is created", async () => {
  const { plaintextKey } = await createApiKey(orgA.id, { scopes: ["interactions:create"] });
  const client = await createClient(orgA.id);

  const response = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "x" } }));
  assert.equal(response.status, 403);
  assert.equal((await db.select().from(tasks).where(eq(tasks.clientId, client.id))).length, 0);
});

test("POST /api/v1/tasks: a revoked key is rejected", async () => {
  const { plaintextKey } = await createApiKey(orgA.id, { status: "revoked" });
  const client = await createClient(orgA.id);
  const response = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "x" } }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "API_KEY_REVOKED");
});

test("POST /api/v1/tasks: an empty body, a forbidden field (assignee), and malformed JSON are all rejected as 400, nothing created", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);

  const empty = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: {} }));
  assert.equal(empty.status, 400);

  const forbidden = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "x", assignee: "Someone" } }));
  assert.equal(forbidden.status, 400);

  const malformed = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: "{not json" }));
  assert.equal(malformed.status, 400);

  assert.equal((await db.select().from(tasks).where(eq(tasks.clientId, client.id))).length, 0);
});

// ---------- interactions ----------

test("POST /api/v1/interactions: creates an interaction, sets createdBy server-side, never echoes it back", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);

  const response = await createInteractionRoute(
    requestTo("/api/v1/interactions", { key: plaintextKey, body: { clientId: client.id, type: "call", summary: "Discussed renewal" } }),
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.type, "call");
  assert.deepEqual(Object.keys(body.data).sort(), ["clientId", "createdAt", "id", "occurredAt", "summary", "type"]);

  const [row] = await db.select().from(interactions).where(eq(interactions.id, body.data.id)).limit(1);
  assert.ok(row.createdBy.startsWith("api:"), "createdBy should be set server-side to a non-secret marker");
});

test("POST /api/v1/interactions: clientId cross-org isolation and forbidden createdBy field", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const clientB = await createClient(orgB.id);
  const clientA = await createClient(orgA.id);

  const crossOrg = await createInteractionRoute(
    requestTo("/api/v1/interactions", { key: plaintextKey, body: { clientId: clientB.id, type: "call", summary: "x" } }),
  );
  assert.equal(crossOrg.status, 400);

  const forbiddenField = await createInteractionRoute(
    requestTo("/api/v1/interactions", { key: plaintextKey, body: { clientId: clientA.id, type: "call", summary: "x", createdBy: "hacker" } }),
  );
  assert.equal(forbiddenField.status, 400);
});

// ---------- idempotency (shared semantics, tested once thoroughly on tasks) ----------

test("Idempotency-Key: a retry with the SAME key and the SAME body returns the exact same resource (status 201 both times, identical data), and creates only ONE row", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const idempotencyKey = `test-${randomUUID()}`;
  const requestBody = { clientId: client.id, title: "Idempotent task" };

  const first = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: requestBody }, { "idempotency-key": idempotencyKey }));
  const second = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: requestBody }, { "idempotency-key": idempotencyKey }));

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
  assert.deepEqual(firstBody.data, secondBody.data, "the replayed resource must be byte-identical to the original");

  const rows = await db.select().from(tasks).where(eq(tasks.clientId, client.id));
  assert.equal(rows.length, 1, "only one task should ever have been created");
});

test("Idempotency-Key: reusing the same key with a DIFFERENT body is rejected with IDEMPOTENCY_KEY_CONFLICT (409), and no second resource is created", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const idempotencyKey = `test-${randomUUID()}`;

  const first = await createTaskRoute(
    requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "Original title" } }, { "idempotency-key": idempotencyKey }),
  );
  assert.equal(first.status, 201);

  const second = await createTaskRoute(
    requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "DIFFERENT title" } }, { "idempotency-key": idempotencyKey }),
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "IDEMPOTENCY_KEY_CONFLICT");

  const rows = await db.select().from(tasks).where(eq(tasks.clientId, client.id));
  assert.equal(rows.length, 1, "the conflicting retry must not have created a second task");
});

test("Idempotency-Key: the same key string is scoped per route — reusing it on /interactions after /tasks does not collide", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const sharedKey = `shared-${randomUUID()}`;

  const taskResponse = await createTaskRoute(
    requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "x" } }, { "idempotency-key": sharedKey }),
  );
  const interactionResponse = await createInteractionRoute(
    requestTo("/api/v1/interactions", { key: plaintextKey, body: { clientId: client.id, type: "note", summary: "x" } }, { "idempotency-key": sharedKey }),
  );

  assert.equal(taskResponse.status, 201);
  assert.equal(interactionResponse.status, 201, "the same idempotency key on a different route must not conflict");
});

test("Idempotency-Key: without the header, repeating the same request creates TWO separate resources (no accidental deduping)", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const body = { clientId: client.id, title: "Not idempotent" };

  const first = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body }));
  const second = await createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body }));

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstId = (await first.json()).data.id;
  const secondId = (await second.json()).data.id;
  assert.notEqual(firstId, secondId);
});

test("Idempotency-Key: an oversized key is rejected before any resource is created", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const response = await createTaskRoute(
    requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "x" } }, { "idempotency-key": "x".repeat(500) }),
  );
  assert.equal(response.status, 400);
  assert.equal((await db.select().from(tasks).where(eq(tasks.clientId, client.id))).length, 0);
});

// ---------- logging ----------

test("a successful task creation is journalized under the caller's organization with no personal data in metadata", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);

  const response = await createTaskRoute(
    requestTo("/api/v1/tasks", { key: plaintextKey, body: { clientId: client.id, title: "Confidential subject line" } }),
  );
  const taskId = (await response.json()).data.id;

  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "api_v1.tasks.created"), eq(auditLog.targetId, taskId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  assert.ok(entry);
  assert.equal(entry.organizationId, orgA.id);
  assert.equal(JSON.stringify(entry.metadata).includes("Confidential subject line"), false, "the task title must never be logged");
});
