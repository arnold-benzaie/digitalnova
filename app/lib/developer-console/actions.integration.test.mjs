// Integration tests for lib/developer-console/actions.ts — self-service
// API key create/revoke/rotate/rename for the Developer Console
// (/developers/console).
//
// Same mocking convention as lib/actions/user-approval.test.mjs and
// lib/dev-role.test.mjs: only @/lib/session's requireSession() is
// mocked (fabricated session pointing at a real seeded organization) and
// next/cache's revalidatePath (no-op outside a real request). Everything
// else — the actions under test, lib/integrations/crypto.ts,
// lib/audit.ts, the real Drizzle queries/transactions — runs unmodified
// against the real local Docker database. @clerk/nextjs/server itself is
// deliberately not mocked (see user-approval.test.mjs's docstring for
// why); Clerk-facing auth is covered by e2e, not here.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/developer-console/actions.integration.test.mjs
import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("Refusing non-local integration test database.");
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_API_KEY_PEPPER = "developer-console-test-pepper-not-a-real-secret";

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

/** @type {{ userId: string; organizationId: string; organizationName: string } | null} */
let currentSession = null;

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!currentSession) throw new Error("test bug: no session configured — call asUser() first");
      return {
        userId: currentSession.userId,
        clerkUserId: `test_clerk_${currentSession.userId}`,
        email: "dev@example.com",
        fullName: "Dev Console Test User",
        organizationId: currentSession.organizationId,
        organizationName: currentSession.organizationName,
        role: "client",
      };
    },
  },
});

const { db } = await import("@/db");
const { auditLog, integrationApiKeys, integrations, organizations, users, memberships, roles } = await import("@/db/schema");
const { and, eq, inArray } = await import("drizzle-orm");
const {
  createDeveloperApiKey,
  revokeDeveloperApiKey,
  rotateDeveloperApiKey,
  renameDeveloperApiKey,
} = await import("./actions.ts");

const fixtureOrgIds = new Set();
const fixtureUserIds = new Set();
let orgA;
let orgB;
let userA;

async function createOrgWithUser(name) {
  const [org] = await db.insert(organizations).values({ name: `${name} ${randomUUID()}` }).returning();
  fixtureOrgIds.add(org.id);

  const [role] = await db.select().from(roles).where(eq(roles.name, "client")).limit(1);
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "Test User" })
    .returning();
  fixtureUserIds.add(user.id);
  await db.insert(memberships).values({ userId: user.id, organizationId: org.id, roleId: role.id });

  return { org, user };
}

function asUser(user, org) {
  currentSession = { userId: user.id, organizationId: org.id, organizationName: org.name };
}

function makeScopesFormData(scopes, extra = {}) {
  const formData = new FormData();
  for (const scope of scopes) formData.append("scopes", scope);
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  return formData;
}

before(async () => {
  ({ org: orgA, user: userA } = await createOrgWithUser("dev-console org A"));
  ({ org: orgB } = await createOrgWithUser("dev-console org B"));
});

afterEach(async () => {
  const integrationRows = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(inArray(integrations.organizationId, [orgA.id, orgB.id]));
  const integrationIds = integrationRows.map((r) => r.id);
  if (integrationIds.length > 0) {
    await db.delete(integrationApiKeys).where(inArray(integrationApiKeys.integrationId, integrationIds));
  }
  await db.delete(auditLog).where(inArray(auditLog.organizationId, [orgA.id, orgB.id]));
});

after(async () => {
  const integrationRows = await db.select({ id: integrations.id }).from(integrations).where(inArray(integrations.organizationId, [orgA.id, orgB.id]));
  if (integrationRows.length > 0) await db.delete(integrations).where(inArray(integrations.id, integrationRows.map((r) => r.id)));
  await db.delete(memberships).where(inArray(memberships.organizationId, [orgA.id, orgB.id]));
  await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
  await db.delete(organizations).where(inArray(organizations.id, [...fixtureOrgIds]));
  await db.$client.end();
});

test("createDeveloperApiKey: creates a real key scoped to the caller's own organization, with a name", async () => {
  asUser(userA, orgA);
  const result = await createDeveloperApiKey(makeScopesFormData(["audits:read"], { name: "Production" }));

  assert.ok(result.plaintextKey.startsWith("pm_live_"));

  const [integration] = await db.select().from(integrations).where(eq(integrations.organizationId, orgA.id)).limit(1);
  assert.ok(integration, "getOrCreateDefaultIntegration should have created an integration for orgA");

  const [key] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.integrationId, integration.id)).limit(1);
  assert.equal(key.name, "Production");
  assert.deepEqual(key.scopes, ["audits:read"]);
  assert.equal(key.status, "active");

  const [event] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, orgA.id), eq(auditLog.action, "apikey.created")))
    .limit(1);
  assert.ok(event, "apikey.created audit event must be recorded");
  assert.equal(event.metadata.name, "Production");
});

test("createDeveloperApiKey: rejects an empty scope selection", async () => {
  asUser(userA, orgA);
  await assert.rejects(() => createDeveloperApiKey(makeScopesFormData([])), /portée|scope/i);
});

test("createDeveloperApiKey: rejects an unknown scope", async () => {
  asUser(userA, orgA);
  await assert.rejects(() => createDeveloperApiKey(makeScopesFormData(["not:a:real:scope"])), /portée|scope/i);
});

