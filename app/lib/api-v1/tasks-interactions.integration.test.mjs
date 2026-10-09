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
const { auditLog, crmClients, deals, integrationApiIdempotencyKeys, integrationApiKeys, integrations, interactions, organizations, tasks } = await import("@/db/schema");
const { and, desc, eq, inArray } = await import("drizzle-orm");
const { generateIntegrationApiKey } = await import("@/lib/integrations/crypto");
const { runIdempotently } = await import("@/lib/api-v1/idempotency");
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
  assert.deepEqual(Object.keys(body.data).sort(), ["clientId", "createdAt", "dealId", "id", "occurredAt", "summary", "type"]);
  assert.strictEqual(body.data.dealId, null);

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

// ---------- idempotency: genuine concurrency (P1 atomicity fix) ----------

test("Idempotency-Key: two genuinely concurrent requests (Promise.all) with the same key create exactly ONE task, and both callers get the identical resource", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const idempotencyKey = `concurrent-${randomUUID()}`;
  const requestBody = { clientId: client.id, title: "Concurrent task" };

  const [first, second] = await Promise.all([
    createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: requestBody }, { "idempotency-key": idempotencyKey })),
    createTaskRoute(requestTo("/api/v1/tasks", { key: plaintextKey, body: requestBody }, { "idempotency-key": idempotencyKey })),
  ]);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
  assert.deepEqual(firstBody.data, secondBody.data, "both concurrent callers must receive the identical resource — the loser must never create its own");

  const rows = await db.select().from(tasks).where(eq(tasks.clientId, client.id));
  assert.equal(rows.length, 1, "exactly one task must exist in the DB after a genuine race, not two");
});

test("Idempotency-Key: two genuinely concurrent requests on /interactions with the same key create exactly ONE interaction", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const idempotencyKey = `concurrent-${randomUUID()}`;
  const requestBody = { clientId: client.id, type: "note", summary: "Concurrent interaction" };

  const [first, second] = await Promise.all([
    createInteractionRoute(requestTo("/api/v1/interactions", { key: plaintextKey, body: requestBody }, { "idempotency-key": idempotencyKey })),
    createInteractionRoute(requestTo("/api/v1/interactions", { key: plaintextKey, body: requestBody }, { "idempotency-key": idempotencyKey })),
  ]);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
  assert.deepEqual(firstBody.data, secondBody.data);

  const rows = await db.select().from(interactions).where(eq(interactions.clientId, client.id));
  assert.equal(rows.length, 1, "exactly one interaction must exist in the DB after a genuine race, not two");
});

test("runIdempotently: when createResource throws after the claim succeeds, the whole transaction (claim row included) rolls back, and a retry with the same key then succeeds cleanly", async () => {
  const { integrationId } = await createApiKey(orgA.id);
  const route = "POST /api/v1/tasks";
  const idempotencyKey = `rollback-${randomUUID()}`;
  const requestHash = "test-request-hash";

  await assert.rejects(
    runIdempotently(integrationId, route, idempotencyKey, requestHash, async () => {
      throw new Error("simulated failure after claim");
    }),
    /simulated failure after claim/,
  );

  const findClaimRows = () =>
    db
      .select()
      .from(integrationApiIdempotencyKeys)
      .where(
        and(
          eq(integrationApiIdempotencyKeys.integrationId, integrationId),
          eq(integrationApiIdempotencyKeys.route, route),
          eq(integrationApiIdempotencyKeys.idempotencyKey, idempotencyKey),
        ),
      );

  assert.equal((await findClaimRows()).length, 0, "a rolled-back transaction must leave no claim row behind — not even the in-progress sentinel");

  const retryResult = await runIdempotently(integrationId, route, idempotencyKey, requestHash, async () => ({ status: 201, body: { ok: true } }));
  assert.deepEqual(retryResult, { status: 201, body: { ok: true } }, "after a rollback, a retry with the same key must succeed as if the first attempt never happened");

  const rowsAfterRetry = await findClaimRows();
  assert.equal(rowsAfterRetry.length, 1);
  assert.equal(rowsAfterRetry[0].responseStatus, 201);
  assert.deepEqual(rowsAfterRetry[0].responseBody, { ok: true });
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

// ---------- 4F.8.5 — optional dealId (organization -> client -> deal) ----------
// Deals are removed with their client (ON DELETE CASCADE) by afterEach().

const DEAL_REJECTION = '"dealId" does not reference a deal of this client.';

async function createDeal(clientId) {
  const [deal] = await db.insert(deals).values({ clientId, title: `api-v1 4F.8.5 deal ${randomUUID()}` }).returning();
  return deal;
}
async function postInteraction(plaintextKey, body, headers = {}) {
  return createInteractionRoute(requestTo("/api/v1/interactions", { key: plaintextKey, body }, headers));
}
async function interactionRows(clientId) {
  return db.select().from(interactions).where(eq(interactions.clientId, clientId));
}
async function assertDealRejected(response) {
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.message, DEAL_REJECTION);
  return body;
}

test("4F.8.5 A: POST /api/v1/interactions without dealId -> 201, dealId NULL in DB and in the response", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const response = await postInteraction(plaintextKey, { clientId: client.id, type: "note", summary: "no deal" });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.strictEqual(body.data.dealId, null);
  const [row] = await interactionRows(client.id);
  assert.strictEqual(row.dealId, null);
});

