// MISSION C-2C-2-C — real-database integration proof for
// lib/actions/radar-discovery-convert.ts.
//
// REAL: RBAC (requireRadarAccess against real staff_members/staff_roles),
// CRM dedup (lib/crm-client-dedup.ts against real crm_clients), the
// transactional SELECT ... FOR UPDATE / INSERT / UPDATE / audit write
// against real discovery_results / crm_clients / audit_log.
//
// MOCKED (and ONLY this): @/lib/session's requireSession() is faked with a
// mutable session state, so the REAL requireRadarAccess() (lib/rbac/
// require-staff-member.ts, never mocked) runs against it — same
// convention as radar-discovery-search.integration.test.mjs.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-discovery-convert.integration.test.mjs
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {}, namedExports: {} });

/** @type {{ session: object | null }} */
let mockState = { session: null };
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) throw new Error("UNAUTHENTICATED — no session");
      return mockState.session;
    },
    getCurrentSession: async () => (mockState.session ?? null),
  },
});

const { db } = await import("@/db");
const { crmClients, discoveryResults, users, staffMembers, staffRoles, organizations, auditLog } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");

// PASSTHROUGH mock of @/lib/audit — by default behaves EXACTLY like the
// real logAudit() (same real INSERT against the real audit_log table, via
// the executor it is given), so every test below except the dedicated
// ATOMICITY one exercises the genuine write path. Only when
// `auditShouldThrow` is set does it reject instead — the ONE targeted way
// to prove that a failure inside the SAME transaction as the crm_clients
// insert / discovery_results update rolls both of those back too (this
// codebase has no existing precedent that forces a mid-transaction
// failure against a real Postgres transaction any other way — see
// radar-assignment.integration.test.mjs, which has no such test either).
let auditShouldThrow = false;
mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async (input, executor = db) => {
      if (auditShouldThrow) throw new Error("ATOMICITY TEST — simulated audit failure, must roll back the whole transaction");
      await executor.insert(auditLog).values({
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
      });
    },
  },
});

const { convertDiscoveryResult } = await import("./radar-discovery-convert.ts");

const createdDiscoveryResultIds = new Set();
const createdClientIds = new Set();
const createdUserIds = new Set();
const createdStaffMemberIds = new Set();

function uniqueSourceId() {
  return `source-${randomUUID()}`;
}

function fakeDiscoveryRowInput(overrides = {}) {
  const sourceId = overrides.sourceId ?? uniqueSourceId();
  return {
    source: "google_places",
    sourceId,
    sourceUrl: `https://maps.google.com/?cid=${sourceId}`,
    name: overrides.name ?? `Discovery Convert Fixture ${randomUUID()}`,
    category: "restaurant",
    address: "1 Main St",
    country: "Canada",
    region: "Quebec",
    city: "Montreal",
    postalCode: "H1H 1H1",
    phone: overrides.phone ?? null,
    email: overrides.email ?? null,
    website: "https://example.test",
    latitude: 45.5,
    longitude: -73.5,
    timezone: "America/Montreal",
    openingHours: null,
    ...overrides,
    sourceId,
  };
}

async function makeDiscoveryResult(overrides = {}) {
  const { status, crmClientId, ...rest } = fakeDiscoveryRowInput(overrides);
  const [row] = await db
    .insert(discoveryResults)
    .values({ ...rest, ...(status ? { status } : {}), ...(crmClientId ? { crmClientId } : {}) })
    .returning();
  createdDiscoveryResultIds.add(row.id);
  return row;
}

async function makeUser() {
  const [row] = await db.insert(users).values({ clerkUserId: `c2c2c_${randomUUID()}`, email: `c2c2c-${randomUUID()}@example.test`, status: "active" }).returning();
  createdUserIds.add(row.id);
  return row;
}

let INTERNAL_ORG_ID;
const STAFF_ROLE_ID_CACHE = new Map();
async function internalOrgId() {
  if (INTERNAL_ORG_ID === undefined) {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
    INTERNAL_ORG_ID = org?.id ?? null;
  }
  return INTERNAL_ORG_ID;
}
async function staffRoleId(name) {
  if (!STAFF_ROLE_ID_CACHE.has(name)) {
    const [r] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
    STAFF_ROLE_ID_CACHE.set(name, r?.id ?? null);
  }
  return STAFF_ROLE_ID_CACHE.get(name);
}
async function makeStaffMember(userId, status, roleName, radarAccess = true) {
  const orgId = await internalOrgId();
  const roleId = await staffRoleId(roleName);
  if (!orgId || !roleId) return null;
  const [row] = await db.insert(staffMembers).values({ userId, workspaceOrgId: orgId, roleId, status, radarAccess }).returning();
  createdStaffMemberIds.add(row.id);
  return row;
}

