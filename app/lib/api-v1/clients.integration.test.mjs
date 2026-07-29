// Integration coverage for GET /api/v1/clients(/:id) and PATCH /api/v1/clients/:id,
// against the same isolated local Docker database as the other lib/api-v1
// integration suites.
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_API_KEY_PEPPER = "integration-test-pepper-not-a-real-secret";

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { auditLog, crmClients, integrationApiKeys, integrations, organizations } = await import("@/db/schema");
const { and, desc, eq, inArray } = await import("drizzle-orm");
const { generateIntegrationApiKey } = await import("@/lib/integrations/crypto");
const { GET: listClientsRoute } = await import("@/app/api/v1/clients/route");
const { GET: getClientRoute, PATCH: patchClientRoute } = await import("@/app/api/v1/clients/[id]/route");

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

async function createApiKey(organizationId, { scopes = ["clients:read", "clients:update"], status = "active" } = {}) {
  const [integration] = await db
    .insert(integrations)
    .values({ organizationId, name: `api-v1 clients test ${randomUUID()}`, type: "automation", status: "active" })
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
  return generated.plaintextKey;
}

async function createClient(organizationId, overrides = {}) {
  const [client] = await db
    .insert(crmClients)
    .values({
      name: overrides.name ?? "Café Central",
      contactName: overrides.contactName ?? "Jordan Petit",
      email: overrides.email ?? "jordan@example.com",
      phone: overrides.phone ?? "+230 5xxx xxxx",
      address: overrides.address ?? "12 Rue de la Paix",
      stage: overrides.stage ?? "client",
      source: overrides.source ?? "site web",
      ownerName: overrides.ownerName ?? "Agency Staffer",
      notes: overrides.notes ?? "Internal note — must never leak via the API",
      organizationId,
      archivedAt: overrides.archivedAt ?? null,
      createdAt: overrides.createdAt ?? new Date(),
    })
    .returning();
  fixtureClientIds.add(client.id);
  return client;
}

function requestTo(path, { key, method = "GET", body } = {}) {
  const init = { method, headers: key ? { authorization: `Bearer ${key}` } : {} };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  return new Request(`https://example.com${path}`, init);
}

before(async () => {
  orgA = await createOrg("api-v1 clients org A");
  orgB = await createOrg("api-v1 clients org B");
});

afterEach(async () => {
  if (fixtureClientIds.size > 0) {
    await db.delete(crmClients).where(inArray(crmClients.id, [...fixtureClientIds]));
    fixtureClientIds.clear();
  }
});

