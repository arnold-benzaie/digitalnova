// Integration coverage for GET /api/v1/audits(/:id) and /api/v1/reports(/:id),
// against the same isolated local Docker database as
// lib/api-v1/auth.integration.test.mjs (fixture pattern copied from there).
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_API_KEY_PEPPER = "integration-test-pepper-not-a-real-secret";

mock.module("server-only", { defaultExport: {} });

const { db } = await import("@/db");
const { auditIssues, audits, auditLog, integrationApiKeys, integrations, locations, organizations } = await import("@/db/schema");
const { and, desc, eq, inArray } = await import("drizzle-orm");
const { generateIntegrationApiKey } = await import("@/lib/integrations/crypto");
const { GET: listAuditsRoute } = await import("@/app/api/v1/audits/route");
const { GET: getAuditRoute } = await import("@/app/api/v1/audits/[id]/route");
const { GET: listReportsRoute } = await import("@/app/api/v1/reports/route");
const { GET: getReportRoute } = await import("@/app/api/v1/reports/[id]/route");

const PEPPER = process.env.INTEGRATION_API_KEY_PEPPER;
const fixtureOrgIds = new Set();
const fixtureIntegrationIds = new Set();
const fixtureAuditIds = new Set();
let orgA; // the organization our API key belongs to
let orgB; // a different organization, used to prove isolation

async function createOrg(name) {
  const [org] = await db.insert(organizations).values({ name: `${name} ${randomUUID()}` }).returning();
  fixtureOrgIds.add(org.id);
  return org;
}