function sessionFor(user, axisARoleLabel) {
  return {
    userId: user.id,
    clerkUserId: user.clerkUserId,
    email: user.email,
    fullName: null,
    firstName: "Test",
    organizationId: "test-org",
    organizationName: "Test Org",
    role: axisARoleLabel,
    previousLastLoginAt: null,
  };
}

async function makeClient(overrides = {}) {
  const [client] = await db.insert(crmClients).values({ name: `C2C2C CRM Fixture ${randomUUID()}`, stage: "lead", ...overrides }).returning();
  createdClientIds.add(client.id);
  return client;
}

async function trackResult(result) {
  if (result?.status === "converted" || result?.status === "already_converted") {
    createdClientIds.add(result.crmClientId);
  }
  return result;
}

after(async () => {
  if (createdDiscoveryResultIds.size) await db.delete(discoveryResults).where(inArray(discoveryResults.id, [...createdDiscoveryResultIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

beforeEach(() => {
  mockState = { session: null };
  auditShouldThrow = false;
});

// ---- AUTHORIZATION (real staff_members / staff_roles) ----
// Only ONE test uses "OWNER" (staff_members_one_owner_per_workspace is a
// real unique index on the internal workspace — every other fixture uses
// ADMIN/MANAGER/EMPLOYEE, same convention already established by
// radar-discovery-search.integration.test.mjs).

test("AUTHORIZATION: OWNER can convert", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "OWNER");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  const result = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(result.status, "converted");
});

test("AUTHORIZATION: ADMIN can convert", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  const result = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(result.status, "converted");
});

test("AUTHORIZATION: MANAGER can convert", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "MANAGER");
  mockState = { session: sessionFor(user, "supervisor") };
  const discovery = await makeDiscoveryResult();
  const result = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(result.status, "converted");
});

test("AUTHORIZATION: EMPLOYEE with radar_access=true can convert", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "EMPLOYEE", true);
  mockState = { session: sessionFor(user, "staff") };
  const discovery = await makeDiscoveryResult();
  const result = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(result.status, "converted");
});

test("AUTHORIZATION: EMPLOYEE with radar_access=false is redirected, zero writes", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "EMPLOYEE", false);
  mockState = { session: sessionFor(user, "staff") };
  const discovery = await makeDiscoveryResult();
  await assert.rejects(() => convertDiscoveryResult(discovery.id), /NEXT_REDIRECT/);
  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id)).limit(1);
  assert.equal(row.status, "discovered");
  assert.equal(row.crmClientId, null);
});

test("AUTHORIZATION: CLIENT (no staff_members row at all) is redirected, zero writes", async () => {
  const user = await makeUser();
  mockState = { session: sessionFor(user, "client") };
  const discovery = await makeDiscoveryResult();
  await assert.rejects(() => convertDiscoveryResult(discovery.id), /NEXT_REDIRECT/);
  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id)).limit(1);
  assert.equal(row.status, "discovered");
});

// ---- NO_MATCH: real creation ----

test("NO_MATCH: creates a real crm_clients row, stage='lead', source='RADAR Discovery', fields copied correctly, discovery status='converted', crmClientId correct", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const discovery = await makeDiscoveryResult({
    name: "Genuinely New Co",
    address: "42 Rue Test",
    country: "France",
    region: "Île-de-France",
    city: "Paris",
    phone: null,
    email: null,
    postalCode: "75001",
  });
  const result = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(result.status, "converted");
  assert.ok(result.crmClientId);

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, result.crmClientId)).limit(1);
  assert.ok(client);
  assert.equal(client.name, "Genuinely New Co");
  assert.equal(client.address, "42 Rue Test");
  assert.equal(client.country, "France");
  assert.equal(client.region, "Île-de-France");
  assert.equal(client.city, "Paris");
  assert.equal(client.postalCode, "75001");
  assert.equal(client.stage, "lead");
  assert.equal(client.source, "RADAR Discovery");
  assert.equal(client.organizationId, null);
  // Never mapped, per the C-2C-2-B contract:
  assert.equal(client.industry, null);

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id)).limit(1);
  assert.equal(row.status, "converted");
  assert.equal(row.crmClientId, result.crmClientId);
});

// ---- EXACT_MATCH ----

