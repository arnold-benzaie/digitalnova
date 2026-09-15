// RADAR DISCOVERY ENGINE — Phase C-2A — real-database integration proof
// for lib/actions/radar-discovery-search.ts.
//
// REAL: RBAC (requireRadarAccess against real staff_members/staff_roles),
// CRM dedup (lib/crm-client-dedup.ts against real crm_clients), Discovery
// persistence (real discovery_results, real UNIQUE(source, source_id)
// constraint), actor rate-limit (real integration_api_rate_limit_hits).
//
// MOCKED (and ONLY this): @/lib/radar-discovery/adapters/configured-google-places
// — this file NEVER calls real Google, by construction (no network
// module is even imported).
//
// Same mocking convention as radar-queue.integration.test.mjs: @/lib/session's
// requireSession() is faked with a mutable session state, so the REAL
// requireRadarAccess() (lib/rbac/require-staff-member.ts, never mocked)
// runs against it.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-discovery-search.integration.test.mjs
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {}, namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

/** @type {{ session: object | null }} */
let mockState = { session: null };
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) throw new Error("UNAUTHENTICATED — no session");
      return mockState.session;
    },
    getCurrentSession: async () => null,
  },
});

/** @type {{ results: any[]; nextCursor: string | null } | { throws: any }} */
let nextProviderOutcome = { results: [], nextCursor: null };
/** @type {Array<any>} */
let providerSearchCalls = [];
mock.module("@/lib/radar-discovery/adapters/configured-google-places", {
  namedExports: {
    createConfiguredGooglePlacesProvider: () => ({
      id: "google_places",
      capabilities: () => ["search"],
      health: () => ({ id: "google_places", state: "connected", capabilities: ["search"], lastCheckedAt: null }),
      search: async (request) => {
        providerSearchCalls.push(request);
        if ("throws" in nextProviderOutcome) throw nextProviderOutcome.throws;
        return nextProviderOutcome;
      },
    }),
  },
});

const { db } = await import("@/db");
const { crmClients, discoveryResults, users, staffMembers, staffRoles, organizations } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { searchRadarDiscovery } = await import("./radar-discovery-search.ts");

const createdDiscoveryResultIds = new Set();
const createdClientIds = new Set();
const createdUserIds = new Set();
const createdStaffMemberIds = new Set();

function uniqueSourceId() {
  return `source-${randomUUID()}`;
}

function fakePlace(overrides = {}) {
  const sourceId = overrides.sourceId ?? uniqueSourceId();
  return {
    source: "google_places",
    sourceId,
    sourceUrl: `https://maps.google.com/?cid=${sourceId}`,
    name: overrides.name ?? `Discovery Test Place ${randomUUID()}`,
    category: "restaurant",
    address: "1 Main St",
    country: "Canada",
    region: "Quebec",
    city: "Montreal",
    postalCode: "H1H 1H1",
    phone: overrides.phone ?? null,
    email: overrides.email ?? null,
    website: null,
    latitude: 45.5,
    longitude: -73.5,
    timezone: "America/Montreal",
    openingHours: null,
    ...overrides,
    sourceId,
  };
}

async function makeUser() {
  const [row] = await db.insert(users).values({ clerkUserId: `c2a_${randomUUID()}`, email: `c2a-${randomUUID()}@example.test`, status: "active" }).returning();
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
  const [client] = await db.insert(crmClients).values({ name: `C2A CRM Fixture ${randomUUID()}`, stage: "lead", ...overrides }).returning();
  createdClientIds.add(client.id);
  return client;
}

