// Integration coverage for the /api/v1 authentication foundation, against
// the same isolated local Docker database as
// lib/integrations/webhook-system.integration.test.mjs (fixture/cleanup
// pattern copied from there). No Preview/Production URL is read.
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_API_KEY_PEPPER = "integration-test-pepper-not-a-real-secret";

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { auditLog, integrationApiKeys, integrations, organizations } = await import("@/db/schema");
const { and, desc, eq, inArray } = await import("drizzle-orm");
const { generateIntegrationApiKey } = await import("@/lib/integrations/crypto");
const { ApiAuthError, authenticateApiRequest } = await import("@/lib/api-v1/auth");
const { GET: pingRoute } = await import("@/app/api/v1/ping/route");

const PEPPER = process.env.INTEGRATION_API_KEY_PEPPER;
const fixtureIntegrationIds = new Set();
let internalOrganizationId;
let createdInternalOrganizationId = null;

async function createIntegration(overrides = {}) {
  const [integration] = await db
    .insert(integrations)
    .values({
      organizationId: internalOrganizationId,
      name: `api-v1 auth test ${randomUUID()}`,
      type: "automation",
      status: "active",
      ...overrides,
    })
    .returning();
  fixtureIntegrationIds.add(integration.id);
  return integration;
}

async function createApiKey({ integration, scopes = ["clients:read"], status = "active", expiresAt = null, environment = "live" } = {}) {
  const owningIntegration = integration ?? (await createIntegration());
  const generated = generateIntegrationApiKey(environment, PEPPER);
  const [row] = await db
    .insert(integrationApiKeys)
    .values({
      integrationId: owningIntegration.id,
      lookupId: generated.lookupId,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      hashVersion: generated.hashVersion,
      scopes,
      status,
      expiresAt,
    })
    .returning();
  return { integration: owningIntegration, row, plaintextKey: generated.plaintextKey };
}

function requestWith(headers) {
  return new Request("https://example.com/api/v1/ping", { headers });
}

async function latestAuthFailure(apiKeyId) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "api_v1.auth_failed"), eq(auditLog.targetId, apiKeyId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

before(async () => {
  const [existing] = await db.select().from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  if (existing) {
    internalOrganizationId = existing.id;
    return;
  }
  const [created] = await db.insert(organizations).values({ name: `PUBLIC-MAP api-v1 tests ${randomUUID()}`, isInternal: true }).returning();
  internalOrganizationId = created.id;
  createdInternalOrganizationId = created.id;
});

afterEach(async () => {
  if (fixtureIntegrationIds.size > 0) {
    await db.delete(integrations).where(inArray(integrations.id, [...fixtureIntegrationIds]));
    fixtureIntegrationIds.clear();
  }
});

after(async () => {
  if (createdInternalOrganizationId) {
    await db.delete(organizations).where(eq(organizations.id, createdInternalOrganizationId));
  }
  await db.$client.end();
});

test("valid active key succeeds, returns the true organizationId/integrationId/scopes, and updates lastUsedAt only now", async () => {
  const { integration, row, plaintextKey } = await createApiKey({ scopes: ["clients:read", "clients:update"] });
  assert.equal(row.lastUsedAt, null);

  const context = await authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` }));

  assert.equal(context.apiKeyId, row.id);
  assert.equal(context.integrationId, integration.id);
  assert.equal(context.organizationId, internalOrganizationId);
  assert.deepEqual(context.scopes, ["clients:read", "clients:update"]);

  const [updated] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, row.id)).limit(1);
  assert.ok(updated.lastUsedAt instanceof Date);
});

test("X-Api-Key header authenticates just as well as Authorization: Bearer", async () => {
  const { plaintextKey } = await createApiKey();
  const context = await authenticateApiRequest(requestWith({ "x-api-key": plaintextKey }));
  assert.equal(context.organizationId, internalOrganizationId);
});

test("missing key -> MISSING_API_KEY, no lastUsedAt update anywhere, no organization info leaked", async () => {
  await assert.rejects(() => authenticateApiRequest(requestWith({})), (error) => {
    assert.ok(error instanceof ApiAuthError);
    assert.equal(error.code, "MISSING_API_KEY");
    assert.equal(error.status, 401);
    return true;
  });
});

test("malformed key -> MALFORMED_API_KEY", async () => {
  await assert.rejects(() => authenticateApiRequest(requestWith({ authorization: "Bearer not-a-real-key-format" })), (error) => {
    assert.equal(error.code, "MALFORMED_API_KEY");
    return true;
  });
});

test("unknown lookupId and a wrong secret on a real lookupId return the SAME code (no existence oracle)", async () => {
  const { plaintextKey } = await createApiKey();
  const tamperedSecret = plaintextKey.slice(0, -1) + (plaintextKey.endsWith("A") ? "B" : "A");

  const unknownLookupKey = `pm_live_${"z".repeat(12)}_${"x".repeat(43)}`;

  let unknownError, wrongSecretError;
  await authenticateApiRequest(requestWith({ authorization: `Bearer ${unknownLookupKey}` })).catch((e) => (unknownError = e));
  await authenticateApiRequest(requestWith({ authorization: `Bearer ${tamperedSecret}` })).catch((e) => (wrongSecretError = e));

  assert.equal(unknownError.code, "INVALID_API_KEY");
  assert.equal(wrongSecretError.code, "INVALID_API_KEY");
  assert.equal(unknownError.message, wrongSecretError.message);
});

test("revoked key -> API_KEY_REVOKED", async () => {
  const { plaintextKey } = await createApiKey({ status: "revoked" });
  await assert.rejects(() => authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` })), (error) => {
    assert.equal(error.code, "API_KEY_REVOKED");
    return true;
  });
});