after(async () => {
  if (fixtureIntegrationIds.size > 0) await db.delete(integrations).where(inArray(integrations.id, [...fixtureIntegrationIds]));
  if (fixtureOrgIds.size > 0) await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

test("GET /api/v1/clients: lists only the calling organization's clients, and never exposes internal fields", async () => {
  const keyA = await createApiKey(orgA.id);
  const clientA = await createClient(orgA.id);
  const clientB = await createClient(orgB.id);

  const response = await listClientsRoute(requestTo("/api/v1/clients", { key: keyA }));
  assert.equal(response.status, 200);
  const body = await response.json();
  const ids = body.data.map((c) => c.id);
  assert.ok(ids.includes(clientA.id));
  assert.equal(ids.includes(clientB.id), false);

  const item = body.data.find((c) => c.id === clientA.id);
  assert.deepEqual(Object.keys(item).sort(), ["address", "contactName", "createdAt", "email", "id", "name", "phone", "stage"]);
});

test("GET /api/v1/clients: a lead with no organization (organizationId IS NULL) is invisible through the API", async () => {
  const keyA = await createApiKey(orgA.id);
  const orphanLead = await createClient(null, { name: "Never onboarded lead" });

  const response = await listClientsRoute(requestTo("/api/v1/clients", { key: keyA }));
  const ids = (await response.json()).data.map((c) => c.id);
  assert.equal(ids.includes(orphanLead.id), false);

  const getResponse = await getClientRoute(requestTo(`/api/v1/clients/${orphanLead.id}`, { key: keyA }), { params: Promise.resolve({ id: orphanLead.id }) });
  assert.equal(getResponse.status, 404);
});

test("GET /api/v1/clients: an archived client is excluded from the list and from direct GET", async () => {
  const keyA = await createApiKey(orgA.id);
  const archived = await createClient(orgA.id, { archivedAt: new Date() });

  const listResponse = await listClientsRoute(requestTo("/api/v1/clients", { key: keyA }));
  assert.equal((await listResponse.json()).data.some((c) => c.id === archived.id), false);

  const getResponse = await getClientRoute(requestTo(`/api/v1/clients/${archived.id}`, { key: keyA }), { params: Promise.resolve({ id: archived.id }) });
  assert.equal(getResponse.status, 404);
});

test("GET /api/v1/clients/:id: a client belonging to another organization gets the exact same 404 as a nonexistent id", async () => {
  const keyA = await createApiKey(orgA.id);
  const clientB = await createClient(orgB.id);

  const crossOrg = await getClientRoute(requestTo(`/api/v1/clients/${clientB.id}`, { key: keyA }), { params: Promise.resolve({ id: clientB.id }) });
  const missing = await getClientRoute(requestTo(`/api/v1/clients/${randomUUID()}`, { key: keyA }), { params: Promise.resolve({ id: randomUUID() }) });

  assert.equal(crossOrg.status, 404);
  assert.equal(missing.status, 404);
  const [crossOrgBody, missingBody] = await Promise.all([crossOrg.json(), missing.json()]);
  assert.deepEqual(crossOrgBody, { ...missingBody, error: { ...missingBody.error, requestId: crossOrgBody.error.requestId } });
});

test("GET /api/v1/clients: a key without clients:read is rejected with FORBIDDEN_SCOPE", async () => {
  const keyNoScope = await createApiKey(orgA.id, { scopes: ["clients:update"] });
  const response = await listClientsRoute(requestTo("/api/v1/clients", { key: keyNoScope }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN_SCOPE");
});

test("PATCH /api/v1/clients/:id: a key without clients:update is rejected with FORBIDDEN_SCOPE, and the client is left unmodified", async () => {
  const keyReadOnly = await createApiKey(orgA.id, { scopes: ["clients:read"] });
  const client = await createClient(orgA.id, { name: "Original Name" });

  const response = await patchClientRoute(requestTo(`/api/v1/clients/${client.id}`, { key: keyReadOnly, method: "PATCH", body: { name: "Hacked Name" } }), {
    params: Promise.resolve({ id: client.id }),
  });
  assert.equal(response.status, 403);

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, client.id)).limit(1);
  assert.equal(row.name, "Original Name");
});

test("a revoked key is rejected on every clients route", async () => {
  const revokedKey = await createApiKey(orgA.id, { status: "revoked" });
  const client = await createClient(orgA.id);

  for (const response of await Promise.all([
    listClientsRoute(requestTo("/api/v1/clients", { key: revokedKey })),
    getClientRoute(requestTo(`/api/v1/clients/${client.id}`, { key: revokedKey }), { params: Promise.resolve({ id: client.id }) }),
    patchClientRoute(requestTo(`/api/v1/clients/${client.id}`, { key: revokedKey, method: "PATCH", body: { name: "x" } }), { params: Promise.resolve({ id: client.id }) }),
  ])) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "API_KEY_REVOKED");
  }
});