test("revokeDeveloperApiKey: a member CANNOT revoke another organization's key — same not-found as a nonexistent id", async () => {
  asUser(userA, orgA);
  await createDeveloperApiKey(makeScopesFormData(["audits:read"]));
  const [integrationA] = await db.select().from(integrations).where(eq(integrations.organizationId, orgA.id)).limit(1);
  const [keyA] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.integrationId, integrationA.id)).limit(1);

  // Switch the mocked session to a DIFFERENT organization, then attempt
  // to revoke orgA's key — this is the critical cross-org isolation test.
  const { org: orgC, user: userC } = await createOrgWithUser("dev-console org C (isolation probe)");
  asUser(userC, orgC);

  await assert.rejects(() => revokeDeveloperApiKey(keyA.id), /introuvable|not found/i);

  const [stillActive] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, keyA.id)).limit(1);
  assert.equal(stillActive.status, "active", "orgA's key must be untouched by orgC's attempt");

  await db.delete(memberships).where(eq(memberships.organizationId, orgC.id));
  await db.delete(users).where(eq(users.id, userC.id));
  await db.delete(organizations).where(eq(organizations.id, orgC.id));
});

test("revokeDeveloperApiKey: the owning organization's member CAN revoke their own key", async () => {
  asUser(userA, orgA);
  await createDeveloperApiKey(makeScopesFormData(["audits:read"]));
  const [integrationA] = await db.select().from(integrations).where(eq(integrations.organizationId, orgA.id)).limit(1);
  const [keyA] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.integrationId, integrationA.id)).limit(1);

  await revokeDeveloperApiKey(keyA.id);

  const [revoked] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, keyA.id)).limit(1);
  assert.equal(revoked.status, "revoked");
  assert.ok(revoked.revokedAt);
});

test("rotateDeveloperApiKey: revokes the old key and issues a new one with the same scopes/name", async () => {
  asUser(userA, orgA);
  await createDeveloperApiKey(makeScopesFormData(["audits:read", "clients:read"], { name: "Zapier" }));
  const [integrationA] = await db.select().from(integrations).where(eq(integrations.organizationId, orgA.id)).limit(1);
  const [oldKey] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.integrationId, integrationA.id)).limit(1);

  const result = await rotateDeveloperApiKey(oldKey.id);
  assert.ok(result.plaintextKey.startsWith("pm_live_"));

  const [revokedOld] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, oldKey.id)).limit(1);
  assert.equal(revokedOld.status, "revoked");

  const [newKey] = await db
    .select()
    .from(integrationApiKeys)
    .where(and(eq(integrationApiKeys.integrationId, integrationA.id), eq(integrationApiKeys.status, "active")))
    .limit(1);
  assert.ok(newKey, "a new active key must exist after rotation");
  assert.notEqual(newKey.id, oldKey.id);
  assert.equal(newKey.name, "Zapier");
  assert.deepEqual(newKey.scopes, ["audits:read", "clients:read"]);
});

test("renameDeveloperApiKey: updates the name and records the previous name in the audit log", async () => {
  asUser(userA, orgA);
  await createDeveloperApiKey(makeScopesFormData(["audits:read"], { name: "Old name" }));
  const [integrationA] = await db.select().from(integrations).where(eq(integrations.organizationId, orgA.id)).limit(1);
  const [key] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.integrationId, integrationA.id)).limit(1);

  const formData = new FormData();
  formData.set("name", "New name");
  await renameDeveloperApiKey(key.id, formData);

  const [renamed] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, key.id)).limit(1);
  assert.equal(renamed.name, "New name");

  const [event] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, orgA.id), eq(auditLog.action, "apikey.renamed")))
    .limit(1);
  assert.equal(event.metadata.previousName, "Old name");
  assert.equal(event.metadata.name, "New name");
});

test("createDeveloperApiKey: two different organizations' keys never collide or leak into each other's list", async () => {
  asUser(userA, orgA);
  await createDeveloperApiKey(makeScopesFormData(["audits:read"], { name: "Org A key" }));

  const { org: orgD, user: userD } = await createOrgWithUser("dev-console org D (list isolation)");
  asUser(userD, orgD);
  await createDeveloperApiKey(makeScopesFormData(["clients:read"], { name: "Org D key" }));

  const { listApiKeysForOrg } = await import("./queries.ts");
  const orgAKeys = await listApiKeysForOrg(orgA.id);
  const orgDKeys = await listApiKeysForOrg(orgD.id);

  assert.ok(orgAKeys.every((k) => k.name !== "Org D key"));
  assert.ok(orgDKeys.every((k) => k.name !== "Org A key"));

  await db.delete(memberships).where(eq(memberships.organizationId, orgD.id));
  await db.delete(users).where(eq(users.id, userD.id));
  const [integrationD] = await db.select().from(integrations).where(eq(integrations.organizationId, orgD.id)).limit(1);
  if (integrationD) {
    await db.delete(integrationApiKeys).where(eq(integrationApiKeys.integrationId, integrationD.id));
    await db.delete(integrations).where(eq(integrations.id, integrationD.id));
  }
  await db.delete(organizations).where(eq(organizations.id, orgD.id));
});
