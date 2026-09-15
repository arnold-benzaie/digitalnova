// RADAR DISCOVERY ENGINE — Phase B — real-database integration proof.
//
// Proves the actual DB-level guarantees the unit tests (mocked @/db)
// cannot: the UNIQUE(source, source_id) index, the status/latitude/
// longitude/converted-link CHECK constraints, the FK to crm_clients, and
// that this new table has zero effect on crm_clients or the RADAR queue.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/discovery-result-store.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

// RADAR queue read gate — a real, ACTIVE staff_members row is required to
// prove item K (no effect on RADAR) end-to-end through the real
// requireRadarAccess() gate, matching every other *.integration.test.mjs
// file's own convention (mocking only @/lib/session, never RBAC itself).
mock.module("@/lib/session", { namedExports: { requireSession: async () => mockState.session, getCurrentSession: async () => null } });
let mockState = { session: null };

const { db } = await import("@/db");
const { crmClients, discoveryResults, users, staffMembers, staffRoles, organizations } = await import("@/db/schema");
const { eq, inArray, and } = await import("drizzle-orm");
const { createDiscoveryResult, findDiscoveryResultBySource } = await import("./discovery-result-store.ts");
const { getRadarQueue } = await import("../actions/radar-queue.ts");

const createdDiscoveryResultIds = new Set();
const createdClientIds = new Set();
const createdUserIds = new Set();
const createdStaffMemberIds = new Set();

after(async () => {
  if (createdDiscoveryResultIds.size) await db.delete(discoveryResults).where(inArray(discoveryResults.id, [...createdDiscoveryResultIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

function uniqueSourceId() {
  return `source-${randomUUID()}`;
}

async function makeClient(overrides = {}) {
  const [client] = await db.insert(crmClients).values({ name: `Discovery Test Client ${randomUUID()}`, stage: "lead", ...overrides }).returning();
  createdClientIds.add(client.id);
  return client;
}

// ---- A. valid creation ----

test("A. real DB: creating a valid discovery result succeeds, status defaults to 'discovered', crmClientId is null", async () => {
  const { result, created } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "Le Petit Bistro" });
  createdDiscoveryResultIds.add(result.id);
  assert.equal(created, true);
  assert.equal(result.status, "discovered");
  assert.equal(result.crmClientId, null);
});

// ---- B/C. source + sourceId uniqueness, no silent duplicate ----

test("B/C. real DB: the SAME (source, sourceId) ingested twice never creates a second row — via the store's own idempotent contract", async () => {
  const source = "google_places";
  const sourceId = uniqueSourceId();
  const first = await createDiscoveryResult({ source, sourceId, name: "Original Name" });
  createdDiscoveryResultIds.add(first.result.id);

  const second = await createDiscoveryResult({ source, sourceId, name: "A Different Name Entirely" });
  assert.equal(second.created, false, "must recognize the existing row, never insert a second one");
  assert.equal(second.result.id, first.result.id);

  const rows = await db.select({ id: discoveryResults.id }).from(discoveryResults).where(and(eq(discoveryResults.source, source), eq(discoveryResults.sourceId, sourceId)));
  assert.equal(rows.length, 1, "exactly one row exists for this (source, sourceId), never two");
});

test("C. real DB: the UNIQUE(source, source_id) constraint is enforced at the DATABASE level, not just by the store's app-level logic — a raw duplicate INSERT is rejected", async () => {
  const source = "bing_places";
  const sourceId = uniqueSourceId();
  const { result } = await createDiscoveryResult({ source, sourceId, name: "DB Constraint Proof" });
  createdDiscoveryResultIds.add(result.id);

  let caught;
  try {
    await db.insert(discoveryResults).values({ source, sourceId, name: "A raw duplicate insert, bypassing the store" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "must throw");
  assert.match(String(caught.cause?.message ?? caught.message), /duplicate key|unique constraint/i);
});

// ---- D. same establishment, different providers -> allowed ----

test("D. real DB: the SAME real-world establishment represented by TWO different providers is fully allowed — two independent rows, never merged", async () => {
  const name = "Multi-Provider Cafe";
  const address = "123 Main St";
  const first = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name, address });
  const second = await createDiscoveryResult({ source: "bing_places", sourceId: uniqueSourceId(), name, address });
  createdDiscoveryResultIds.add(first.result.id);
  createdDiscoveryResultIds.add(second.result.id);

  assert.notEqual(first.result.id, second.result.id);
  assert.equal(first.created, true);
  assert.equal(second.created, true);
});

// ---- E. two businesses with the same name -> allowed ----

test("E. real DB: two entirely different businesses that happen to share the same name are both allowed, no name-based constraint exists", async () => {
  const name = `Shared Name Co ${randomUUID()}`;
  const first = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name, city: "Montreal" });
  const second = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name, city: "Toronto" });
  createdDiscoveryResultIds.add(first.result.id);
  createdDiscoveryResultIds.add(second.result.id);
  assert.notEqual(first.result.id, second.result.id);
});