after(async () => {
  if (createdDiscoveryResultIds.size) await db.delete(discoveryResults).where(inArray(discoveryResults.id, [...createdDiscoveryResultIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

beforeEach(() => {
  nextProviderOutcome = { results: [], nextCursor: null };
  providerSearchCalls = [];
  mockState = { session: null };
});

const VALID_REQUEST = { category: "restaurants", city: "Montreal", maxResults: 5, fieldSet: "minimal_discovery" };

async function trackResult(result) {
  if (result?.status === "ok") {
    for (const item of result.items) {
      if (item.discoveryResultId) createdDiscoveryResultIds.add(item.discoveryResultId);
    }
  }
  return result;
}

// ---- AUTHORIZATION (real staff_members / staff_roles) ----

test("AUTHORIZATION: OWNER can search", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "OWNER");
  mockState = { session: sessionFor(user, "admin") };
  nextProviderOutcome = { results: [], nextCursor: null };
  const result = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(result.status, "ok");
});

test("AUTHORIZATION: ADMIN can search", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(user, "admin") };
  const result = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(result.status, "ok");
});

test("AUTHORIZATION: MANAGER can search", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "MANAGER");
  mockState = { session: sessionFor(user, "supervisor") };
  const result = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(result.status, "ok");
});

test("AUTHORIZATION: EMPLOYEE with radar_access=true can search", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "EMPLOYEE", true);
  mockState = { session: sessionFor(user, "staff") };
  const result = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(result.status, "ok");
});

test("AUTHORIZATION: EMPLOYEE with radar_access=false is redirected, zero provider calls", async () => {
  const user = await makeUser();
  await makeStaffMember(user.id, "ACTIVE", "EMPLOYEE", false);
  mockState = { session: sessionFor(user, "staff") };
  await assert.rejects(() => searchRadarDiscovery(VALID_REQUEST), /NEXT_REDIRECT/);
  assert.equal(providerSearchCalls.length, 0);
});

test("AUTHORIZATION: CLIENT (no staff_members row at all) is redirected", async () => {
  const user = await makeUser();
  mockState = { session: sessionFor(user, "client") };
  await assert.rejects(() => searchRadarDiscovery(VALID_REQUEST), /NEXT_REDIRECT/);
  assert.equal(providerSearchCalls.length, 0);
});

// ---- DEDUP: real CRM, independent of EMPLOYEE visibility ----

test("DEDUP: a real crm_clients row matching by email is detected as already_in_crm — real discovery_results row is NEVER created", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const email = `dedup-${randomUUID()}@example.test`;
  await makeClient({ email });

  nextProviderOutcome = { results: [fakePlace({ email })], nextCursor: null };
  const result = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(result.items[0].status, "already_in_crm");
  assert.equal(result.alreadyInCrmCount, 1);

  const rows = await db.select({ id: discoveryResults.id }).from(discoveryResults).where(eq(discoveryResults.email, email));
  assert.equal(rows.length, 0, "no discovery_results row was created for a confirmed CRM duplicate");
});

test("DEDUP (CRITICAL): a crm_clients row ASSIGNED TO A DIFFERENT EMPLOYEE (invisible to the caller in the UI) is STILL detected as a duplicate — dedup is independent of requireCrmClientAccess() visibility", async () => {
  const employeeCaller = await makeUser();
  await makeStaffMember(employeeCaller.id, "ACTIVE", "EMPLOYEE", true);
  mockState = { session: sessionFor(employeeCaller, "staff") };

  const otherEmployee = await makeUser();
  const otherStaffMember = await makeStaffMember(otherEmployee.id, "ACTIVE", "EMPLOYEE", true);

  const email = `hidden-${randomUUID()}@example.test`;
  // Assigned to the OTHER employee — per lib/crm-client-access.ts, this
  // row would be INVISIBLE to `employeeCaller` in the ordinary CRM UI.
  await makeClient({ email, assignedUserId: otherStaffMember ? otherEmployee.id : null });

  nextProviderOutcome = { results: [fakePlace({ email })], nextCursor: null };
  const result = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(result.items[0].status, "already_in_crm", "must detect the duplicate even though this specific EMPLOYEE cannot see that client in the CRM UI");

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(otherEmployee.id), "the OTHER employee's identity must never leak");
});

