// MISSION C-2D-4-E — real-database integration proof for
// lib/actions/radar-discovery-enrich.ts.
//
// REAL: RBAC (requireRadarAccess against real staff_members/staff_roles,
// including the RADAR_DISCOVERY_ENRICH permission and the individual
// staff_members.radar_access override), the atomic claim UPDATE, the
// transactional finalize (SELECT ... FOR UPDATE / UPDATE / audit write)
// against real discovery_results / audit_log, the real
// discovery_results_business_status_check CHECK constraint.
//
// MOCKED (and ONLY this): @/lib/session's requireSession() (mutable
// session state, same convention as every other *.integration.test.mjs in
// this repo) and @/lib/radar-discovery/adapters/configured-google-places
// (createConfiguredGooglePlacesProvider) — this file NEVER calls real
// Google, by construction (no network module is even imported).
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-discovery-enrich.integration.test.mjs
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

/** @type {{ getDetails: (sourceId: string, fieldSet: string) => Promise<any> } | null} */
let providerInstance = null;
mock.module("@/lib/radar-discovery/adapters/configured-google-places", {
  namedExports: {
    createConfiguredGooglePlacesProvider: () => providerInstance,
  },
});

const { db } = await import("@/db");
const { discoveryResults, users, staffMembers, staffRoles, organizations, auditLog } = await import("@/db/schema");
const { eq, inArray, sql } = await import("drizzle-orm");

const { enrichDiscoveryResult } = await import("./radar-discovery-enrich.ts");

const createdDiscoveryResultIds = new Set();
const createdUserIds = new Set();
const createdStaffMemberIds = new Set();

function uniqueSourceId() {
  return `source-${randomUUID()}`;
}

async function makeDiscoveryResult(overrides = {}) {
  const sourceId = overrides.sourceId ?? uniqueSourceId();
  const { status, ...rest } = overrides;
  const [row] = await db
    .insert(discoveryResults)
    .values({
      source: "google_places",
      sourceId,
      name: `Enrichment Fixture ${randomUUID()}`,
      ...rest,
      sourceId,
    })
    .returning();
  if (status) {
    await db.update(discoveryResults).set({ status }).where(eq(discoveryResults.id, row.id));
    row.status = status;
  }
  createdDiscoveryResultIds.add(row.id);
  return row;
}

async function makeUser() {
  const [row] = await db.insert(users).values({ clerkUserId: `c2d4e_${randomUUID()}`, email: `c2d4e-${randomUUID()}@example.test`, status: "active" }).returning();
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

function okProvider(patch = {}, delayMs = 0) {
  return {
    id: "google_places",
    capabilities: () => ["search", "get_details"],
    health: () => ({ id: "google_places", state: "connected", capabilities: ["search", "get_details"], lastCheckedAt: null }),
    search: async () => ({ results: [], nextCursor: null }),
    async getDetails() {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { result: { phone: null, website: null, openingHours: null, businessStatus: null, ...patch } };
    },
  };
}

after(async () => {
  if (createdDiscoveryResultIds.size) await db.delete(discoveryResults).where(inArray(discoveryResults.id, [...createdDiscoveryResultIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

beforeEach(() => {
  mockState = { session: null };
  providerInstance = okProvider();
});

// ---- AUTHORIZATION (real staff_members / staff_roles / RADAR_DISCOVERY_ENRICH) ----

test("AUTHORIZATION: OWNER can enrich", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "OWNER");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  const result = await enrichDiscoveryResult(discovery.id);
  assert.equal(result.status, "enriched");
});

test("AUTHORIZATION: ADMIN can enrich", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  const result = await enrichDiscoveryResult(discovery.id);
  assert.equal(result.status, "enriched");
});

test("AUTHORIZATION: MANAGER can enrich", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "MANAGER");
  mockState = { session: sessionFor(user, "supervisor") };
  const discovery = await makeDiscoveryResult();
  const result = await enrichDiscoveryResult(discovery.id);
  assert.equal(result.status, "enriched");
});

test("AUTHORIZATION: EMPLOYEE with radar_access=true can enrich", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "EMPLOYEE", true);
  mockState = { session: sessionFor(user, "staff") };
  const discovery = await makeDiscoveryResult();
  const result = await enrichDiscoveryResult(discovery.id);
  assert.equal(result.status, "enriched");
});

test("AUTHORIZATION: EMPLOYEE with radar_access=false is redirected -- the individual override blocks RADAR_DISCOVERY_ENRICH exactly like every other RADAR permission, zero writes", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "EMPLOYEE", false);
  mockState = { session: sessionFor(user, "staff") };
  const discovery = await makeDiscoveryResult();
  await assert.rejects(() => enrichDiscoveryResult(discovery.id), /NEXT_REDIRECT/);
  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id));
  assert.equal(row.status, "discovered", "no write must have occurred");
});