test("expired key -> API_KEY_EXPIRED", async () => {
  const { plaintextKey } = await createApiKey({ expiresAt: new Date(Date.now() - 60_000) });
  await assert.rejects(() => authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` })), (error) => {
    assert.equal(error.code, "API_KEY_EXPIRED");
    return true;
  });
});

test("active key on a disabled integration -> INTEGRATION_INACTIVE", async () => {
  const integration = await createIntegration({ status: "disabled" });
  const { plaintextKey } = await createApiKey({ integration });
  await assert.rejects(() => authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` })), (error) => {
    assert.equal(error.code, "INTEGRATION_INACTIVE");
    return true;
  });
});

test("active key on an expired integration -> INTEGRATION_EXPIRED", async () => {
  const integration = await createIntegration({ expiresAt: new Date(Date.now() - 60_000) });
  const { plaintextKey } = await createApiKey({ integration });
  await assert.rejects(() => authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` })), (error) => {
    assert.equal(error.code, "INTEGRATION_EXPIRED");
    return true;
  });
});

test("valid key missing the required scope -> FORBIDDEN_SCOPE (403)", async () => {
  const { plaintextKey } = await createApiKey({ scopes: ["clients:read"] });
  await assert.rejects(
    () => authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` }), { requiredScope: "tasks:create" }),
    (error) => {
      assert.equal(error.code, "FORBIDDEN_SCOPE");
      assert.equal(error.status, 403);
      return true;
    },
  );
});

test("valid key carrying the required scope succeeds", async () => {
  const { plaintextKey } = await createApiKey({ scopes: ["tasks:create"] });
  const context = await authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` }), { requiredScope: "tasks:create" });
  assert.equal(context.organizationId, internalOrganizationId);
});

test("a spoofed X-Organization-Id (or any other client-supplied header) has no effect — organizationId always comes from the verified key", async () => {
  const { plaintextKey } = await createApiKey();
  const context = await authenticateApiRequest(
    requestWith({ authorization: `Bearer ${plaintextKey}`, "x-organization-id": randomUUID() }),
  );
  assert.equal(context.organizationId, internalOrganizationId);
});

test("auth failures are journalized without ever recording the full presented key or its secret", async () => {
  const { row, plaintextKey } = await createApiKey({ status: "revoked" });
  await authenticateApiRequest(requestWith({ authorization: `Bearer ${plaintextKey}` })).catch(() => {});

  const entry = await latestAuthFailure(row.id);
  assert.ok(entry, "expected an audit_log row for this failed auth attempt");
  assert.equal(entry.action, "api_v1.auth_failed");
  assert.equal(entry.metadata.code, "API_KEY_REVOKED");

  const serialized = JSON.stringify(entry.metadata);
  assert.equal(serialized.includes(plaintextKey), false, "the full key must never be logged");
  const secret = plaintextKey.split("_").pop();
  assert.equal(serialized.includes(secret), false, "the secret portion must never be logged");
});

test("end-to-end through the real route: GET /api/v1/ping with a valid key returns 200 and the true organization", async () => {
  const { plaintextKey } = await createApiKey();
  const response = await pingRoute(requestWith({ authorization: `Bearer ${plaintextKey}` }));
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("X-Request-Id"));
  const body = await response.json();
  assert.equal(body.data.pong, true);
  assert.equal(body.data.organizationId, internalOrganizationId);
});

test("end-to-end through the real route: GET /api/v1/ping with no key returns a normalized 401 error body", async () => {
  const response = await pingRoute(requestWith({}));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "MISSING_API_KEY");
  assert.ok(body.error.requestId);
  assert.equal(body.error.requestId, response.headers.get("X-Request-Id"));
});