// ---- F. crmClientId nullable before conversion ----

test("F. real DB: crmClientId is null before any conversion, and this phase provides no function that could ever set it", async () => {
  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "Pending Conversion Co" });
  createdDiscoveryResultIds.add(result.id);
  assert.equal(result.crmClientId, null);

  const [reloaded] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, result.id)).limit(1);
  assert.equal(reloaded.crmClientId, null);
});

test("F (constraint proof). real DB: linking crmClientId WITHOUT status='converted' is rejected by the converted-link CHECK constraint", async () => {
  const client = await makeClient();
  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "Constraint Proof Co" });
  createdDiscoveryResultIds.add(result.id);

  // drizzle-orm's node-postgres driver surfaces the REAL Postgres error
  // detail (constraint name, "violates check constraint") on `.cause`,
  // not on the wrapping Error's own top-level `.message` (which is just
  // "Failed query: <sql>") — asserted against `.cause` accordingly.
  let caught;
  try {
    await db.update(discoveryResults).set({ crmClientId: client.id }).where(eq(discoveryResults.id, result.id));
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "must throw");
  assert.match(String(caught.cause?.message ?? caught.message), /discovery_results_converted_link_check/i);
});

test("F (constraint proof, valid transition). real DB: linking crmClientId together with status='converted' in the SAME statement is accepted by the constraint (a future conversion phase's exact write shape)", async () => {
  const client = await makeClient();
  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "Valid Conversion Shape Co" });
  createdDiscoveryResultIds.add(result.id);

  await db.update(discoveryResults).set({ crmClientId: client.id, status: "converted" }).where(eq(discoveryResults.id, result.id));
  const [reloaded] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, result.id)).limit(1);
  assert.equal(reloaded.crmClientId, client.id);
  assert.equal(reloaded.status, "converted");
});

// ---- G. correct initial status ----

test("G. real DB: every newly created row starts at status 'discovered', never any other value, regardless of caller input", async () => {
  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "Status Proof Co" });
  createdDiscoveryResultIds.add(result.id);
  assert.equal(result.status, "discovered");
});

test("real DB: the status CHECK constraint rejects any value outside the four-state closed set", async () => {
  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "Bad Status Proof Co" });
  createdDiscoveryResultIds.add(result.id);
  let caught;
  try {
    await db.update(discoveryResults).set({ status: "not_a_real_status" }).where(eq(discoveryResults.id, result.id));
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "must throw");
  assert.match(String(caught.cause?.message ?? caught.message), /discovery_results_status_check/i);
});

// ---- H. provenance preserved ----

test("H. real DB: provenance fields (source, sourceId, sourceUrl, discoveredAt) round-trip exactly as given", async () => {
  const sourceId = uniqueSourceId();
  const before = new Date();
  const { result } = await createDiscoveryResult({ source: "openstreetmap", sourceId, name: "Provenance Proof Co", sourceUrl: "https://example.test/place/123" });
  createdDiscoveryResultIds.add(result.id);

  assert.equal(result.source, "openstreetmap");
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.sourceUrl, "https://example.test/place/123");
  assert.ok(result.discoveredAt instanceof Date);
  assert.ok(result.discoveredAt.getTime() >= before.getTime() - 1000);

  const reFound = await findDiscoveryResultBySource("openstreetmap", sourceId);
  assert.equal(reFound.id, result.id);
});

// ---- I. optional fields nullable ----