test("AUTHORIZATION: CLIENT (no staff_members row at all) is redirected", async () => {
  const user = await makeUser();
  mockState = { session: sessionFor(user, "client") };
  const discovery = await makeDiscoveryResult();
  await assert.rejects(() => enrichDiscoveryResult(discovery.id), /NEXT_REDIRECT/);
});

// ---- REAL ENRICHMENT ROUND TRIP ----

test("a discovered row is enriched: status becomes 'enriched', fields merged, updatedAt advances, lease released (enrichmentClaimedAt back to null)", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  providerInstance = okProvider({ phone: "+33 1 42 00 00 01", website: "https://example.test", businessStatus: "OPERATIONAL" });

  const result = await enrichDiscoveryResult(discovery.id);
  assert.equal(result.status, "enriched");
  assert.equal(result.phone, "+33 1 42 00 00 01");

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id));
  assert.equal(row.status, "enriched");
  assert.equal(row.phone, "+33 1 42 00 00 01");
  assert.equal(row.website, "https://example.test");
  assert.equal(row.businessStatus, "OPERATIONAL");
  assert.equal(row.enrichmentClaimedAt, null, "the lease must be released after a successful finalize");
  assert.ok(row.updatedAt.getTime() > discovery.updatedAt.getTime(), "updatedAt must advance on a real enrichment");
});

test("already_enriched: a second call on the same row does not call the provider again, returns the already-persisted data", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  providerInstance = okProvider({ phone: "+1" });
  await enrichDiscoveryResult(discovery.id);

  let secondCallMade = false;
  providerInstance = { ...okProvider(), getDetails: async () => { secondCallMade = true; return { result: { phone: null, website: null, openingHours: null, businessStatus: null } }; } };
  const result = await enrichDiscoveryResult(discovery.id);
  assert.equal(result.status, "already_enriched");
  assert.equal(result.phone, "+1", "must surface the ORIGINAL persisted value, not a fresh call");
  assert.equal(secondCallMade, false);
});

test("forceRefresh:true on an already-enriched row genuinely calls the provider again and overwrites the data", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  providerInstance = okProvider({ phone: "+1-old" });
  await enrichDiscoveryResult(discovery.id);

  providerInstance = okProvider({ phone: "+1-refreshed" });
  const result = await enrichDiscoveryResult(discovery.id, { forceRefresh: true });
  assert.equal(result.status, "enriched");
  assert.equal(result.phone, "+1-refreshed");
});

test("ignored: a row explicitly marked 'ignored' refuses enrichment, zero provider calls, zero writes", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult({ status: "ignored" });

  let providerCalled = false;
  providerInstance = { ...okProvider(), getDetails: async () => { providerCalled = true; return { result: { phone: null, website: null, openingHours: null, businessStatus: null } }; } };
  const result = await enrichDiscoveryResult(discovery.id);
  assert.deepEqual(result, { status: "ignored" });
  assert.equal(providerCalled, false);

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id));
  assert.equal(row.status, "ignored", "must remain untouched");
});

test("not_found: a syntactically valid but nonexistent uuid returns not_found, zero writes", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const result = await enrichDiscoveryResult("00000000-0000-4000-8000-000000000000");
  assert.deepEqual(result, { status: "not_found" });
});

// ---- CONVERTED ROW: enrichment continues, never propagates to CRM, status preserved ----

test("a CONVERTED row can still be enriched -- fields merge, but status stays 'converted' (never downgraded to 'enriched'), satisfying the real discovery_results_converted_link_check constraint", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };

  // A real crm_clients row is not created here -- this test only proves
  // the discovery_results side; crmClientId is left null so the CHECK
  // constraint (crmClientId IS NULL OR status='converted') has nothing to
  // violate, while `status` itself starts genuinely 'converted'.
  const discovery = await makeDiscoveryResult({ status: "converted" });
  providerInstance = okProvider({ businessStatus: "CLOSED_TEMPORARILY" });

  const result = await enrichDiscoveryResult(discovery.id);
  assert.equal(result.status, "enriched", "the ACTION's own outcome vocabulary always reports 'enriched' on success");
  assert.equal(result.businessStatus, "CLOSED_TEMPORARILY");

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id));
  assert.equal(row.status, "converted", "the persisted DB status column must never be downgraded away from converted");
  assert.equal(row.businessStatus, "CLOSED_TEMPORARILY", "enrichment fields are still merged onto a converted row");
});

// ---- CONCURRENCY ----