test("DEDUP: no matching crm_clients row -> a real discovery_results row is created, status='discovered', crmClientId=null", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const sourceId = uniqueSourceId();
  nextProviderOutcome = { results: [fakePlace({ sourceId, name: "Genuinely New Co" })], nextCursor: null };
  const result = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(result.items[0].status, "created");

  const [row] = await db.select().from(discoveryResults).where(eq(discoveryResults.sourceId, sourceId)).limit(1);
  assert.ok(row);
  assert.equal(row.status, "discovered");
  assert.equal(row.crmClientId, null);
});

// ---- DEDUP: discovery-level (same source/sourceId) ----

test("DISCOVERY DEDUP: searching the SAME sourceId twice never creates a second discovery_results row — second call reports already_discovered", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const sourceId = uniqueSourceId();
  nextProviderOutcome = { results: [fakePlace({ sourceId })], nextCursor: null };
  const first = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(first.items[0].status, "created");

  const second = await trackResult(await searchRadarDiscovery(VALID_REQUEST));
  assert.equal(second.items[0].status, "already_discovered");

  const rows = await db.select({ id: discoveryResults.id }).from(discoveryResults).where(eq(discoveryResults.sourceId, sourceId));
  assert.equal(rows.length, 1);
});

test("CONCURRENCY: two simultaneous searches returning the SAME Google place never create two discovery_results rows", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  const sourceId = uniqueSourceId();
  nextProviderOutcome = { results: [fakePlace({ sourceId })], nextCursor: null };

  const [r1, r2] = await Promise.all([searchRadarDiscovery(VALID_REQUEST), searchRadarDiscovery(VALID_REQUEST)]);
  await trackResult(r1);
  await trackResult(r2);

  const statuses = [r1.items[0].status, r2.items[0].status].sort();
  assert.deepEqual(statuses, ["already_discovered", "created"]);

  const rows = await db.select({ id: discoveryResults.id }).from(discoveryResults).where(eq(discoveryResults.sourceId, sourceId));
  assert.equal(rows.length, 1, "exactly one row, regardless of the concurrent race");
});

// ---- RATE LIMIT (real DB) ----

test("RATE LIMIT: a real actor eventually gets rate-limited after enough rapid real requests, using the real DB-backed counter", async () => {
  const owner = await makeUser();
  await makeStaffMember(owner.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(owner, "admin") };

  // Directly pre-seed the real rate-limit table at the actor scope so
  // this test is fast and deterministic rather than looping 5+ real
  // searches (the wrapper's own wiring is already proven in
  // actor-rate-limit.test.mjs) -- this proves the ACTION composes with
  // the REAL table correctly, not the primitive's own atomicity again.
  const { checkDiscoveryActorRateLimit, DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS } = await import("../radar-discovery/actor-rate-limit.ts");
  for (let i = 0; i < DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS; i++) {
    const decision = await checkDiscoveryActorRateLimit(owner.id);
    assert.equal(decision.allowed, true);
  }

  nextProviderOutcome = { results: [], nextCursor: null };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.status, "actor_rate_limited");
  assert.equal(providerSearchCalls.length, 0, "the provider must never be called once the real actor limit is reached");
});

test("RATE LIMIT: a DIFFERENT actor is unaffected by another actor's real rate-limit window", async () => {
  const ownerA = await makeUser();
  await makeStaffMember(ownerA.id, "ACTIVE", "ADMIN");
  const { checkDiscoveryActorRateLimit, DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS } = await import("../radar-discovery/actor-rate-limit.ts");
  for (let i = 0; i < DISCOVERY_ACTOR_RATE_LIMIT_MAX_REQUESTS; i++) {
    await checkDiscoveryActorRateLimit(ownerA.id);
  }

  const ownerB = await makeUser();
  await makeStaffMember(ownerB.id, "ACTIVE", "ADMIN");
  mockState = { session: sessionFor(ownerB, "admin") };
  nextProviderOutcome = { results: [], nextCursor: null };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.status, "ok", "a different actor must never be throttled by another actor's own window");
});