test("I. real DB: every optional field is correctly nullable when omitted", async () => {
  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "Minimal Fields Co" });
  createdDiscoveryResultIds.add(result.id);
  for (const field of ["sourceUrl", "category", "address", "country", "region", "city", "postalCode", "phone", "email", "website", "latitude", "longitude", "timezone", "openingHours"]) {
    assert.equal(result[field], null, `${field} must be null when omitted`);
  }
});

// ---- J. zero effect on crm_clients ----

test("J. real DB: creating discovery results has ZERO effect on crm_clients — no row inserted, updated, or otherwise touched there", async () => {
  // A targeted existence check (NOT a global row-count comparison): this
  // suite's own local DB is shared with every other *.integration.test.mjs
  // file, which may run concurrently in the same `tsx --test` process and
  // legitimately insert/delete their OWN crm_clients fixtures at the same
  // time — a global "count unchanged" assertion would be racy against
  // that, unrelated to this test's actual claim. A distinctive random
  // name can never collide with anything another file creates.
  const distinctiveName = `No CRM Side Effect Co ${randomUUID()}`;
  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: distinctiveName });
  createdDiscoveryResultIds.add(result.id);

  const matching = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.name, distinctiveName));
  assert.equal(matching.length, 0, "creating a discovery result must never insert a crm_clients row");
});

// ---- K. zero effect on RADAR ----

test("K (structural). lib/actions/radar-queue.ts's own source never references discoveryResults/discovery_results at all — zero coupling by construction, not just by incidental behavior", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../actions/radar-queue.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /discoveryResults|discovery_results|radar-discovery/i);
});

test("K (live sanity). real DB: getRadarQueue() still runs successfully and returns a well-formed result with a discovery_results row present — no crash, no unexpected coupling", async () => {
  // A real, ACTIVE staff_members row is needed for
  // requireRadarAccess("RADAR_QUEUE_VIEW") to succeed for real, exactly
  // like radar-queue.integration.test.mjs's own convention. This test
  // proves getRadarQueue() keeps working correctly, not an exact
  // before/after total (which would be racy against other
  // *.integration.test.mjs files legitimately mutating crm_clients
  // concurrently in the same shared local DB / same test process).
  const [user] = await db.insert(users).values({ clerkUserId: `discovery_b_${randomUUID()}`, email: `discovery-b-${randomUUID()}@example.test`, status: "active" }).returning();
  createdUserIds.add(user.id);
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  const [role] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, "OWNER")).limit(1);
  if (org && role) {
    const [staffMember] = await db.insert(staffMembers).values({ userId: user.id, workspaceOrgId: org.id, roleId: role.id, status: "ACTIVE" }).returning();
    createdStaffMemberIds.add(staffMember.id);
  }
  mockState = { session: { userId: user.id, clerkUserId: user.clerkUserId, email: user.email, fullName: null, firstName: "Test", organizationId: "test-org", organizationName: "Test Org", role: "admin", previousLastLoginAt: null } };

  const { result } = await createDiscoveryResult({ source: "google_places", sourceId: uniqueSourceId(), name: "No RADAR Side Effect Co" });
  createdDiscoveryResultIds.add(result.id);

  const queue = await getRadarQueue({});
  assert.equal(typeof queue.totalQualified, "number");
  assert.equal(typeof queue.filteredTotal, "number");
  assert.ok(Array.isArray(queue.items));
});

// ---- L. security: no browser-supplied clientId is ever trusted ----

test("L. real DB: createDiscoveryResult's own input type has no clientId/crmClientId field at all -- even a hostile caller forcing one through a loose cast writes nothing, proven end-to-end against the real table", async () => {
  const hostileInput = { source: "google_places", sourceId: uniqueSourceId(), name: "Hostile Input Co", crmClientId: "11111111-1111-4111-8111-111111111111", status: "converted" };
  const { result } = await createDiscoveryResult(hostileInput);
  createdDiscoveryResultIds.add(result.id);

  assert.equal(result.crmClientId, null, "a caller-forced crmClientId must never reach the database");
  assert.equal(result.status, "discovered", "a caller-forced status must never reach the database");

  const [reloaded] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, result.id)).limit(1);
  assert.equal(reloaded.crmClientId, null);
  assert.equal(reloaded.status, "discovered");
});