async function createApiKey(organizationId, { scopes = ["audits:read", "reports:read"], status = "active" } = {}) {
  const [integration] = await db
    .insert(integrations)
    .values({ organizationId, name: `api-v1 audits test ${randomUUID()}`, type: "automation", status: "active" })
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

async function createAudit(organizationId, overrides = {}) {
  const [location] = overrides.locationId === undefined
    ? await db.insert(locations).values({
        organizationId,
        googleLocationId: `loc-${randomUUID()}`,
        name: overrides.locationName ?? "Café Central",
        address: "12 Rue de la Paix",
      }).returning()
    : [null];

  const [audit] = await db
    .insert(audits)
    .values({
      organizationId,
      locationId: overrides.locationId === undefined ? location.id : overrides.locationId,
      score: overrides.score ?? 80,
      summary: overrides.summary ?? "Automated test audit",
      createdAt: overrides.createdAt ?? new Date(),
    })
    .returning();
  fixtureAuditIds.add(audit.id);
  return audit;
}

async function addIssue(auditId, { priority = "medium", title = "Test issue" } = {}) {
  await db.insert(auditIssues).values({ auditId, title, priority, description: null, recommendation: null });
}

function requestTo(path, { key, headers = {} } = {}) {
  return new Request(`https://example.com${path}`, {
    headers: key ? { authorization: `Bearer ${key}`, ...headers } : headers,
  });
}

before(async () => {
  orgA = await createOrg("api-v1 audits org A");
  orgB = await createOrg("api-v1 audits org B");
});

afterEach(async () => {
  if (fixtureAuditIds.size > 0) {
    await db.delete(audits).where(inArray(audits.id, [...fixtureAuditIds]));
    fixtureAuditIds.clear();
  }
});

after(async () => {
  if (fixtureIntegrationIds.size > 0) await db.delete(integrations).where(inArray(integrations.id, [...fixtureIntegrationIds]));
  if (fixtureOrgIds.size > 0) await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

test("GET /api/v1/audits: lists only the calling organization's audits, never another org's", async () => {
  const keyA = await createApiKey(orgA.id);
  const auditA = await createAudit(orgA.id, { summary: "Belongs to org A" });
  const auditB = await createAudit(orgB.id, { summary: "Belongs to org B — must never appear" });

  const response = await listAuditsRoute(requestTo("/api/v1/audits", { key: keyA }));
  assert.equal(response.status, 200);
  const body = await response.json();
  const ids = body.data.map((a) => a.id);
  assert.ok(ids.includes(auditA.id));
  assert.equal(ids.includes(auditB.id), false);
});

test("GET /api/v1/audits/:id: an id belonging to another organization returns the exact same 404 as a nonexistent id", async () => {
  const keyA = await createApiKey(orgA.id);
  const auditB = await createAudit(orgB.id);

  const crossOrgResponse = await getAuditRoute(requestTo(`/api/v1/audits/${auditB.id}`, { key: keyA }), { params: Promise.resolve({ id: auditB.id }) });
  const missingResponse = await getAuditRoute(requestTo(`/api/v1/audits/${randomUUID()}`, { key: keyA }), { params: Promise.resolve({ id: randomUUID() }) });

  assert.equal(crossOrgResponse.status, 404);
  assert.equal(missingResponse.status, 404);
  const [crossOrgBody, missingBody] = await Promise.all([crossOrgResponse.json(), missingResponse.json()]);
  assert.equal(crossOrgBody.error.code, missingBody.error.code);
  assert.equal(crossOrgBody.error.message, missingBody.error.message);
});

test("GET /api/v1/audits/:id: a syntactically invalid id is a 400, not a 404 or 500", async () => {
  const keyA = await createApiKey(orgA.id);
  const response = await getAuditRoute(requestTo("/api/v1/audits/not-a-uuid", { key: keyA }), { params: Promise.resolve({ id: "not-a-uuid" }) });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("GET /api/v1/audits/:id: own organization's audit succeeds and embeds location safely (no Google-side ids)", async () => {
  const keyA = await createApiKey(orgA.id);
  const audit = await createAudit(orgA.id, { score: 91, summary: "Great presence" });

  const response = await getAuditRoute(requestTo(`/api/v1/audits/${audit.id}`, { key: keyA }), { params: Promise.resolve({ id: audit.id }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.score, 91);
  assert.deepEqual(Object.keys(body.data).sort(), ["createdAt", "id", "location", "score", "summary"]);
  assert.deepEqual(Object.keys(body.data.location).sort(), ["address", "id", "name"]);
});

test("GET /api/v1/audits: a key without the audits:read scope is rejected with FORBIDDEN_SCOPE", async () => {
  const keyNoScope = await createApiKey(orgA.id, { scopes: ["reports:read"] });
  const response = await listAuditsRoute(requestTo("/api/v1/audits", { key: keyNoScope }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "FORBIDDEN_SCOPE");
});

test("GET /api/v1/reports: a key without the reports:read scope is rejected with FORBIDDEN_SCOPE", async () => {
  const keyNoScope = await createApiKey(orgA.id, { scopes: ["audits:read"] });
  const response = await listReportsRoute(requestTo("/api/v1/reports", { key: keyNoScope }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "FORBIDDEN_SCOPE");
});

test("a revoked key is rejected on every audits/reports route, not just /ping", async () => {
  const revokedKey = await createApiKey(orgA.id, { status: "revoked" });
  const audit = await createAudit(orgA.id);

  for (const response of await Promise.all([
    listAuditsRoute(requestTo("/api/v1/audits", { key: revokedKey })),
    getAuditRoute(requestTo(`/api/v1/audits/${audit.id}`, { key: revokedKey }), { params: Promise.resolve({ id: audit.id }) }),
    listReportsRoute(requestTo("/api/v1/reports", { key: revokedKey })),
    getReportRoute(requestTo(`/api/v1/reports/${audit.id}`, { key: revokedKey }), { params: Promise.resolve({ id: audit.id }) }),
  ])) {
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "API_KEY_REVOKED");
  }
});

test("GET /api/v1/audits: rejects an out-of-range limit and a malformed cursor, both as 400 VALIDATION_ERROR", async () => {
  const keyA = await createApiKey(orgA.id);

  const badLimit = await listAuditsRoute(requestTo("/api/v1/audits?limit=0", { key: keyA }));
  assert.equal(badLimit.status, 400);
  assert.equal((await badLimit.json()).error.code, "VALIDATION_ERROR");

  const tooBigLimit = await listAuditsRoute(requestTo("/api/v1/audits?limit=1000", { key: keyA }));
  assert.equal(tooBigLimit.status, 400);

  const badCursor = await listAuditsRoute(requestTo("/api/v1/audits?cursor=not-a-real-cursor", { key: keyA }));
  assert.equal(badCursor.status, 400);
  assert.equal((await badCursor.json()).error.code, "VALIDATION_ERROR");
});

test("GET /api/v1/audits: cursor pagination walks every row exactly once, in stable order, no duplicates or gaps", async () => {
  const keyA = await createApiKey(orgA.id);
  const base = Date.now();
  const created = [];
  for (let i = 0; i < 5; i++) {
    created.push(await createAudit(orgA.id, { summary: `Paginated ${i}`, createdAt: new Date(base - i * 1000) }));
  }

  const seenIds = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "2" });
    if (cursor) qs.set("cursor", cursor);
    const response = await listAuditsRoute(requestTo(`/api/v1/audits?${qs}`, { key: keyA }));
    assert.equal(response.status, 200);
    const body = await response.json();
    seenIds.push(...body.data.map((a) => a.id));
    cursor = body.pagination.nextCursor;
    if (!cursor) break;
  }

  const expectedIds = created.map((a) => a.id);
  assert.deepEqual([...seenIds].sort(), [...expectedIds].sort(), "every created audit must be seen exactly once across pages");
  assert.equal(new Set(seenIds).size, seenIds.length, "no id should repeat across pages");
});

test("GET /api/v1/audits: from/to and q filters narrow the result set", async () => {
  const keyA = await createApiKey(orgA.id);
  const old = await createAudit(orgA.id, { summary: "old one", createdAt: new Date("2020-01-01T00:00:00Z") });
  const recent = await createAudit(orgA.id, { summary: "distinctive-marker-xyz", createdAt: new Date() });

  const dateFiltered = await listAuditsRoute(requestTo("/api/v1/audits?from=2025-01-01T00:00:00Z", { key: keyA }));
  const dateIds = (await dateFiltered.json()).data.map((a) => a.id);
  assert.equal(dateIds.includes(recent.id), true);
  assert.equal(dateIds.includes(old.id), false);

  const searched = await listAuditsRoute(requestTo("/api/v1/audits?q=distinctive-marker-xyz", { key: keyA }));
  const searchIds = (await searched.json()).data.map((a) => a.id);
  assert.deepEqual(searchIds, [recent.id]);
});

test("GET /api/v1/reports: list items carry accurate issue counts by priority, batched across the page", async () => {
  const keyA = await createApiKey(orgA.id);
  const audit = await createAudit(orgA.id);
  await addIssue(audit.id, { priority: "high" });
  await addIssue(audit.id, { priority: "high" });
  await addIssue(audit.id, { priority: "low" });

  const response = await listReportsRoute(requestTo("/api/v1/reports", { key: keyA }));
  const item = (await response.json()).data.find((r) => r.id === audit.id);
  assert.deepEqual(item.issueCounts, { low: 1, medium: 0, high: 2 });
  assert.equal(item.issueCount, 3);
});

test("GET /api/v1/reports/:id: embeds the full issue list; a cross-org id gets the same 404 as /audits/:id", async () => {
  const keyA = await createApiKey(orgA.id);
  const audit = await createAudit(orgA.id);
  await addIssue(audit.id, { priority: "high", title: "No booking link" });

  const response = await getReportRoute(requestTo(`/api/v1/reports/${audit.id}`, { key: keyA }), { params: Promise.resolve({ id: audit.id }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.issues.length, 1);
  assert.equal(body.data.issues[0].title, "No booking link");

  const auditB = await createAudit(orgB.id);
  const crossOrg = await getReportRoute(requestTo(`/api/v1/reports/${auditB.id}`, { key: keyA }), { params: Promise.resolve({ id: auditB.id }) });
  assert.equal(crossOrg.status, 404);
});

test("a successful call is journalized in audit_log under the caller's own organization", async () => {
  const keyA = await createApiKey(orgA.id);
  const audit = await createAudit(orgA.id);

  await getAuditRoute(requestTo(`/api/v1/audits/${audit.id}`, { key: keyA }), { params: Promise.resolve({ id: audit.id }) });

  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "api_v1.audits.retrieved"), eq(auditLog.targetId, audit.id)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  assert.ok(entry, "expected a success log entry");
  assert.equal(entry.organizationId, orgA.id);
});