test("PATCH /api/v1/clients/:id: an empty body is rejected — no silent no-op update", async () => {
  const keyA = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const response = await patchClientRoute(requestTo(`/api/v1/clients/${client.id}`, { key: keyA, method: "PATCH", body: {} }), { params: Promise.resolve({ id: client.id }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("PATCH /api/v1/clients/:id: attempting to set organizationId, stage, ownerName, notes, source, id, or createdAt is rejected wholesale, and the client is left unmodified", async () => {
  const keyA = await createApiKey(orgA.id);
  const client = await createClient(orgA.id, { stage: "client", name: "Untouched" });

  const attempts = [
    { organizationId: orgB.id },
    { stage: "churned" },
    { ownerName: "New owner" },
    { notes: "injected notes" },
    { source: "hacked" },
    { id: randomUUID() },
    { createdAt: "2020-01-01T00:00:00Z" },
    { archivedAt: "2020-01-01T00:00:00Z" },
    { name: "Sneaky Rename", stage: "churned" }, // mixing one allowed field with one forbidden one must still fail entirely
  ];

  for (const body of attempts) {
    const response = await patchClientRoute(requestTo(`/api/v1/clients/${client.id}`, { key: keyA, method: "PATCH", body }), { params: Promise.resolve({ id: client.id }) });
    assert.equal(response.status, 400, `${JSON.stringify(body)} should be rejected`);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  }

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, client.id)).limit(1);
  assert.equal(row.stage, "client");
  assert.equal(row.name, "Untouched");
  assert.equal(row.organizationId, orgA.id);
});

test("PATCH /api/v1/clients/:id: a well-formed update to whitelisted fields succeeds and is reflected in a subsequent GET", async () => {
  const keyA = await createApiKey(orgA.id);
  const client = await createClient(orgA.id, { name: "Old Name", phone: "+230 0000 0000" });

  const patchResponse = await patchClientRoute(
    requestTo(`/api/v1/clients/${client.id}`, { key: keyA, method: "PATCH", body: { name: "New Name", phone: null } }),
    { params: Promise.resolve({ id: client.id }) },
  );
  assert.equal(patchResponse.status, 200);
  const patchBody = await patchResponse.json();
  assert.equal(patchBody.data.name, "New Name");
  assert.equal(patchBody.data.phone, null);

  const getResponse = await getClientRoute(requestTo(`/api/v1/clients/${client.id}`, { key: keyA }), { params: Promise.resolve({ id: client.id }) });
  const getBody = await getResponse.json();
  assert.equal(getBody.data.name, "New Name");
});

test("PATCH /api/v1/clients/:id: cannot write to another organization's client — matches zero rows, returns the same 404", async () => {
  const keyA = await createApiKey(orgA.id);
  const clientB = await createClient(orgB.id, { name: "Org B's client" });

  const response = await patchClientRoute(requestTo(`/api/v1/clients/${clientB.id}`, { key: keyA, method: "PATCH", body: { name: "Overwritten" } }), {
    params: Promise.resolve({ id: clientB.id }),
  });
  assert.equal(response.status, 404);

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, clientB.id)).limit(1);
  assert.equal(row.name, "Org B's client");
});

test("PATCH /api/v1/clients/:id: malformed JSON body is a clean 400, not a 500", async () => {
  const keyA = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);
  const response = await patchClientRoute(requestTo(`/api/v1/clients/${client.id}`, { key: keyA, method: "PATCH", body: "{not valid json" }), {
    params: Promise.resolve({ id: client.id }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("GET /api/v1/clients: stage filter and q search only use real columns and narrow results correctly", async () => {
  const keyA = await createApiKey(orgA.id);
  const lead = await createClient(orgA.id, { stage: "lead", name: "Lead Business" });
  const client = await createClient(orgA.id, { stage: "client", name: "distinctive-search-marker" });

  const byStage = await listClientsRoute(requestTo("/api/v1/clients?stage=lead", { key: keyA }));
  const stageIds = (await byStage.json()).data.map((c) => c.id);
  assert.ok(stageIds.includes(lead.id));
  assert.equal(stageIds.includes(client.id), false);

  const bySearch = await listClientsRoute(requestTo("/api/v1/clients?q=distinctive-search-marker", { key: keyA }));
  const searchIds = (await bySearch.json()).data.map((c) => c.id);
  assert.deepEqual(searchIds, [client.id]);
});

test("PATCH success is journalized with only the changed FIELD NAMES, never the new values (no personal data logged)", async () => {
  const keyA = await createApiKey(orgA.id);
  const client = await createClient(orgA.id);

  await patchClientRoute(
    requestTo(`/api/v1/clients/${client.id}`, { key: keyA, method: "PATCH", body: { email: "brand-new-secret-address@example.com" } }),
    { params: Promise.resolve({ id: client.id }) },
  );

  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "api_v1.clients.updated"), eq(auditLog.targetId, client.id)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  assert.ok(entry);
  assert.deepEqual(entry.metadata.fields, ["email"]);
  assert.equal(JSON.stringify(entry.metadata).includes("brand-new-secret-address@example.com"), false, "the new email value must never be logged");
});