test("CONCURRENCY: two simultaneous enrichment requests for the SAME row -- exactly one wins the claim and calls the provider, the other observes enrichment_in_progress", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();

  let providerCallCount = 0;
  providerInstance = {
    ...okProvider(),
    async getDetails() {
      providerCallCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { result: { phone: "+1-winner", website: null, openingHours: null, businessStatus: null } };
    },
  };

  const [a, b] = await Promise.all([enrichDiscoveryResult(discovery.id), enrichDiscoveryResult(discovery.id)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ["enriched", "enrichment_in_progress"].sort());
  assert.equal(providerCallCount, 1, "the provider must be called EXACTLY once, never twice for the same concurrent pair");

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id));
  assert.equal(row.status, "enriched");
  assert.equal(row.phone, "+1-winner");
  assert.equal(row.enrichmentClaimedAt, null, "the lease must be fully released after the winner's finalize");
});

test("DB LOCK SAFETY: while one enrichment's provider call is artificially delayed, an UNRELATED row's own claim proceeds immediately -- no connection/lock is held across the network call", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const slowRow = await makeDiscoveryResult();
  const otherRow = await makeDiscoveryResult();

  providerInstance = okProvider({}, 300);

  const start = Date.now();
  const slowPromise = enrichDiscoveryResult(slowRow.id);
  // Give the slow request a moment to pass its claim step and enter the
  // (mocked) network call before starting the unrelated one.
  await new Promise((resolve) => setTimeout(resolve, 20));

  // A cheap, real, direct DB claim on a COMPLETELY DIFFERENT row -- if the
  // slow request's own claim/finalize held a transaction/connection open
  // for the duration of its "network call", this would be measurably
  // delayed too. It must complete almost immediately instead.
  const { claimDiscoveryResultForEnrichment, releaseDiscoveryResultEnrichmentClaim } = await import("../radar-discovery/discovery-result-store.ts");
  const otherClaimStart = Date.now();
  const otherClaim = await claimDiscoveryResultForEnrichment(otherRow.id, { forceRefresh: false });
  const otherClaimDuration = Date.now() - otherClaimStart;
  assert.equal(otherClaim.status, "claimed");
  assert.ok(otherClaimDuration < 150, `an unrelated row's claim must not be blocked by the slow request's in-flight network call (took ${otherClaimDuration}ms)`);
  await releaseDiscoveryResultEnrichmentClaim(otherRow.id, otherClaim.row.enrichmentClaimedAt);

  await slowPromise;
  assert.ok(Date.now() - start >= 300, "sanity check: the slow request itself really did take the full delay");
});

// ---- BUSINESS STATUS — real CHECK constraint ----

test("discovery_results_business_status_check: the real Postgres CHECK constraint rejects a value outside the closed set", async () => {
  const discovery = await makeDiscoveryResult();
  await assert.rejects(
    () => db.execute(sql`UPDATE discovery_results SET business_status = 'NOT_A_REAL_STATUS' WHERE id = ${discovery.id}`),
    (err) => {
      // drizzle wraps the real pg error in `.cause` -- the top-level
      // message is just "Failed query: ...", so the actual SQLSTATE/
      // constraint-violation text must be read from the cause.
      assert.equal(err.cause?.code, "23514", "expected a Postgres check_violation (23514)");
      assert.match(err.cause?.message ?? "", /discovery_results_business_status_check/);
      return true;
    },
  );
});

test("discovery_results_business_status_check: NULL and each of the three real Google values are all accepted", async () => {
  const discovery = await makeDiscoveryResult();
  for (const value of [null, "OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]) {
    await db.update(discoveryResults).set({ businessStatus: value }).where(eq(discoveryResults.id, discovery.id));
    const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, discovery.id));
    assert.equal(row.businessStatus, value);
  }
});

// ---- AUDIT ----

test("AUDIT: exactly one audit_log row on a successful enrichment, correct actorUserId/targetId/action, never a raw provider payload in metadata", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const discovery = await makeDiscoveryResult();
  providerInstance = okProvider({ phone: "+33 SECRET LOOKING NUMBER" });

  await enrichDiscoveryResult(discovery.id);

  const entries = await db.select().from(auditLog).where(eq(auditLog.action, "radar.discovery_result_enriched"));
  const own = entries.filter((e) => e.targetId === discovery.id);
  assert.equal(own.length, 1);
  assert.equal(own[0].actorUserId, user.id);
  assert.equal(own[0].targetType, "discovery_result");
  assert.deepEqual(Object.keys(own[0].metadata).sort(), ["source", "sourceId"].sort());
  assert.ok(!JSON.stringify(own[0].metadata).includes("SECRET LOOKING NUMBER"), "the audit metadata must never carry a raw provider field value");
});