test("EXACT_MATCH: a real crm_clients row matching by email -> already_in_crm, ZERO creation, discovery_results left UNCHANGED", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const email = `exact-${randomUUID()}@example.test`;
  await makeClient({ email });
  const discovery = await makeDiscoveryResult({ email });

  const clientCountBefore = (await db.select({ id: crmClients.id }).from(crmClients)).length;
  const result = await convertDiscoveryResult(discovery.id);
  assert.deepEqual(result, { status: "already_in_crm" });
  const clientCountAfter = (await db.select({ id: crmClients.id }).from(crmClients)).length;
  assert.equal(clientCountAfter, clientCountBefore, "no new crm_clients row was created");

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id)).limit(1);
  assert.equal(row.status, "discovered");
  assert.equal(row.crmClientId, null);
});

test("EXACT_MATCH response never leaks the existing client's id/name/email", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const email = `leak-${randomUUID()}@example.test`;
  const existing = await makeClient({ email, name: "SECRET Existing Business Name" });
  const discovery = await makeDiscoveryResult({ email });

  const result = await convertDiscoveryResult(discovery.id);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(existing.id));
  assert.ok(!serialized.includes("SECRET Existing Business Name"));
  assert.ok(!serialized.includes(email));
});

// ---- AMBIGUOUS_MATCH ----

test("AMBIGUOUS_MATCH: name+city+region match (no email/phone) -> ambiguous_match, ZERO writes", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  // queryByNameLocation() requires country to match TOO whenever the
  // input carries one (fakeDiscoveryRowInput defaults country to
  // "Canada") -- the existing client fixture must set the same country,
  // or the match silently misses (NO_MATCH instead of AMBIGUOUS_MATCH).
  const sharedName = `Ambiguous Biz ${randomUUID()}`;
  await makeClient({ name: sharedName, city: "Montreal", region: "Quebec", country: "Canada" });
  const discovery = await makeDiscoveryResult({ name: sharedName, city: "Montreal", region: "Quebec", country: "Canada", email: null, phone: null });

  const clientCountBefore = (await db.select({ id: crmClients.id }).from(crmClients)).length;
  const result = await convertDiscoveryResult(discovery.id);
  assert.deepEqual(result, { status: "ambiguous_match" });
  const clientCountAfter = (await db.select({ id: crmClients.id }).from(crmClients)).length;
  assert.equal(clientCountAfter, clientCountBefore);

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id)).limit(1);
  assert.equal(row.status, "discovered");
  assert.equal(row.crmClientId, null);
});

// ---- IDEMPOTENCE ----

test("IDEMPOTENCE: converting the SAME discovery result twice -> second call is already_converted, only ONE crm_clients row exists", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const discovery = await makeDiscoveryResult();
  const first = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(first.status, "converted");

  const second = await convertDiscoveryResult(discovery.id);
  assert.deepEqual(second, { status: "already_converted", crmClientId: first.crmClientId });

  const clients = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.id, first.crmClientId));
  assert.equal(clients.length, 1);
});

// ---- CONCURRENCY ----

test("CONCURRENCY: two simultaneous conversions of the SAME discovery result create exactly ONE crm_clients row", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const discovery = await makeDiscoveryResult();
  const [a, b] = await Promise.all([convertDiscoveryResult(discovery.id), convertDiscoveryResult(discovery.id)]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ["already_converted", "converted"]);
  const winningId = a.status === "converted" ? a.crmClientId : b.crmClientId;
  const otherId = a.status === "already_converted" ? a.crmClientId : b.crmClientId;
  assert.equal(winningId, otherId, "the idempotent response must point at the SAME client the winner created");
  createdClientIds.add(winningId);

  const clients = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.id, winningId));
  assert.equal(clients.length, 1);
});

// ---- ASSIGNMENT ----

test("EMPLOYEE: auto-assignment to the converting EMPLOYEE's own userId — client immediately visible per existing visibility rules", async () => {
  const employee = await makeUser();
  await makeStaffMember(employee.id, "ACTIVE", "EMPLOYEE", true);
  mockState = { session: sessionFor(employee, "staff") };

  const discovery = await makeDiscoveryResult();
  const result = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(result.status, "converted");

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, result.crmClientId)).limit(1);
  assert.equal(client.assignedUserId, employee.id);
});