test("4F.8.5 B: dealId explicitly null -> 201, dealId NULL", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const response = await postInteraction(plaintextKey, { clientId: client.id, type: "note", summary: "null deal", dealId: null });
  assert.equal(response.status, 201);
  assert.strictEqual((await response.json()).data.dealId, null);
  const [row] = await interactionRows(client.id);
  assert.strictEqual(row.dealId, null);
});

test("4F.8.5 C: a deal of the same client -> 201, dealId stored and returned", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const deal = await createDeal(client.id);
  const response = await postInteraction(plaintextKey, { clientId: client.id, type: "call", summary: "linked", dealId: deal.id });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.dealId, deal.id);
  const rows = await interactionRows(client.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dealId, deal.id);
  assert.equal(rows[0].id, body.data.id);
});

test("4F.8.5 D/E/F: unknown deal, deal of another client of the same org, deal of another org -> the SAME 400, nothing created", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const sameOrgOtherClient = await createClient(orgA.id);
  const otherOrgClient = await createClient(orgB.id);
  const sameOrgDeal = await createDeal(sameOrgOtherClient.id);
  const otherOrgDeal = await createDeal(otherOrgClient.id);

  const bodies = [];
  for (const dealId of [randomUUID(), sameOrgDeal.id, otherOrgDeal.id]) {
    bodies.push(await assertDealRejected(await postInteraction(plaintextKey, { clientId: client.id, type: "note", summary: "should not exist", dealId })));
  }
  // identical apart from requestId, which is unique per request by design
  const withoutRequestId = (error) => {
    const copy = { ...error };
    delete copy.requestId;
    return copy;
  };
  assert.deepEqual(withoutRequestId(bodies[1].error), withoutRequestId(bodies[0].error), "deal of another client is indistinguishable from an unknown deal");
  assert.deepEqual(withoutRequestId(bodies[2].error), withoutRequestId(bodies[0].error), "deal of another organization is indistinguishable from an unknown deal");
  assert.deepEqual(Object.keys(bodies[0]).sort(), ["error"]);
  for (const c of [client, sameOrgOtherClient, otherOrgClient]) assert.equal((await interactionRows(c.id)).length, 0);
});

test("4F.8.5: malformed / empty / numeric dealId -> 400 format error, nothing created; a client of another org keeps the existing clientId error", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  for (const dealId of ["not-a-uuid", "", 7]) {
    const response = await postInteraction(plaintextKey, { clientId: client.id, type: "note", summary: "bad format", dealId });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(body.error.message, '"dealId" must be a valid UUID or null.');
  }
  assert.equal((await interactionRows(client.id)).length, 0);

  const otherOrgClient = await createClient(orgB.id);
  const otherOrgDeal = await createDeal(otherOrgClient.id);
  const crossOrg = await postInteraction(plaintextKey, { clientId: otherOrgClient.id, type: "note", summary: "x", dealId: otherOrgDeal.id });
  assert.equal(crossOrg.status, 400);
  assert.equal((await crossOrg.json()).error.message, '"clientId" does not reference a client in your organization.', "the client check still runs first");
  assert.equal((await interactionRows(otherOrgClient.id)).length, 0);
});

test("4F.8.5 G: Idempotency-Key + dealId -> same resource twice (dealId included), exactly ONE row; a different dealId with the same key -> 409", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const deal = await createDeal(client.id);
  const otherDeal = await createDeal(client.id);
  const idempotencyKey = `deal-${randomUUID()}`;
  const requestBody = { clientId: client.id, type: "meeting", summary: "Idempotent linked interaction", dealId: deal.id };

  const first = await postInteraction(plaintextKey, requestBody, { "idempotency-key": idempotencyKey });
  const second = await postInteraction(plaintextKey, requestBody, { "idempotency-key": idempotencyKey });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
  assert.deepEqual(secondBody.data, firstBody.data);
  assert.equal(firstBody.data.dealId, deal.id);

  const conflict = await postInteraction(plaintextKey, { ...requestBody, dealId: otherDeal.id }, { "idempotency-key": idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_KEY_CONFLICT");

  const rows = await interactionRows(client.id);
  assert.equal(rows.length, 1, "only one interaction should ever have been created");
  assert.equal(rows[0].dealId, deal.id);
});

test("4F.8.5 H: Idempotency-Key + dealId null -> existing idempotent behavior kept, one row with dealId NULL", async () => {
  const { plaintextKey } = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const idempotencyKey = `nodeal-${randomUUID()}`;
  const requestBody = { clientId: client.id, type: "note", summary: "Idempotent general interaction", dealId: null };

  const first = await postInteraction(plaintextKey, requestBody, { "idempotency-key": idempotencyKey });
  const second = await postInteraction(plaintextKey, requestBody, { "idempotency-key": idempotencyKey });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual((await second.json()).data, (await first.json()).data);
  const rows = await interactionRows(client.id);
  assert.equal(rows.length, 1);
  assert.strictEqual(rows[0].dealId, null);
});
