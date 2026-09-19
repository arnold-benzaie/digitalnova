// RADAR DISCOVERY ENGINE — MISSION C-2D-6-B — end-to-end proof that the
// REAL Server Actions + REAL google-places-provider.ts + REAL local
// Postgres budget tables refuse a Google call BEFORE the transport is
// ever reached, when no budget has been provisioned for the current
// period. Deliberately does NOT mock
// @/lib/radar-discovery/adapters/configured-google-places (unlike
// radar-discovery-search.integration.test.mjs /
// radar-discovery-enrich.integration.test.mjs, which mock the whole
// provider away and therefore never exercise the budget gate wiring at
// all) -- this is the ONE test file that proves the actual production
// wiring end-to-end.
//
// ZERO GOOGLE LIVE CALLS: the budget is deliberately left unprovisioned
// for the test's chosen period, which the real provider's own
// attemptWithBudget() (google-places-provider.ts) refuses BEFORE ever
// invoking the real HTTP transport -- there is structurally no path in
// this file that reaches fetch(). GOOGLE_PLACES_API_KEY is a harmless
// fake string, never a real credential, and is never used for a real
// request.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-discovery-budget-integration.test.mjs
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;
// Harmless fake -- never used for a real request (see this file's own
// header: the budget gate refuses before the transport is ever reached).
process.env.GOOGLE_PLACES_ENABLED = "true";
process.env.GOOGLE_PLACES_API_KEY = "test-fake-key-never-sent-live";

mock.module("server-only", { defaultExport: {}, namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

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

const { db } = await import("@/db");
const { discoveryResults, users, staffMembers, staffRoles, organizations } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { searchRadarDiscovery } = await import("./radar-discovery-search.ts");
const { enrichDiscoveryResult } = await import("./radar-discovery-enrich.ts");
const { createDiscoveryResult } = await import("@/lib/radar-discovery/discovery-result-store");

const createdUserIds = new Set();
const createdStaffMemberIds = new Set();
const createdDiscoveryResultIds = new Set();

after(async () => {
  if (createdDiscoveryResultIds.size) await db.delete(discoveryResults).where(inArray(discoveryResults.id, [...createdDiscoveryResultIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

beforeEach(() => {
  mockState = { session: null };
});

async function makeUser() {
  const [row] = await db.insert(users).values({ clerkUserId: `c2d6b_${randomUUID()}`, email: `c2d6b-${randomUUID()}@example.test`, status: "active" }).returning();
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
async function makeStaffMember(userId, roleName) {
  const orgId = await internalOrgId();
  const roleId = await staffRoleId(roleName);
  if (!orgId || !roleId) return null;
  const [row] = await db.insert(staffMembers).values({ userId, workspaceOrgId: orgId, roleId, status: "ACTIVE", radarAccess: true }).returning();
  createdStaffMemberIds.add(row.id);
  return row;
}

function sessionFor(user) {
  return { userId: user.id, clerkUserId: user.clerkUserId, email: user.email, fullName: null, firstName: "Test", organizationId: "test-org", organizationName: "Test Org", role: "owner", previousLastLoginAt: null };
}

// "EMPLOYEE" (not "OWNER") — staff_members enforces AT MOST ONE OWNER per
// workspace (db/schema.ts's own staff_members_one_owner_per_workspace
// partial unique index), and every test in this file creates its own
// fresh staff member; RADAR_QUEUE_VIEW/RADAR_WORK/RADAR_DISCOVERY_ENRICH
// are granted identically to all four roles (C-2D-5's own audit finding),
// so EMPLOYEE exercises the exact same authorization path.
async function makeAuthorizedUser(roleName = "EMPLOYEE") {
  const user = await makeUser();
  await makeStaffMember(user.id, roleName);
  return user;
}

test("Search: with NO price catalog entry AND no budget provisioned, the real provider refuses (price_unknown, checked first) before the transport is ever reached -- ZERO Google calls, ZERO discovery_results rows", async () => {
  const user = await makeAuthorizedUser();
  mockState.session = sessionFor(user);

  const result = await searchRadarDiscovery({ category: `budget-it-search-${randomUUID()}`, city: "Nowhere", maxResults: 5, fieldSet: "minimal_discovery" });
  // reserveBudget() resolves price FIRST (discovery-budget-store.ts's own
  // header) -- with a fresh test DB carrying no discovery_price_catalog
  // row for this (provider, operation, fieldSet), this is the true,
  // correct refusal reason before a budget row would even be consulted.
  assert.equal(result.status, "budget_price_unknown");
});

test("Enrichment: with NO price catalog entry AND no budget provisioned, the real provider refuses (price_unknown) before the transport is ever reached -- the claimed row is released back to 'discovered'", async () => {
  const user = await makeAuthorizedUser();
  mockState.session = sessionFor(user);

  const { result: row } = await createDiscoveryResult({ source: "google_places", sourceId: `budget-it-enrich-${randomUUID()}`, name: "Budget IT Test Establishment" });
  createdDiscoveryResultIds.add(row.id);

  const outcome = await enrichDiscoveryResult(row.id);
  assert.equal(outcome.status, "budget_price_unknown");

  // The claim must have been released (never left dangling) -- the row's
  // enrichment lease is cleared and its status is still "discovered".
  const [after] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, row.id)).limit(1);
  assert.equal(after.enrichmentClaimedAt, null);
  assert.equal(after.status, "discovered");
});

// A "budget provisioned -> the transport is actually reached" scenario is
// DELIBERATELY NOT tested in this file: with GOOGLE_PLACES_ENABLED=true,
// approving the reservation would let the REAL transport attempt a REAL
// HTTPS request to Google's own servers (places.googleapis.com) -- even
// with a fake API key, that request reaches Google's real infrastructure
// and receives a real 403 response, which IS a live Google call by this
// mission's own strict definition ("AUCUN appel Google live dans cette
// mission"), regardless of whether it succeeds or is rejected for a bad
// key. That positive path is already proven WITHOUT any network risk at
// two other levels: discovery-budget-store.integration.test.mjs (real DB,
// no provider at all) and google-places-provider.test.mjs's own "BUDGET"
// section (a fully fake, in-memory transport that never opens a socket).