test("OWNER/ADMIN/MANAGER: no auto-assignment — assignedUserId is null", async () => {
  for (const role of ["ADMIN", "MANAGER"]) {
    const user = await makeUser();
    await makeStaffMember(user.id, "ACTIVE", role);
    mockState = { session: sessionFor(user, role === "ADMIN" ? "admin" : "supervisor") };

    const discovery = await makeDiscoveryResult();
    const result = await trackResult(await convertDiscoveryResult(discovery.id));
    assert.equal(result.status, "converted");

    const [client] = await db.select().from(crmClients).where(eq(crmClients.id, result.crmClientId)).limit(1);
    assert.equal(client.assignedUserId, null, `expected null assignment for role ${role}`);
  }
});

// ---- EMPLOYEE ISOLATION (CRITICAL) ----

test("ISOLATION: a crm_clients row ASSIGNED TO A DIFFERENT EMPLOYEE (invisible to the caller) is STILL detected as EXACT_MATCH -> opaque refusal, no requireCrmClientAccess() bypass", async () => {
  const caller = await makeUser();
  await makeStaffMember(caller.id, "ACTIVE", "EMPLOYEE", true);
  mockState = { session: sessionFor(caller, "staff") };

  const otherEmployee = await makeUser();
  const otherStaffMember = await makeStaffMember(otherEmployee.id, "ACTIVE", "EMPLOYEE", true);

  const email = `isolated-${randomUUID()}@example.test`;
  const hiddenClient = await makeClient({ email, name: "HIDDEN Business", assignedUserId: otherStaffMember ? otherEmployee.id : null });
  const discovery = await makeDiscoveryResult({ email });

  const clientCountBefore = (await db.select({ id: crmClients.id }).from(crmClients)).length;
  const result = await convertDiscoveryResult(discovery.id);
  assert.deepEqual(result, { status: "already_in_crm" }, "must detect the duplicate even though this EMPLOYEE cannot see that client in the CRM UI");
  const clientCountAfter = (await db.select({ id: crmClients.id }).from(crmClients)).length;
  assert.equal(clientCountAfter, clientCountBefore, "no duplicate crm_clients row was created");

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(hiddenClient.id));
  assert.ok(!serialized.includes("HIDDEN Business"));
  assert.ok(!serialized.includes(otherEmployee.id), "the OTHER employee's identity must never leak");
});

// ---- AUDIT ----

test("AUDIT: exactly one audit_log row on a successful conversion, correct actorUserId/targetId/action", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const discovery = await makeDiscoveryResult();
  const result = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(result.status, "converted");

  const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, result.crmClientId));
  const conversionEntries = rows.filter((r) => r.action === "radar.discovery_result_converted");
  assert.equal(conversionEntries.length, 1);
  assert.equal(conversionEntries[0].actorUserId, owner.id);
  assert.equal(conversionEntries[0].targetType, "crm_client");
  assert.equal(conversionEntries[0].metadata?.discoveryResultId, discovery.id);
  assert.equal(conversionEntries[0].metadata?.source, discovery.source);
  assert.equal(conversionEntries[0].metadata?.sourceId, discovery.sourceId);
});

test("AUDIT: no audit_log row is written for already_in_crm / ambiguous_match", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const email = `noaudit-${randomUUID()}@example.test`;
  await makeClient({ email });
  const discovery = await makeDiscoveryResult({ email });
  const before = (await db.select({ id: auditLog.id }).from(auditLog)).length;
  await convertDiscoveryResult(discovery.id);
  const after_ = (await db.select({ id: auditLog.id }).from(auditLog)).length;
  assert.equal(after_, before);
});

// ---- ATOMICITY ----

test("ATOMICITY: a failure in the audit write rolls back the crm_clients insert AND the discovery_results update — all three or none", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const discovery = await makeDiscoveryResult();
  const clientCountBefore = (await db.select({ id: crmClients.id }).from(crmClients)).length;

  auditShouldThrow = true;
  await assert.rejects(() => convertDiscoveryResult(discovery.id), /ATOMICITY TEST/);
  auditShouldThrow = false;

  const clientCountAfter = (await db.select({ id: crmClients.id }).from(crmClients)).length;
  assert.equal(clientCountAfter, clientCountBefore, "the crm_clients insert must be rolled back with the rest of the transaction");

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id)).limit(1);
  assert.equal(row.status, "discovered", "the discovery_results update must be rolled back too");
  assert.equal(row.crmClientId, null);

  // A SUBSEQUENT, real conversion of the same row must still succeed
  // normally afterward — the aborted attempt leaves no partial state.
  const retry = await trackResult(await convertDiscoveryResult(discovery.id));
  assert.equal(retry.status, "converted");
});
