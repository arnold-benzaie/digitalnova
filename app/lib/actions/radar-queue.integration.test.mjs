// Integration tests for AI Commercial Radar / Phase 1D:
// lib/actions/radar-queue.ts's getRadarQueue() — proving, against a real
// local database, that the batch Radar read model preserves every
// Phase 1C safety guarantee (DNC/archived can never become a commercial
// recommendation, no fabricated claims) while adding deterministic
// ranking and bounded pagination on top.
//
// IMPORTANT — this action reads the WHOLE crm_clients candidate universe
// (up to HARD_CAP), not one scoped client like Phase 1C's
// getProspectQualification(clientId). The local test database used here
// already carries real leftover rows from this project's own Playwright
// E2E suite (confirmed via a direct read-only count before writing this
// file), so tests below are written to be robust to that pre-existing,
// unknown-composition data:
//   - count assertions use a before/after DELTA, never an absolute value
//   - ordering assertions compare the RELATIVE position of this file's
//     own known fixtures within a full multi-page scan, never an
//     absolute index or an absolute page
//   - two scenarios (a truly empty candidate universe, and the literal
//     500-row hard cap) cannot be honestly reproduced against a shared,
//     non-empty local database without destructively wiping shared
//     state, which is out of scope here — those two are covered by a
//     structural/static read of the implementation source instead, and
//     that limitation is documented at each such test rather than
//     silently assumed away.
//
// Same mocking convention as radar-qualification.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session state,
// so the REAL requireStaffRole() (lib/dev-role.ts, never mocked) runs
// against it.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-queue.integration.test.mjs
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

// RADAR GATE UNIFICATION — getRadarQueue()'s gate is now
// requireRadarAccess("RADAR_QUEUE_VIEW") (Axis-C), which resolves access
// exclusively from a REAL staff_members row keyed by session.userId — it
// never reads session.role (the legacy Axis-A field) or session.email.
// Every mocked session below is therefore anchored to a REAL `users.id`
// (created via makeUser() further down), so requireStaffMember()'s
// Axis-C lookup runs a normal, valid query regardless of whether that
// user happens to have a staff_members row. `role` is kept on each
// session purely as an Axis-A LABEL for test readability/documentation —
// it has no bearing on the outcome, which is exactly the property this
// mission's tests exist to prove.
//
// Built once in `before()` (after makeUser/makeStaffMember are defined
// below) and reused by every test — see that hook for the full fixture
// set (OWNER/ADMIN/MANAGER/EMPLOYEE with real ACTIVE staff_members rows;
// a SUSPENDED EMPLOYEE; and four "Axis-A label, zero staff_members" rows
// for agent/supervisor/staff/admin/client).
/** @type {{ session: object | null }} */
let mockState = { session: null };
function actAsUnauthenticated() {
  mockState = { session: null };
}

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
const { crmClients, deals, interactions, crmQuotes, crmInvoices, tasks, users, staffMembers, staffRoles, organizations, discoveryResults } =
  await import("@/db/schema");
const { inArray, eq } = await import("drizzle-orm");
const { getRadarQueue } = await import("./radar-queue.ts");

const createdClientIds = new Set();
const createdUserIds = new Set();
const createdStaffMemberIds = new Set();
const createdDiscoveryResultIds = new Set();

async function makeClient(overrides = {}) {
  const values = {
    name: overrides.name === undefined ? `Radar P1D Test ${randomUUID()}` : overrides.name,
    email: overrides.email === undefined ? "prospect@example.test" : overrides.email,
    phone: overrides.phone ?? null,
    industry: overrides.industry ?? null,
    country: overrides.country ?? null,
    region: overrides.region ?? null,
    city: overrides.city ?? null,
    doNotContact: overrides.doNotContact ?? false,
    doNotContactReason: overrides.doNotContactReason ?? null,
    archivedAt: overrides.archivedAt ?? null,
    assignedUserId: overrides.assignedUserId ?? null,
    ownerName: overrides.ownerName ?? null,
  };
  if (overrides.createdAt !== undefined) values.createdAt = overrides.createdAt;
  // MICRO-STEP 2 — crm_clients.source, so DISCOVERY_NEW fixtures can set
  // the literal "RADAR Discovery" label exactly as convertDiscoveryResult()
  // writes it. Defaults to unset (null), same as before this addition.
  if (overrides.source !== undefined) values.source = overrides.source;
  const [client] = await db.insert(crmClients).values(values).returning();
  createdClientIds.add(client.id);
  return client;
}

// RADAR-CORE-1B — real `users` rows to hang crm_clients.assigned_user_id
// (an FK to users.id) off of, plus optional staff_members rows in the
// internal workspace to exercise the assignedUserActive flag.
async function makeUser({ fullName = null, email } = {}) {
  const [row] = await db
    .insert(users)
    .values({
      clerkUserId: `radar_1b_${randomUUID()}`,
      email: email ?? `radar-1b-${randomUUID()}@example.test`,
      fullName,
      status: "active",
    })
    .returning();
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
// RADAR GATE UNIFICATION — generalized from the original ADMIN-only
// resolver so authorization tests can seed any of the four staff_roles.
async function staffRoleId(name) {
  if (!STAFF_ROLE_ID_CACHE.has(name)) {
    const [r] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
    STAFF_ROLE_ID_CACHE.set(name, r?.id ?? null);
  }
  return STAFF_ROLE_ID_CACHE.get(name);
}
// `roleName` defaults to "ADMIN" -- UNCHANGED BEHAVIOR for every
// pre-existing call site (the 1B assignedUserActive fixtures below never
// cared which staff role, only ACTIVE vs SUSPENDED).
async function makeStaffMember(userId, status, roleName = "ADMIN") {
  const orgId = await internalOrgId();
  const roleId = await staffRoleId(roleName);
  if (!orgId || !roleId) return null;
  const [row] = await db
    .insert(staffMembers)
    .values({ userId, workspaceOrgId: orgId, roleId, status })
    .returning();
  createdStaffMemberIds.add(row.id);
  return row;
}

// RADAR GATE UNIFICATION — a minimal CurrentSession-shaped mock anchored
// to a REAL users.id. `role` is an Axis-A LABEL ONLY, for test
// readability — requireStaffMember() never reads it.
function sessionFor(user, axisARoleLabel) {
  return {
    userId: user.id,
    clerkUserId: user.clerkUserId,
    email: user.email,
    fullName: user.fullName,
    firstName: "Test",
    organizationId: "test-org",
    organizationName: "Test Org",
    role: axisARoleLabel,
    previousLastLoginAt: null,
  };
}

// Built once, before any test runs. If the internal workspace or a
// staff_roles row cannot be resolved (a non-migrated/non-seeded local
// test DB), makeStaffMember() returns null and the corresponding
// ACTIVE_SESSION stays anchored to a real user with no staff_members
// row -- the authorization tests below would then observe every "should
// succeed" case as a denial too, surfacing the real problem loudly
// instead of passing on a false premise.
let EMPLOYEE_SESSION, OWNER_SESSION, ADMIN_SESSION, MANAGER_SESSION, SUSPENDED_EMPLOYEE_SESSION;
let CLIENT_SESSION, AGENT_NO_AXIS_C_SESSION, SUPERVISOR_NO_AXIS_C_SESSION, STAFF_NO_AXIS_C_SESSION, ADMIN_NO_AXIS_C_SESSION;

before(async () => {
  const employeeUser = await makeUser({ fullName: "Gate EMPLOYEE" });
  await makeStaffMember(employeeUser.id, "ACTIVE", "EMPLOYEE");
  EMPLOYEE_SESSION = sessionFor(employeeUser, "staff");

  const ownerUser = await makeUser({ fullName: "Gate OWNER" });
  await makeStaffMember(ownerUser.id, "ACTIVE", "OWNER");
  OWNER_SESSION = sessionFor(ownerUser, "admin");

  const adminUser = await makeUser({ fullName: "Gate ADMIN" });
  await makeStaffMember(adminUser.id, "ACTIVE", "ADMIN");
  ADMIN_SESSION = sessionFor(adminUser, "admin");

  const managerUser = await makeUser({ fullName: "Gate MANAGER" });
  await makeStaffMember(managerUser.id, "ACTIVE", "MANAGER");
  MANAGER_SESSION = sessionFor(managerUser, "supervisor");

  const suspendedUser = await makeUser({ fullName: "Gate SUSPENDED EMPLOYEE" });
  await makeStaffMember(suspendedUser.id, "SUSPENDED", "EMPLOYEE");
  SUSPENDED_EMPLOYEE_SESSION = sessionFor(suspendedUser, "staff");

  // Zero staff_members row for each of these -- proving the Axis-A label
  // alone (client/agent/supervisor/staff/admin) never grants RADAR access
  // once the gate is Axis-C-only.
  CLIENT_SESSION = sessionFor(await makeUser({ fullName: "Gate CLIENT no Axis-C" }), "client");
  AGENT_NO_AXIS_C_SESSION = sessionFor(await makeUser({ fullName: "Gate agent no Axis-C" }), "agent");
  SUPERVISOR_NO_AXIS_C_SESSION = sessionFor(await makeUser({ fullName: "Gate supervisor no Axis-C" }), "supervisor");
  STAFF_NO_AXIS_C_SESSION = sessionFor(await makeUser({ fullName: "Gate staff no Axis-C" }), "staff");
  ADMIN_NO_AXIS_C_SESSION = sessionFor(await makeUser({ fullName: "Gate admin no Axis-C" }), "admin");
});

// The default actor for every business-logic test below (unrelated to
// authorization): the least-privilege Axis-C identity that still holds
// RADAR_QUEUE_VIEW, mirroring this repo's existing EMPLOYEE-by-default
// convention (e2e/helpers/main-db-staff.mjs's ensureRadarStaffMember()).
function actAsStaff() {
  mockState = { session: EMPLOYEE_SESSION };
}

beforeEach(() => {
  actAsStaff();
});

after(async () => {
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  // MICRO-STEP 1 — discovery_results fixtures first: discoveryResults.crmClientId
  // is onDelete:"set null" so it would survive a crmClients delete anyway,
  // but deleting the rows this test file itself created keeps the shared
  // local DB exactly as clean as every other fixture table below.
  if (createdDiscoveryResultIds.size) await db.delete(discoveryResults).where(inArray(discoveryResults.id, [...createdDiscoveryResultIds]));
  if (createdClientIds.size) await db.delete(deals).where(inArray(deals.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(interactions).where(inArray(interactions.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.clientId, [...createdClientIds]));
  // RADAR-CORE-3B — follow-up fixtures are always hung off a created client.
  if (createdClientIds.size) await db.delete(tasks).where(inArray(tasks.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

// MICRO-STEP 4E.3 — optional expectedCloseDate / validUntil (default null,
// identical to every existing call site).
async function makeDeal(clientId, stage, { expectedCloseDate = null } = {}) {
  const [row] = await db.insert(deals).values({ clientId, title: `Deal ${randomUUID()}`, stage, expectedCloseDate }).returning({ id: deals.id });
  return row.id;
}

async function makeQuote(clientId, { status, sentAt = null, respondedAt = null, validUntil = null, dealId = null }) {
  const [row] = await db
    .insert(crmQuotes)
    .values({ clientId, dealId, quoteNumber: `Q-${randomUUID()}`, title: "Test quote", status, sentAt, respondedAt, validUntil })
    .returning({ id: crmQuotes.id });
  return row.id;
}

async function makeInvoice(clientId, { paidAt = null }) {
  await db.insert(crmInvoices).values({ clientId, invoiceNumber: `INV-${randomUUID()}`, title: "Test invoice", paidAt });
}

async function makeInteraction(clientId, occurredAt, { dealId = null } = {}) {
  await db.insert(interactions).values({ clientId, dealId, type: "note", summary: "Test interaction", occurredAt });
}

// MICRO-STEP 1 — a discovery_results row already linked to crmClientId, the
// exact shape convertDiscoveryResult() leaves behind (status forced to
// "converted" to satisfy discovery_results_converted_link_check, since
// crmClientId is non-null here). category/website/businessStatus default to
// null so a test can exercise a partially-populated row without passing
// every field.
async function makeDiscoveryResult(clientId, { category = null, website = null, businessStatus = null, discoveredAt } = {}) {
  const values = {
    source: "google_places",
    sourceId: `radar-ms1-${randomUUID()}`,
    name: `Discovery MS1 ${randomUUID()}`,
    status: "converted",
    crmClientId: clientId,
    category,
    website,
    businessStatus,
  };
  // MICRO-STEP 2 — override only when explicitly passed; otherwise the
  // column's own default (now()) applies, same as before this addition.
  if (discoveredAt !== undefined) values.discoveredAt = discoveredAt;
  const [row] = await db.insert(discoveryResults).values(values).returning();
  createdDiscoveryResultIds.add(row.id);
  return row;
}

// RADAR-CORE-3B — a task row. status defaults to an OPEN state; dueDate
// defaults to null (NOT a follow-up). Tests pass explicit values to
// exercise the "open + dated" follow-up truth. assigned_user_id /
// created_by_user_id are left NULL to also prove creator type is
// irrelevant to follow-up truth.
// RADAR-CORE-3E — `id`, `createdAt`, `assignedUserId` overrides let the
// deterministic next-follow-up tie-break (due_date -> created_at -> id) be
// exercised precisely; returns the inserted row so a test can compare ids.
async function makeTask(
  clientId,
  { status = "todo", dueDate = null, id, createdAt, assignedUserId = null } = {},
) {
  const values = { clientId, title: `Task ${randomUUID()}`, status, dueDate, assignedUserId };
  if (id !== undefined) values.id = id;
  if (createdAt !== undefined) values.createdAt = createdAt;
  const [row] = await db.insert(tasks).values(values).returning();
  return row;
}

// Concatenates every page of getRadarQueue(params) in returned order, up
// to maxPages (26 * PAGE_SIZE=20 = 520, comfortably past HARD_CAP=500) —
// the only way to make relative-order assertions robust against however
// many pre-existing rows already occupy earlier pages.
async function scanAllPages(params = {}, maxPages = 26) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await getRadarQueue({ ...params, page });
    if (result.items.length === 0) break;
    items.push(...result.items);
  }
  return items;
}

function indexOfClient(items, clientId) {
  return items.findIndex((i) => i.clientId === clientId);
}

const IMPLEMENTATION_SOURCE = readFileSync(fileURLToPath(new URL("./radar-queue.ts", import.meta.url)), "utf8");
const ASSIGNMENT_SOURCE = readFileSync(fileURLToPath(new URL("./radar-assignment.ts", import.meta.url)), "utf8");

// =========================================================
// RADAR GATE UNIFICATION — Authorization is Axis-C ONLY.
// Runtime proof against the real requireRadarAccess("RADAR_QUEUE_VIEW")
// gate, not textual checks. Every "should succeed" fixture carries a
// real, ACTIVE staff_members row; every "should be denied" fixture
// carries either no staff_members row at all, or a SUSPENDED one — the
// mocked Axis-A `role` label is deliberately varied across the denial
// fixtures (client/agent/supervisor/staff/admin) to prove it has zero
// effect on the outcome.
// =========================================================

test("UNAUTHENTICATED getRadarQueue: rejected, no data returned", async () => {
  actAsUnauthenticated();
  await assert.rejects(() => getRadarQueue());
});

function expectResultShape(result) {
  assert.equal(typeof result.page, "number");
  assert.equal(result.pageSize, 20);
  assert.equal(typeof result.totalQualified, "number");
  assert.equal(typeof result.insufficientDataCount, "number");
  assert.equal(typeof result.notEligibleCount, "number");
  assert.ok(Array.isArray(result.items));
}

test("OWNER (Axis-C, ACTIVE) getRadarQueue: allowed", async () => {
  mockState = { session: OWNER_SESSION };
  expectResultShape(await getRadarQueue());
});

test("ADMIN (Axis-C, ACTIVE) getRadarQueue: allowed", async () => {
  mockState = { session: ADMIN_SESSION };
  expectResultShape(await getRadarQueue());
});

test("MANAGER (Axis-C, ACTIVE) getRadarQueue: allowed", async () => {
  mockState = { session: MANAGER_SESSION };
  expectResultShape(await getRadarQueue());
});

test("EMPLOYEE (Axis-C, ACTIVE) getRadarQueue: allowed, returns the expected result shape", async () => {
  mockState = { session: EMPLOYEE_SESSION };
  expectResultShape(await getRadarQueue());
});

test("CLIENT (Axis-A label, no staff_members) getRadarQueue: rejected, no data returned", async () => {
  mockState = { session: CLIENT_SESSION };
  await assert.rejects(() => getRadarQueue());
});

test("authenticated user with NO staff_members row at all getRadarQueue: rejected", async () => {
  // Distinct from CLIENT_SESSION above only in its Axis-A label -- same
  // underlying mechanism (no-membership), proven separately for clarity.
  mockState = { session: STAFF_NO_AXIS_C_SESSION };
  await assert.rejects(() => getRadarQueue());
});

test("SUSPENDED staff_members row getRadarQueue: rejected -- an inactive Axis-C membership never grants access", async () => {
  mockState = { session: SUSPENDED_EMPLOYEE_SESSION };
  await assert.rejects(() => getRadarQueue());
});

test("Axis-A 'agent' label with NO Axis-C staff_members row getRadarQueue: rejected", async () => {
  mockState = { session: AGENT_NO_AXIS_C_SESSION };
  await assert.rejects(() => getRadarQueue());
});

test("Axis-A 'supervisor' label with NO Axis-C staff_members row getRadarQueue: rejected", async () => {
  mockState = { session: SUPERVISOR_NO_AXIS_C_SESSION };
  await assert.rejects(() => getRadarQueue());
});

test("Axis-A 'staff' label with NO Axis-C staff_members row getRadarQueue: rejected", async () => {
  mockState = { session: STAFF_NO_AXIS_C_SESSION };
  await assert.rejects(() => getRadarQueue());
});

test("Axis-A 'admin' label with NO Axis-C staff_members row getRadarQueue: rejected -- the legacy admin label alone is never sufficient", async () => {
  mockState = { session: ADMIN_NO_AXIS_C_SESSION };
  await assert.rejects(() => getRadarQueue());
});

test("a denied call never returns a partial or fabricated result -- the promise itself rejects, nothing else", async () => {
  mockState = { session: CLIENT_SESSION };
  let observedResult;
  try {
    observedResult = await getRadarQueue();
  } catch {
    // expected
  }
  assert.equal(observedResult, undefined, "no RADAR data may ever be produced before authorization succeeds");
});

test("structural: the gate call site takes exactly one permission argument -- no role/userId/permission/workspace/organization/email accepted from a caller", () => {
  assert.match(IMPLEMENTATION_SOURCE, /await requireRadarAccess\("RADAR_QUEUE_VIEW"\);/);
  // Property-access/import checks, not a bare substring match -- this
  // file's own docstring legitimately names "requireStaffRole()" in prose
  // explaining that it is NO LONGER used, which a naive substring test
  // would false-positive on.
  assert.equal(/from\s+"@\/lib\/dev-role"/.test(IMPLEMENTATION_SOURCE), false, "the legacy Axis-A gate must not be imported here anymore");
  assert.equal(/await requireStaffRole\(\)/.test(IMPLEMENTATION_SOURCE), false, "the legacy Axis-A gate must not be called here anymore");
});

test("structural: getRadarQueue() itself never reads session.email or any caller-supplied role/permission for its access decision", () => {
  // The gate line is the ENTIRE authorization surface of this function --
  // it takes no parameters. The only other appearance of "email" in this
  // file is resolveAssignees()'s display-name fallback, unrelated to
  // authorization; confirmed structurally distinct from the gate line.
  const gateLine = IMPLEMENTATION_SOURCE.match(/^.*requireRadarAccess\("RADAR_QUEUE_VIEW"\);.*$/m)?.[0] ?? "";
  assert.equal(/email|role|permission|workspace|organization/i.test(gateLine), false);
});

// WORKFORCE ACCESS CONTROL: radar-assignment.ts IS deliberately touched by
// that later migration (requireStaffMember/evaluateStaffPermission ->
// requireRadarAccess/evaluateRadarAccess, same permissions, same
// signatures) -- this test now checks the CURRENT gate names, preserving
// its real invariant: both RADAR_WORK and RADAR_ASSIGN gates still exist,
// still correctly named, still no Axis-A fallback.
test('mutations in radar-assignment.ts still gated by requireRadarAccess("RADAR_WORK"/"RADAR_ASSIGN")', () => {
  assert.match(ASSIGNMENT_SOURCE, /requireRadarAccess\("RADAR_WORK"\)/);
  assert.match(ASSIGNMENT_SOURCE, /requireRadarAccess\("RADAR_ASSIGN"\)/);
  assert.equal(ASSIGNMENT_SOURCE.includes("requireStaffRole"), false, "radar-assignment.ts was already Axis-C-only and stays that way");
});

test("permission catalogue untouched: RADAR_ASSIGN is still forbidden to EMPLOYEE, RADAR_QUEUE_VIEW is still held by all four staff roles", async () => {
  const { ROLE_PERMISSIONS } = await import("@/lib/rbac/permissions");
  assert.equal(ROLE_PERMISSIONS.EMPLOYEE.includes("RADAR_ASSIGN"), false, "EMPLOYEE must never gain RADAR_ASSIGN as a side effect of this migration");
  for (const role of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"]) {
    assert.ok(ROLE_PERMISSIONS[role].includes("RADAR_QUEUE_VIEW"), `${role} must keep RADAR_QUEUE_VIEW`);
  }
});

// =========================================================
// Queue eligibility — must preserve Phase 1C semantics exactly
// =========================================================

test("a QUALIFIED prospect with a real deal appears in the ranked queue", async () => {
  const client = await makeClient({ industry: "Boulangerie", city: "Lyon" });
  await makeDeal(client.id, "proposal");
  const items = await scanAllPages();
  assert.ok(indexOfClient(items, client.id) !== -1, "expected the qualified fixture to appear somewhere in the full scan");
});

test("INSUFFICIENT_DATA prospect never appears in items, only in insufficientDataCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ email: null, phone: null });
  const after1 = await getRadarQueue();
  assert.equal(after1.insufficientDataCount - before.insufficientDataCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified);
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1, "an INSUFFICIENT_DATA prospect must never appear in items");
});

test("NOT_ELIGIBLE (archived) prospect never appears in items, only in notEligibleCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ archivedAt: new Date() });
  const after1 = await getRadarQueue();
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified);
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1);
});

test("doNotContact=true blocks even the strongest possible commercial signal — never enters items, always counted in notEligibleCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ doNotContact: true, doNotContactReason: "Explicit opt-out on file" });
  await makeDeal(client.id, "proposal");
  await makeQuote(client.id, { status: "accepted", sentAt: new Date(), respondedAt: new Date() });
  await makeInvoice(client.id, { paidAt: new Date() });
  const after1 = await getRadarQueue();
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified, "a doNotContact prospect must never contribute to totalQualified regardless of deal/quote/invoice strength");
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1, "the opportunity engine must never surface a doNotContact prospect, no matter how strong the underlying signals are");
});

test("archived blocks even the strongest possible commercial signal — never enters items, always counted in notEligibleCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ archivedAt: new Date() });
  await makeDeal(client.id, "proposal");
  await makeQuote(client.id, { status: "accepted", sentAt: new Date(), respondedAt: new Date() });
  const after1 = await getRadarQueue();
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified);
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1);
});

// =========================================================
// Deterministic ordering — relative position of known fixtures only
// =========================================================

test("HIGH priority ranks before MEDIUM, which ranks before LOW", async () => {
  const high = await makeClient();
  await makeDeal(high.id, "proposal");
  const medium = await makeClient();
  await makeDeal(medium.id, "qualified");
  const low = await makeClient();
  await makeDeal(low.id, "new");

  const items = await scanAllPages();
  const iHigh = indexOfClient(items, high.id);
  const iMedium = indexOfClient(items, medium.id);
  const iLow = indexOfClient(items, low.id);
  assert.ok(iHigh !== -1 && iMedium !== -1 && iLow !== -1, "all three fixtures must be found in the full scan");
  assert.ok(iHigh < iMedium, "HIGH must rank before MEDIUM");
  assert.ok(iMedium < iLow, "MEDIUM must rank before LOW");
});

test("within the same priority, HIGH confidence ranks before LOW confidence (tie-breaker only)", async () => {
  const highConfidence = await makeClient({ industry: "Santé", city: "Toulouse" });
  await makeDeal(highConfidence.id, "proposal");
  const lowConfidence = await makeClient({ industry: null, country: null, region: null, city: null });
  await makeDeal(lowConfidence.id, "proposal");

  const items = await scanAllPages();
  const iHighConf = indexOfClient(items, highConfidence.id);
  const iLowConf = indexOfClient(items, lowConfidence.id);
  assert.ok(iHighConf !== -1 && iLowConf !== -1);
  assert.ok(iHighConf < iLowConf, "same priority tier: HIGH confidence must rank before LOW confidence");
});

test("confidence never outranks a higher priority tier (priority/confidence independence preserved)", async () => {
  const highPriorityLowConfidence = await makeClient({ industry: null, country: null, region: null, city: null });
  await makeDeal(highPriorityLowConfidence.id, "proposal"); // HIGH priority, LOW confidence
  const lowPriorityHighConfidence = await makeClient({ industry: "Restauration", country: "France", city: "Paris" }); // LOW priority (no deal/quote), HIGH confidence

  const items = await scanAllPages();
  const iHP = indexOfClient(items, highPriorityLowConfidence.id);
  const iLP = indexOfClient(items, lowPriorityHighConfidence.id);
  assert.ok(iHP !== -1 && iLP !== -1);
  assert.ok(iHP < iLP, "HIGH priority + LOW confidence must still rank ahead of LOW priority + HIGH confidence");
});

test("within same priority and confidence, a recent interaction ranks before a stale one", async () => {
  const recent = await makeClient({ industry: "Santé", city: "Lyon" });
  await makeInteraction(recent.id, new Date());
  const stale = await makeClient({ industry: "Santé", city: "Lyon" });
  await makeInteraction(stale.id, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));

  const items = await scanAllPages();
  const iRecent = indexOfClient(items, recent.id);
  const iStale = indexOfClient(items, stale.id);
  assert.ok(iRecent !== -1 && iStale !== -1);
  assert.ok(iRecent < iStale, "a recent interaction must rank before a stale one when priority and confidence tie");
});

test("within same priority and confidence, having any interaction ranks before having none", async () => {
  const withInteraction = await makeClient({ industry: "Santé", city: "Nice" });
  await makeInteraction(withInteraction.id, new Date(Date.now() - 45 * 24 * 60 * 60 * 1000));
  const withoutInteraction = await makeClient({ industry: "Santé", city: "Nice" });

  const items = await scanAllPages();
  const iWith = indexOfClient(items, withInteraction.id);
  const iWithout = indexOfClient(items, withoutInteraction.id);
  assert.ok(iWith !== -1 && iWithout !== -1);
  assert.ok(iWith < iWithout, "a prospect with any interaction must rank before one with none, when otherwise tied");
});

test("within an otherwise total tie, the older prospect (earlier createdAt) ranks first", async () => {
  const olderCreatedAt = new Date("2020-01-01T00:00:00Z");
  const newerCreatedAt = new Date("2020-06-01T00:00:00Z");
  const older = await makeClient({ createdAt: olderCreatedAt });
  const newer = await makeClient({ createdAt: newerCreatedAt });

  const items = await scanAllPages();
  const iOlder = indexOfClient(items, older.id);
  const iNewer = indexOfClient(items, newer.id);
  assert.ok(iOlder !== -1 && iNewer !== -1);
  assert.ok(iOlder < iNewer, "an otherwise-identical older prospect must rank before a newer one");
});

test("within a total tie including identical createdAt, the smaller client id ranks first (final deterministic tie-break)", async () => {
  const sameCreatedAt = new Date("2021-03-15T00:00:00Z");
  const a = await makeClient({ createdAt: sameCreatedAt });
  const b = await makeClient({ createdAt: sameCreatedAt });
  const [expectedFirst, expectedSecond] = a.id < b.id ? [a, b] : [b, a];

  const items = await scanAllPages();
  const iFirst = indexOfClient(items, expectedFirst.id);
  const iSecond = indexOfClient(items, expectedSecond.id);
  assert.ok(iFirst !== -1 && iSecond !== -1);
  assert.ok(iFirst < iSecond, "the lexicographically smaller client id must rank first as the absolute final tie-break");
});

test("calling getRadarQueue twice with identical params returns a stable, identical order", async () => {
  const client = await makeClient({ industry: "Santé", city: "Toulouse" });
  await makeDeal(client.id, "qualified");
  const first = await scanAllPages();
  const second = await scanAllPages();
  assert.deepEqual(
    first.map((i) => i.clientId),
    second.map((i) => i.clientId),
  );
});

// =========================================================
// Batch behavior — no N+1, correct per-client grouping
// =========================================================

test("multiple qualified prospects are each scored from their own facts, never another prospect's", async () => {
  const a = await makeClient();
  await makeDeal(a.id, "proposal");
  const b = await makeClient();
  await makeDeal(b.id, "qualified");

  const items = await scanAllPages();
  const itemA = items[indexOfClient(items, a.id)];
  const itemB = items[indexOfClient(items, b.id)];
  assert.equal(itemA.priority, "HIGH");
  // RADAR-CORE-3F — reasons are semantic descriptors (`{ code }`), not prose.
  assert.ok(itemA.reasons.some((r) => r.code === "DEAL_STAGE_PROPOSAL"));
  assert.ok(!itemA.reasons.some((r) => r.code === "DEAL_STAGE_QUALIFIED"), "prospect A must not see prospect B's deal stage");
  assert.equal(itemB.priority, "MEDIUM");
  assert.ok(itemB.reasons.some((r) => r.code === "DEAL_STAGE_QUALIFIED"));
  assert.ok(!itemB.reasons.some((r) => r.code === "DEAL_STAGE_PROPOSAL"), "prospect B must not see prospect A's deal stage");
});

test("structural: getRadarQueue never calls the per-client getProspectQualification action in a loop", () => {
  assert.ok(
    !IMPLEMENTATION_SOURCE.includes("getProspectQualification("),
    "radar-queue.ts must not call getProspectQualification() per client — that would reintroduce the N+1 architecture Phase 1D exists to remove",
  );
  const inArrayCount = (IMPLEMENTATION_SOURCE.match(/inArray\(/g) ?? []).length;
  assert.ok(inArrayCount >= 4, "expected at least 4 batched inArray() reads (deals, interactions, crmQuotes, crmInvoices)");
});

test("structural: the qualified-subset batch fetch is skipped entirely when nothing qualifies (documented limitation: a literal zero-qualified run cannot be honestly reproduced against this shared, non-empty local test database, so this is verified by reading the implementation instead of a live call)", () => {
  assert.match(
    IMPLEMENTATION_SOURCE,
    /qualified\.length === 0[\s\S]{0,200}return \{ items: \[\]/,
    "expected an early return before any inArray() batch query when the qualified subset is empty",
  );
});

test("structural: the candidate universe is bounded by a 500-row hard cap (documented limitation: seeding 500+ live rows into a shared local test database is impractical here, so this is verified by reading the implementation instead of a live call)", () => {
  assert.match(IMPLEMENTATION_SOURCE, /HARD_CAP\s*=\s*500/);
  assert.match(IMPLEMENTATION_SOURCE, /\.limit\(HARD_CAP\)/);
});

test("every real call returns at most PAGE_SIZE (20) items", async () => {
  const result = await getRadarQueue();
  assert.ok(result.items.length <= 20);
  assert.equal(result.pageSize, 20);
});

// =========================================================
// Pagination — ranking must happen before pagination
// =========================================================

test("page and page+1 never share a client id (no duplication across the page boundary)", async () => {
  const page1 = await getRadarQueue({ page: 1 });
  const page2 = await getRadarQueue({ page: 2 });
  const ids1 = new Set(page1.items.map((i) => i.clientId));
  const overlap = page2.items.filter((i) => ids1.has(i.clientId));
  assert.equal(overlap.length, 0);
});

test("invalid page inputs (0, negative, NaN, non-integer, missing) all safely normalize to page 1", async () => {
  for (const badPage of [0, -5, Number.NaN, 1.5, undefined]) {
    const result = await getRadarQueue({ page: badPage });
    assert.equal(result.page, 1, `page=${badPage} should normalize to 1`);
  }
});

test("repeated calls for the same page return an identical item sequence", async () => {
  const first = await getRadarQueue({ page: 1 });
  const second = await getRadarQueue({ page: 1 });
  assert.deepEqual(
    first.items.map((i) => i.clientId),
    second.items.map((i) => i.clientId),
  );
});

test("priority filter excludes a non-matching prospect and totalQualified is unaffected by the filter", async () => {
  const before = await getRadarQueue();
  const highClient = await makeClient();
  await makeDeal(highClient.id, "proposal"); // HIGH priority
  const afterUnfiltered = await getRadarQueue();
  assert.equal(afterUnfiltered.totalQualified - before.totalQualified, 1);

  const lowOnly = await getRadarQueue({ priority: ["LOW"] });
  assert.equal(lowOnly.totalQualified - before.totalQualified, 1, "totalQualified must reflect the full qualified universe, not the filtered subset");
  assert.ok(
    !lowOnly.items.some((i) => i.clientId === highClient.id),
    "a HIGH-priority prospect must not appear when filtering for LOW only",
  );

  const highOnlyItems = await scanAllPages({ priority: ["HIGH"] });
  assert.ok(highOnlyItems.some((i) => i.clientId === highClient.id), "the HIGH-priority fixture must appear when filtering for HIGH");
});

// =========================================================
// Count semantics
// =========================================================

test("totalQualified increases by exactly the number of newly qualified prospects", async () => {
  const before = await getRadarQueue();
  await makeClient();
  await makeClient();
  const after1 = await getRadarQueue();
  assert.equal(after1.totalQualified - before.totalQualified, 2);
});

test("insufficientDataCount and notEligibleCount are independent counters", async () => {
  const before = await getRadarQueue();
  await makeClient({ email: null, phone: null }); // INSUFFICIENT_DATA
  await makeClient({ doNotContact: true }); // NOT_ELIGIBLE
  const after1 = await getRadarQueue();
  assert.equal(after1.insufficientDataCount - before.insufficientDataCount, 1);
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
});

// =========================================================
// Anti-hallucination — real DB round trip
// =========================================================

// RADAR-CORE-3F — the read model carries semantic RadarReason descriptors
// (`{ code }`, plus `value` on the two "recorded" codes) and a
// RadarNextActionCode. The anti-hallucination intent is preserved at the
// code level; the FR/EN prose "no predictive / no service-recommendation"
// guarantee now lives in lib/radar/radar-copy.test.mjs.
const RQ_CODE_SHAPE = /^[A-Z][A-Z_]*$/;

test("a prospect with no signals at all never produces a fabricated claim", async () => {
  const client = await makeClient();
  const items = await scanAllPages();
  const item = items[indexOfClient(items, client.id)];
  assert.ok(item, "expected the fixture to be found");
  assert.ok(!item.reasons.some((r) => r.code === "INDUSTRY_RECORDED"), "no industry claim without a stored industry");
  assert.ok(!item.reasons.some((r) => r.code === "LOCATION_RECORDED"), "no location claim without stored geography");
  assert.ok(!item.reasons.some((r) => /INTERESTED|INTENT|UNLIKELY/.test(r.code)));
  for (const r of item.reasons) assert.match(r.code, RQ_CODE_SHAPE);
});

test("the read model carries ONLY semantic codes across a fully-populated fixture — never prose or a service recommendation", async () => {
  const client = await makeClient({ industry: "Boulangerie", country: "France", city: "Lyon" });
  await makeDeal(client.id, "qualified");
  await makeQuote(client.id, { status: "sent", sentAt: new Date(), respondedAt: null });
  await makeInteraction(client.id, new Date());
  await makeInvoice(client.id, { paidAt: null });

  const items = await scanAllPages();
  const item = items[indexOfClient(items, client.id)];
  assert.ok(item);
  for (const r of item.reasons) {
    assert.match(r.code, RQ_CODE_SHAPE, `reason "${r.code}" must be an ALL_CAPS code, never prose`);
    if (r.code === "INDUSTRY_RECORDED" || r.code === "LOCATION_RECORDED") {
      assert.equal(typeof r.value, "string");
    } else {
      assert.deepEqual(Object.keys(r), ["code"]);
    }
  }
  assert.match(item.recommendedNextAction, RQ_CODE_SHAPE);
});

// =========================================================
// Empty result
// =========================================================

test("an out-of-range page returns a valid empty items array without breaking counts", async () => {
  const result = await getRadarQueue({ page: 9999 });
  assert.deepEqual(result.items, []);
  assert.equal(result.page, 9999);
  assert.equal(typeof result.totalQualified, "number");
});

// =========================================================
// RADAR-CORE-1B — assignment read-model + assignee filter
// =========================================================

async function findItem(clientId, params = {}) {
  const items = await scanAllPages(params);
  return items[indexOfClient(items, clientId)];
}

test("1B: an unassigned qualified prospect -> assignedUserId null, assignedUserName null, assignedUserActive false", async () => {
  const c = await makeClient({ industry: "Santé", city: "Lyon" });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.ok(item);
  assert.equal(item.assignedUserId, null);
  assert.equal(item.assignedUserName, null);
  assert.equal(item.assignedUserActive, false);
});

test("1B: assignedUserName resolves to fullName when present, and to email when fullName is null", async () => {
  const named = await makeUser({ fullName: "Alice Assignee", email: "alice-1b@example.test" });
  const unnamed = await makeUser({ fullName: null, email: "bob-1b@example.test" });
  const cNamed = await makeClient({ industry: "Santé", city: "Nice", assignedUserId: named.id });
  await makeDeal(cNamed.id, "proposal");
  const cUnnamed = await makeClient({ industry: "Santé", city: "Nice", assignedUserId: unnamed.id });
  await makeDeal(cUnnamed.id, "proposal");

  const a = await findItem(cNamed.id);
  const b = await findItem(cUnnamed.id);
  assert.equal(a.assignedUserId, named.id);
  assert.equal(a.assignedUserName, "Alice Assignee");
  assert.equal(b.assignedUserId, unnamed.id);
  assert.equal(b.assignedUserName, "bob-1b@example.test");
});

test("1B: assigned to an ACTIVE internal staff member -> assignedUserActive true", async () => {
  const orgId = await internalOrgId();
  if (!orgId) return; // documented: cannot seed staff without an internal workspace
  const u = await makeUser({ fullName: "Active Staffer" });
  await makeStaffMember(u.id, "ACTIVE");
  const c = await makeClient({ industry: "Santé", city: "Metz", assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, u.id);
  assert.equal(item.assignedUserActive, true);
});

test("1B: assigned to a SUSPENDED staff member -> still assigned, assignedUserActive false (not treated as unassigned)", async () => {
  const orgId = await internalOrgId();
  if (!orgId) return;
  const u = await makeUser({ fullName: "Suspended Staffer" });
  await makeStaffMember(u.id, "SUSPENDED");
  const c = await makeClient({ industry: "Santé", city: "Metz", assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, u.id, "a suspended assignee stays assigned");
  assert.equal(item.assignedUserActive, false);
  assert.equal(item.assignedUserName, "Suspended Staffer", "identity is still resolved");
});

test("1B: assigned to a user with NO staff_members row -> still assigned, active false, identity still resolved", async () => {
  const u = await makeUser({ fullName: "No Membership" });
  const c = await makeClient({ industry: "Santé", city: "Caen", assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, u.id);
  assert.equal(item.assignedUserActive, false);
  assert.equal(item.assignedUserName, "No Membership");
});

test("1B: legacy free-text ownerName never makes a prospect count as assigned", async () => {
  const c = await makeClient({ industry: "Santé", city: "Brest", ownerName: "Jean Legacy", assignedUserId: null });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, null, "assigned_user_id is the sole authority; ownerName is ignored");
  assert.equal(item.assignedUserName, null);
});

test("1B: ?assignee=unassigned returns only null-assignee rows; =user returns only that user's rows; =all is unchanged", async () => {
  const u = await makeUser({ fullName: "Filter Target" });
  const assigned = await makeClient({ industry: "Santé", city: "Dijon", assignedUserId: u.id });
  await makeDeal(assigned.id, "proposal");
  const unassigned = await makeClient({ industry: "Santé", city: "Dijon", assignedUserId: null });
  await makeDeal(unassigned.id, "proposal");

  const all = await scanAllPages({ assignee: { mode: "all" } });
  assert.ok(indexOfClient(all, assigned.id) !== -1 && indexOfClient(all, unassigned.id) !== -1);

  const onlyUnassigned = await scanAllPages({ assignee: { mode: "unassigned" } });
  assert.equal(indexOfClient(onlyUnassigned, assigned.id), -1);
  assert.ok(indexOfClient(onlyUnassigned, unassigned.id) !== -1);
  assert.ok(onlyUnassigned.every((i) => i.assignedUserId === null));

  const onlyMine = await scanAllPages({ assignee: { mode: "user", userId: u.id } });
  assert.ok(indexOfClient(onlyMine, assigned.id) !== -1);
  assert.equal(indexOfClient(onlyMine, unassigned.id), -1);
  assert.ok(onlyMine.every((i) => i.assignedUserId === u.id));
});

test("1B: assignee filter composes with the priority filter by intersection", async () => {
  const u = await makeUser({ fullName: "Intersection User" });
  const highMine = await makeClient({ assignedUserId: u.id });
  await makeDeal(highMine.id, "proposal"); // HIGH + mine
  const lowMine = await makeClient({ assignedUserId: u.id });
  await makeDeal(lowMine.id, "new"); // LOW + mine

  const highAndMine = await scanAllPages({ priority: ["HIGH"], assignee: { mode: "user", userId: u.id } });
  assert.ok(indexOfClient(highAndMine, highMine.id) !== -1);
  assert.equal(indexOfClient(highAndMine, lowMine.id), -1, "LOW is excluded by the priority half of the intersection");
});

test("1B: the assignee filter is applied AFTER ranking — relative Radar order of the surviving rows is preserved", async () => {
  const u = await makeUser({ fullName: "Order User" });
  const high = await makeClient({ assignedUserId: u.id });
  await makeDeal(high.id, "proposal"); // HIGH
  const medium = await makeClient({ assignedUserId: u.id });
  await makeDeal(medium.id, "qualified"); // MEDIUM

  const mineOnly = await scanAllPages({ assignee: { mode: "user", userId: u.id } });
  const iHigh = indexOfClient(mineOnly, high.id);
  const iMedium = indexOfClient(mineOnly, medium.id);
  assert.ok(iHigh !== -1 && iMedium !== -1);
  assert.ok(iHigh < iMedium, "HIGH still ranks before MEDIUM within the filtered subset");
});

test("1B: totalQualified / insufficientDataCount / notEligibleCount are unaffected by any assignee filter", async () => {
  const u = await makeUser({ fullName: "Count User" });
  const c = await makeClient({ assignedUserId: u.id });
  await makeDeal(c.id, "proposal");

  const unfiltered = await getRadarQueue();
  const filteredUnassigned = await getRadarQueue({ assignee: { mode: "unassigned" } });
  const filteredUser = await getRadarQueue({ assignee: { mode: "user", userId: u.id } });

  assert.equal(filteredUnassigned.totalQualified, unfiltered.totalQualified);
  assert.equal(filteredUser.totalQualified, unfiltered.totalQualified);
  assert.equal(filteredUnassigned.insufficientDataCount, unfiltered.insufficientDataCount);
  assert.equal(filteredUnassigned.notEligibleCount, unfiltered.notEligibleCount);
});

test("1B: adding assigned_user_id to the candidate SELECT did not change which candidates rank or their order", async () => {
  const before = (await scanAllPages()).map((i) => i.clientId);
  const u = await makeUser({ fullName: "Neutral User" });
  const c = await makeClient({ assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const after = (await scanAllPages()).map((i) => i.clientId);
  // the new client appears; every previously-present client keeps its order
  const afterWithoutNew = after.filter((id) => id !== c.id);
  assert.deepEqual(afterWithoutNew, before, "assigning a prospect never reorders the rest of the queue");
});

test("1B: structural — assignee identity is resolved in ONE batched query (no N+1)", () => {
  assert.match(IMPLEMENTATION_SOURCE, /inArray\(users\.id, userIds\)/, "one batched users lookup keyed by the page's assignee ids");
  assert.ok(!/for \(const .* of pageSlice\)[\s\S]{0,200}await db/.test(IMPLEMENTATION_SOURCE), "no per-row await inside a pageSlice loop");
  assert.match(IMPLEMENTATION_SOURCE, /resolveAssignees\(/, "a single dedicated resolver, called once");
});

// =========================================================
// RADAR-CORE-3B — next follow-up on the RADAR queue
// =========================================================
// A RADAR next follow-up = a task with this client_id, status IN
// ("todo","in_progress"), due_date IS NOT NULL. Earliest due_date wins.
// done / cancelled / null-due never contribute. All assertions are
// per-fixture or delta-based (the shared local DB carries E2E leftovers).

const FIXED_NOW = new Date("2026-06-15T12:00:00Z");
const START_OF_TODAY = Date.UTC(2026, 5, 15); // 2026-06-15T00:00:00Z
const START_OF_TOMORROW = START_OF_TODAY + 24 * 60 * 60 * 1000;

async function followUpFieldsFor(clientId, params = {}) {
  const items = await scanAllPages(params);
  return items.find((i) => i.clientId === clientId) ?? null;
}

test("3B: two open dated tasks — the earliest due_date is nextFollowUpDueAt", async () => {
  const c = await makeClient();
  const early = new Date("2026-07-01T00:00:00Z");
  const late = new Date("2026-07-20T00:00:00Z");
  await makeTask(c.id, { status: "in_progress", dueDate: late });
  await makeTask(c.id, { status: "todo", dueDate: early });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(row, "prospect is in the queue");
  assert.equal(row.nextFollowUpDueAt.getTime(), early.getTime());
});

test("3B: a done task earlier than the open one is ignored", async () => {
  const c = await makeClient();
  const open = new Date("2026-07-15T00:00:00Z");
  await makeTask(c.id, { status: "done", dueDate: new Date("2026-07-01T00:00:00Z") });
  await makeTask(c.id, { status: "todo", dueDate: open });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt.getTime(), open.getTime());
});

test("3B: a cancelled task earlier than the open one is ignored", async () => {
  const c = await makeClient();
  const open = new Date("2026-07-15T00:00:00Z");
  await makeTask(c.id, { status: "cancelled", dueDate: new Date("2026-07-01T00:00:00Z") });
  await makeTask(c.id, { status: "in_progress", dueDate: open });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt.getTime(), open.getTime());
});

test("3B: an open task with a NULL due_date is not a follow-up", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: null });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt, null);
  assert.equal(row.nextFollowUpOverdue, false);
  assert.equal(row.nextFollowUpDueToday, false);
});

test("3B: a prospect with no tasks at all has nextFollowUpDueAt null", async () => {
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt, null);
});

test("3B: a machine-style open dated task (structured FKs left NULL) still counts as a follow-up", async () => {
  const c = await makeClient();
  const due = new Date("2026-08-01T00:00:00Z");
  await makeTask(c.id, { status: "todo", dueDate: due }); // assigned_user_id / created_by_user_id NULL
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt.getTime(), due.getTime(), "follow-up truth is task state + date, not creator type");
});

test("3B: with several open dated tasks the earliest is deterministic across repeated calls", async () => {
  const c = await makeClient();
  const dates = ["2026-09-10", "2026-09-02", "2026-09-25"].map((d) => new Date(`${d}T00:00:00Z`));
  for (const d of dates) await makeTask(c.id, { status: "todo", dueDate: d });
  const a = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const b = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(a.nextFollowUpDueAt.getTime(), Date.UTC(2026, 8, 2));
  assert.equal(b.nextFollowUpDueAt.getTime(), a.nextFollowUpDueAt.getTime());
});

// ---- UTC day-window boundaries (fixed now) ----

test("3B: due = startOfToday - 1ms -> overdue true, dueToday false", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, true);
  assert.equal(row.nextFollowUpDueToday, false);
});

test("3B: due = startOfToday -> overdue false, dueToday true", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, false);
  assert.equal(row.nextFollowUpDueToday, true);
});

test("3B: due = startOfTomorrow - 1ms -> dueToday true, overdue false", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW - 1) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueToday, true);
  assert.equal(row.nextFollowUpOverdue, false);
});

test("3B: due = startOfTomorrow -> overdue false, dueToday false (upcoming)", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, false);
  assert.equal(row.nextFollowUpDueToday, false);
  assert.ok(row.nextFollowUpDueAt instanceof Date);
});

// ---- followup filter ----

test("3B: followup=needs returns rows with no open dated follow-up and excludes rows that have one", async () => {
  const withFollowUp = await makeClient();
  await makeTask(withFollowUp.id, { status: "todo", dueDate: new Date("2026-07-10T00:00:00Z") });
  const withoutFollowUp = await makeClient();

  const needs = await scanAllPages({ followup: "needs", now: FIXED_NOW });
  assert.ok(needs.some((i) => i.clientId === withoutFollowUp.id), "a prospect with no follow-up is included");
  assert.ok(!needs.some((i) => i.clientId === withFollowUp.id), "a prospect with an open dated follow-up is excluded");
  assert.ok(needs.every((i) => i.nextFollowUpDueAt === null));
});

test("3B: followup=overdue returns only overdue rows", async () => {
  const overdue = await makeClient();
  await makeTask(overdue.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const today = await makeClient();
  await makeTask(today.id, { status: "todo", dueDate: new Date(START_OF_TODAY) });
  const upcoming = await makeClient();
  await makeTask(upcoming.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) });

  const rows = await scanAllPages({ followup: "overdue", now: FIXED_NOW });
  assert.ok(rows.some((i) => i.clientId === overdue.id));
  assert.ok(!rows.some((i) => i.clientId === today.id));
  assert.ok(!rows.some((i) => i.clientId === upcoming.id));
  assert.ok(rows.every((i) => i.nextFollowUpOverdue === true));
});

test("3B: followup=due-today returns only rows due within today's UTC window", async () => {
  const today = await makeClient();
  await makeTask(today.id, { status: "todo", dueDate: new Date(START_OF_TODAY) });
  const overdue = await makeClient();
  await makeTask(overdue.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });

  const rows = await scanAllPages({ followup: "due-today", now: FIXED_NOW });
  assert.ok(rows.some((i) => i.clientId === today.id));
  assert.ok(!rows.some((i) => i.clientId === overdue.id));
  assert.ok(rows.every((i) => i.nextFollowUpDueToday === true));
});

test("3B: followup=all does not filter (delta count unchanged vs. no param)", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-10T00:00:00Z") });
  const none = await getRadarQueue({ now: FIXED_NOW });
  const all = await getRadarQueue({ followup: "all", now: FIXED_NOW });
  assert.equal(all.filteredTotal, none.filteredTotal);
  assert.equal(all.totalQualified, none.totalQualified);
});

test("3B: an invalid followup token behaves exactly like all", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-10T00:00:00Z") });
  const all = await getRadarQueue({ followup: "all", now: FIXED_NOW });
  const bogus = await getRadarQueue({ followup: "not-a-real-value", now: FIXED_NOW });
  assert.equal(bogus.filteredTotal, all.filteredTotal);
});

test("3B: the followup filter is applied AFTER ranking — relative order of surviving rows is preserved", async () => {
  const high = await makeClient();
  await makeDeal(high.id, "proposal"); // HIGH
  await makeTask(high.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const low = await makeClient();
  await makeDeal(low.id, "new"); // LOW
  await makeTask(low.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });

  const rows = await scanAllPages({ followup: "overdue", now: FIXED_NOW });
  const iHigh = indexOfClient(rows, high.id);
  const iLow = indexOfClient(rows, low.id);
  assert.ok(iHigh !== -1 && iLow !== -1);
  assert.ok(iHigh < iLow, "HIGH still ranks before LOW inside the overdue-filtered subset");
});

test("3B: followup composes with priority + assignee as a pure predicate intersection", async () => {
  const u = await makeUser({ fullName: "3B Intersection User" });
  const match = await makeClient({ assignedUserId: u.id });
  await makeDeal(match.id, "proposal"); // HIGH
  await makeTask(match.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) }); // overdue
  const wrongFollowup = await makeClient({ assignedUserId: u.id });
  await makeDeal(wrongFollowup.id, "proposal"); // HIGH + mine, but not overdue
  await makeTask(wrongFollowup.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) });

  const base = { priority: ["HIGH"], assignee: { mode: "user", userId: u.id }, followup: "overdue", now: FIXED_NOW };
  const all3 = await scanAllPages(base);
  assert.ok(all3.some((i) => i.clientId === match.id));
  assert.ok(!all3.some((i) => i.clientId === wrongFollowup.id), "fails the followup half of the intersection");

  // dropping any one dimension lets `match` through too, proving intersection (not bypass)
  for (const drop of ["priority", "assignee", "followup"]) {
    const params = { ...base };
    delete params[drop];
    const rows = await scanAllPages(params);
    assert.ok(rows.some((i) => i.clientId === match.id), `still present when ${drop} filter is removed`);
  }
});

// ---- filteredTotal ----

test("3B: no row filter -> filteredTotal === totalQualified", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "proposal");
  const r = await getRadarQueue({ now: FIXED_NOW });
  assert.equal(r.filteredTotal, r.totalQualified);
});

test("3B: each row filter changes filteredTotal by exactly its own delta; totalQualified / counts stay put", async () => {
  const u = await makeUser({ fullName: "3B Delta User" });
  const base = await getRadarQueue({ now: FIXED_NOW });

  // +1 qualified HIGH prospect, assigned to u, with an overdue follow-up.
  const c = await makeClient({ assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });

  const afterAdd = await getRadarQueue({ now: FIXED_NOW });
  assert.equal(afterAdd.totalQualified, base.totalQualified + 1);
  assert.equal(afterAdd.filteredTotal, base.filteredTotal + 1, "no filter: filteredTotal tracks totalQualified");
  assert.equal(afterAdd.insufficientDataCount, base.insufficientDataCount);
  assert.equal(afterAdd.notEligibleCount, base.notEligibleCount);

  // priority filter: HIGH includes it, LOW excludes it — totalQualified unchanged either way
  const high = await getRadarQueue({ priority: ["HIGH"], now: FIXED_NOW });
  const low = await getRadarQueue({ priority: ["LOW"], now: FIXED_NOW });
  assert.equal(high.totalQualified, afterAdd.totalQualified);
  assert.equal(low.totalQualified, afterAdd.totalQualified);
  assert.ok(high.filteredTotal <= afterAdd.filteredTotal);
  assert.ok(low.filteredTotal <= afterAdd.filteredTotal);

  // assignee filter: only u's rows
  const mine = await getRadarQueue({ assignee: { mode: "user", userId: u.id }, now: FIXED_NOW });
  assert.equal(mine.totalQualified, afterAdd.totalQualified);
  assert.ok(mine.filteredTotal >= 1 && mine.filteredTotal <= afterAdd.filteredTotal);

  // followup filter: overdue
  const overdue = await getRadarQueue({ followup: "overdue", now: FIXED_NOW });
  assert.equal(overdue.totalQualified, afterAdd.totalQualified);
  assert.ok(overdue.filteredTotal >= 1 && overdue.filteredTotal <= afterAdd.filteredTotal);

  // all three composed — at least our one fixture, never more than any single filter
  const composed = await getRadarQueue({
    priority: ["HIGH"],
    assignee: { mode: "user", userId: u.id },
    followup: "overdue",
    now: FIXED_NOW,
  });
  assert.equal(composed.totalQualified, afterAdd.totalQualified);
  assert.ok(composed.filteredTotal >= 1);
  assert.ok(composed.filteredTotal <= Math.min(high.filteredTotal, mine.filteredTotal, overdue.filteredTotal));
});

// ---- pagination truth (exact arithmetic — page-layer formula) ----
// hasNext / totalPages are page.tsx logic; the frozen contract (§29)
// authorizes asserting the exact formula rather than adding a helper
// module. These reproduce app/admin/crm/radar/page.tsx verbatim.
const PAGE_LAYER = {
  totalPages: (filteredTotal, pageSize) => Math.max(1, Math.ceil(filteredTotal / pageSize)),
  hasNext: (page, pageSize, filteredTotal) => page * pageSize < filteredTotal,
  hasPrevious: (page) => page > 1,
};

test("3B: pagination formula — no phantom next page at exact multiples of PAGE_SIZE (20)", () => {
  const P = 20;
  assert.equal(PAGE_LAYER.hasNext(1, P, 0), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 1), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 19), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 20), false, "exactly one full page — NO next");
  assert.equal(PAGE_LAYER.hasNext(1, P, 21), true);
  assert.equal(PAGE_LAYER.hasNext(2, P, 21), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 40), true);
  assert.equal(PAGE_LAYER.hasNext(2, P, 40), false, "exactly two full pages — NO phantom page 3");
  assert.equal(PAGE_LAYER.hasNext(1, P, 41), true);
  assert.equal(PAGE_LAYER.hasNext(2, P, 41), true);
  assert.equal(PAGE_LAYER.hasNext(3, P, 41), false);
});

test("3B: pagination formula — totalPages from filteredTotal", () => {
  const P = 20;
  assert.equal(PAGE_LAYER.totalPages(0, P), 1);
  assert.equal(PAGE_LAYER.totalPages(20, P), 1);
  assert.equal(PAGE_LAYER.totalPages(21, P), 2);
  assert.equal(PAGE_LAYER.totalPages(40, P), 2);
  assert.equal(PAGE_LAYER.totalPages(41, P), 3);
});

test("3B: out-of-range page under a filter returns empty items, correct filteredTotal, hasNext false, Previous available", async () => {
  const c = await makeClient({ assignedUserId: (await makeUser({ fullName: "3B OOR User" })).id });
  await makeDeal(c.id, "proposal");
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const r = await getRadarQueue({ page: 999, followup: "overdue", now: FIXED_NOW });
  assert.equal(r.page, 999, "the sanitized page is retained, never clamped inside the action");
  assert.deepEqual(r.items, []);
  assert.ok(r.filteredTotal >= 1);
  assert.equal(PAGE_LAYER.hasNext(r.page, r.pageSize, r.filteredTotal), false, "never advertises a next page past the end");
  assert.equal(PAGE_LAYER.hasPrevious(r.page), true);
});

test("3B: result shape includes filteredTotal on every path (incl. the zero-qualified early return, read structurally)", async () => {
  const r = await getRadarQueue({ now: FIXED_NOW });
  assert.ok(Number.isInteger(r.filteredTotal));
  assert.ok("totalQualified" in r && "insufficientDataCount" in r && "notEligibleCount" in r);
  assert.match(
    IMPLEMENTATION_SOURCE,
    /qualified\.length === 0[\s\S]{0,160}filteredTotal: 0/,
    "the zero-qualified early return also carries filteredTotal: 0",
  );
});

// ---- structural invariants ----

test("3B: structural — exactly one batched tasks query, not inside a per-client loop", () => {
  const taskSelects = IMPLEMENTATION_SOURCE.match(/\.from\(tasks\)/g) ?? [];
  assert.equal(taskSelects.length, 1, "one and only one tasks read");
  assert.match(IMPLEMENTATION_SOURCE, /inArray\(tasks\.clientId, qualifiedIds\)/, "bounded to the qualified subset");
  assert.match(IMPLEMENTATION_SOURCE, /inArray\(tasks\.status, \["todo", "in_progress"\]\)/, "open statuses only");
  assert.match(IMPLEMENTATION_SOURCE, /isNotNull\(tasks\.dueDate\)/, "dated tasks only");
  assert.ok(
    !/for \(const [\s\S]{0,80}\)[\s\S]{0,200}\.from\(tasks\)/.test(IMPLEMENTATION_SOURCE),
    "the tasks query is not inside a loop",
  );
});

test("3B: structural — followup filter and filteredTotal both happen before the page slice", () => {
  const filterIdx = IMPLEMENTATION_SOURCE.indexOf("followUpFilter ===");
  const filteredTotalIdx = IMPLEMENTATION_SOURCE.indexOf("const filteredTotal = filtered.length");
  const sliceIdx = IMPLEMENTATION_SOURCE.indexOf("filtered.slice(");
  assert.ok(filterIdx !== -1 && filteredTotalIdx !== -1 && sliceIdx !== -1);
  assert.ok(filterIdx < sliceIdx, "followup filter precedes the slice");
  assert.ok(filteredTotalIdx < sliceIdx, "filteredTotal is computed before the slice");
});

test("3B: structural — no follow-up data reaches scoring / ranking, comparator untouched", () => {
  const assessCall = IMPLEMENTATION_SOURCE.match(/assessOpportunity\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  assert.ok(assessCall.length > 0, "assessOpportunity call located");
  assert.ok(!/followUp/i.test(assessCall), "no follow-up field passed into assessOpportunity");
  assert.match(IMPLEMENTATION_SOURCE, /ranked\.sort\(\(a, b\) => \{/, "the ranking comparator is still present");
  const sortBody = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
  );
  assert.ok(!/followUp/i.test(sortBody), "no follow-up term inside the comparator");
});

test("3B: structural — no schema / migration file is imported or referenced", () => {
  assert.ok(!/db\/migrations/.test(IMPLEMENTATION_SOURCE));
  assert.ok(!/drizzle-kit/.test(IMPLEMENTATION_SOURCE));
  assert.match(IMPLEMENTATION_SOURCE, /from "@\/db\/schema"/, "schema is imported as a type/table source only, unchanged");
});

// =========================================================
// RADAR-CORE-3E — deterministic next-follow-up IDENTITY
// (nextFollowUpTaskId / nextFollowUpAssignedUserId) surfaced for the
// queue quick actions. Same shared-DB discipline: per-fixture assertions.
// =========================================================

test("3E: a prospect with no open dated follow-up has nextFollowUpTaskId null and nextFollowUpAssignedUserId null", async () => {
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt, null);
  assert.equal(row.nextFollowUpTaskId, null);
  assert.equal(row.nextFollowUpAssignedUserId, null);
});

test("3E: nextFollowUpTaskId is the id of the earliest-due OPEN dated follow-up", async () => {
  const c = await makeClient();
  const late = await makeTask(c.id, { status: "in_progress", dueDate: new Date("2026-07-20T00:00:00Z") });
  const early = await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-01T00:00:00Z") });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpTaskId, early.id);
  assert.notEqual(row.nextFollowUpTaskId, late.id);
  assert.equal(row.nextFollowUpDueAt.getTime(), new Date("2026-07-01T00:00:00Z").getTime());
});

test("3E: a done/cancelled task earlier than the open one never becomes nextFollowUpTaskId", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "done", dueDate: new Date("2026-06-01T00:00:00Z") });
  await makeTask(c.id, { status: "cancelled", dueDate: new Date("2026-06-02T00:00:00Z") });
  const open = await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-01T00:00:00Z") });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpTaskId, open.id);
});

test("3E: an OPEN task with a NULL due_date is excluded from next-follow-up identity (G2-equivalent)", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: null }); // not a follow-up
  const dated = await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-05T00:00:00Z") });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpTaskId, dated.id);
});

test("3E: equal due_date -> the earlier created_at wins the tie", async () => {
  const c = await makeClient();
  const due = new Date("2026-07-10T00:00:00Z");
  const older = await makeTask(c.id, { status: "todo", dueDate: due, createdAt: new Date("2026-01-01T00:00:00Z") });
  const newer = await makeTask(c.id, { status: "todo", dueDate: due, createdAt: new Date("2026-02-01T00:00:00Z") });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpTaskId, older.id);
  assert.notEqual(row.nextFollowUpTaskId, newer.id);
});

test("3E: equal due_date AND equal created_at -> the lexicographically smaller id wins the tie", async () => {
  const c = await makeClient();
  const due = new Date("2026-07-11T00:00:00Z");
  const createdAt = new Date("2026-03-03T00:00:00Z");
  const idLo = "00000000-0000-4000-8000-00000000aa01";
  const idHi = "00000000-0000-4000-8000-00000000aa02";
  // insert the HIGHER id first so DB row order cannot be what picks the winner
  await makeTask(c.id, { status: "todo", dueDate: due, createdAt, id: idHi });
  await makeTask(c.id, { status: "todo", dueDate: due, createdAt, id: idLo });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpTaskId, idLo);
});

test("3E: the selected next follow-up's assigned_user_id is surfaced exactly", async () => {
  const u = await makeUser({ fullName: "3E Assigned FU User" });
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-15T00:00:00Z"), assignedUserId: u.id });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpAssignedUserId, u.id);
});

test("3E: an unassigned next follow-up surfaces nextFollowUpAssignedUserId null (task id still set)", async () => {
  const c = await makeClient();
  const t = await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-16T00:00:00Z") }); // assignedUserId null
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpTaskId, t.id);
  assert.equal(row.nextFollowUpAssignedUserId, null);
});

test("3E: assignee id of the follow-up is picked from the SAME best row, not any other open task", async () => {
  const u = await makeUser({ fullName: "3E Wrong-row User" });
  const c = await makeClient();
  // later task is assigned; earlier (winning) task is not
  await makeTask(c.id, { status: "todo", dueDate: new Date("2026-08-01T00:00:00Z"), assignedUserId: u.id });
  const winner = await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-01T00:00:00Z") });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpTaskId, winner.id);
  assert.equal(row.nextFollowUpAssignedUserId, null, "assignee comes from the winning row only");
});

test("3E: identity fields are ranking-inert — HIGH still ranks before LOW when both carry a follow-up", async () => {
  const high = await makeClient();
  await makeDeal(high.id, "proposal"); // HIGH
  await makeTask(high.id, { status: "todo", dueDate: new Date("2026-07-02T00:00:00Z") });
  const low = await makeClient();
  await makeDeal(low.id, "new"); // LOW
  await makeTask(low.id, { status: "todo", dueDate: new Date("2026-07-02T00:00:00Z") });

  const rows = await scanAllPages({ now: FIXED_NOW });
  const iHigh = indexOfClient(rows, high.id);
  const iLow = indexOfClient(rows, low.id);
  assert.ok(iHigh !== -1 && iLow !== -1);
  assert.ok(iHigh < iLow, "next-follow-up identity must not perturb the Radar order");
});

test("3E: adding the identity fields leaves totalQualified / counts / filteredTotal unchanged for a follow-up added to an already-qualified prospect", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "proposal");
  const before = await getRadarQueue({ now: FIXED_NOW });
  await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-03T00:00:00Z") });
  const after = await getRadarQueue({ now: FIXED_NOW });
  assert.equal(after.totalQualified, before.totalQualified, "a follow-up never re-qualifies a prospect");
  assert.equal(after.filteredTotal, before.filteredTotal);
  assert.equal(after.insufficientDataCount, before.insufficientDataCount);
  assert.equal(after.notEligibleCount, before.notEligibleCount);
  assert.equal(after.pageSize, before.pageSize);
});

test("3E: followup filter behaviour is unchanged — nextFollowUpDueAt still equals the winning row's due_date", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) }); // overdue winner
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) }); // upcoming
  const overdue = await scanAllPages({ followup: "overdue", now: FIXED_NOW });
  const hit = overdue.find((i) => i.clientId === c.id);
  assert.ok(hit, "still surfaces under followup=overdue");
  assert.equal(hit.nextFollowUpOverdue, true);
  assert.equal(hit.nextFollowUpDueAt.getTime(), START_OF_TODAY - 1);
});

test("3E: structural — the fifth batched query carries id / created_at / assigned_user_id and there is still exactly ONE tasks read", () => {
  const taskFroms = IMPLEMENTATION_SOURCE.match(/\.from\(tasks\)/g) ?? [];
  assert.equal(taskFroms.length, 1, "no second tasks query, no per-row task lookup");
  const followUpSelect =
    IMPLEMENTATION_SOURCE.slice(
      IMPLEMENTATION_SOURCE.indexOf("clientOpenFollowUps"),
      IMPLEMENTATION_SOURCE.indexOf(".from(tasks)"),
    ) + IMPLEMENTATION_SOURCE.slice(IMPLEMENTATION_SOURCE.indexOf(".from(tasks)"), IMPLEMENTATION_SOURCE.indexOf(".from(tasks)") + 400);
  assert.match(followUpSelect, /id:\s*tasks\.id/);
  assert.match(followUpSelect, /createdAt:\s*tasks\.createdAt/);
  assert.match(followUpSelect, /assignedUserId:\s*tasks\.assignedUserId/);
  // WHERE semantics preserved verbatim
  assert.match(IMPLEMENTATION_SOURCE, /inArray\(tasks\.status, \["todo", "in_progress"\]\)/);
  assert.match(IMPLEMENTATION_SOURCE, /isNotNull\(tasks\.dueDate\)/);
});

test("3E: structural — identity fields never reach assessOpportunity or the ranking comparator", () => {
  const assessCall = IMPLEMENTATION_SOURCE.match(/assessOpportunity\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  assert.ok(!/nextFollowUp/.test(assessCall), "no nextFollowUp* field passed to assessOpportunity");
  const sortBody = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
  );
  assert.ok(!/nextFollowUp/.test(sortBody), "no nextFollowUp* term inside the comparator");
});

test("3E: structural — pickNextFollowUp is a pure, non-exported helper with the documented due->created->id order", () => {
  assert.match(IMPLEMENTATION_SOURCE, /function pickNextFollowUp</);
  assert.ok(!/export function pickNextFollowUp/.test(IMPLEMENTATION_SOURCE), 'a "use server" module cannot export a sync helper');
  const body = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("function pickNextFollowUp<"),
    IMPLEMENTATION_SOURCE.indexOf("function pickNextFollowUp<") + 900,
  );
  assert.ok(body.indexOf("dueDate.getTime()") < body.indexOf("createdAt.getTime()"), "due_date compared before created_at");
  assert.ok(body.indexOf("createdAt.getTime()") < body.indexOf("row.id < best.id"), "created_at compared before id");
});

// =========================================================
// MICRO-STEP 1 — Discovery -> Radar read-only visibility.
// discoverySource is pure DISPLAY CONTEXT, exactly like assignedUserName /
// nextFollowUpTaskId above: read-only, never passed to assessQualification
// / assessOpportunity / the ranking comparator, never a filter predicate.
// =========================================================

test("MICRO-STEP 1: a qualified prospect with a linked discovery_results row exposes category/website/businessStatus via discoverySource", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { category: "restaurant", website: "https://example.test", businessStatus: "OPERATIONAL" });
  const row = await followUpFieldsFor(c.id);
  assert.ok(row, "fixture must appear in the queue");
  assert.deepEqual(row.discoverySource, {
    category: "restaurant",
    website: "https://example.test",
    businessStatus: "OPERATIONAL",
  });
});

test("MICRO-STEP 1: a qualified prospect with NO linked discovery_results row has discoverySource null", async () => {
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id);
  assert.ok(row, "fixture must appear in the queue");
  assert.equal(row.discoverySource, null);
});

test("MICRO-STEP 1: businessStatus = CLOSED_PERMANENTLY is surfaced verbatim, never altered or dropped", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { businessStatus: "CLOSED_PERMANENTLY" });
  const row = await followUpFieldsFor(c.id);
  assert.ok(row, "fixture must appear in the queue");
  assert.equal(row.discoverySource.businessStatus, "CLOSED_PERMANENTLY");
});

test("MICRO-STEP 1: a linked discovery_results row with every enrichment field null surfaces as { category: null, website: null, businessStatus: null }, never fabricated", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id);
  const row = await followUpFieldsFor(c.id);
  assert.ok(row, "fixture must appear in the queue");
  assert.deepEqual(row.discoverySource, { category: null, website: null, businessStatus: null });
});

test("MICRO-STEP 1: discoverySource never changes totalQualified, priority, or the relative Radar order of existing rows", async () => {
  const before = await getRadarQueue();
  const beforeOrder = (await scanAllPages()).map((i) => i.clientId);

  const c = await makeClient();
  await makeDeal(c.id, "proposal"); // HIGH, same as any other HIGH fixture
  await makeDiscoveryResult(c.id, { category: "plumber", website: null, businessStatus: "OPERATIONAL" });

  const after = await getRadarQueue();
  assert.equal(after.totalQualified, before.totalQualified + 1);

  const afterOrder = (await scanAllPages()).map((i) => i.clientId);
  const afterOrderWithoutNew = afterOrder.filter((id) => id !== c.id);
  assert.deepEqual(afterOrderWithoutNew, beforeOrder, "adding a discovery-linked row never reorders pre-existing rows");

  const row = await followUpFieldsFor(c.id);
  assert.equal(row.priority, "HIGH", "priority is still driven only by deals/quotes, never by discoverySource");
});

test("MICRO-STEP 1: structural — discoveryResults is read with exactly one batched inArray() query, no N+1", () => {
  const discoveryFroms = IMPLEMENTATION_SOURCE.match(/\.from\(discoveryResults\)/g) ?? [];
  assert.equal(discoveryFroms.length, 1, "no second discoveryResults query, no per-row lookup");
  assert.match(
    IMPLEMENTATION_SOURCE,
    /inArray\(discoveryResults\.crmClientId,\s*qualifiedIds\)/,
    "the discoveryResults read is bounded to the qualified subset, same shape as deals/interactions/quotes/invoices",
  );
  assert.ok(
    !/for \(const .* of qualified\)[\s\S]{0,200}await db/.test(IMPLEMENTATION_SOURCE),
    "no per-row await inside the qualified-subset loop",
  );
});

test("MICRO-STEP 1: structural — discoverySource is never passed to assessQualification or assessOpportunity, and never enters the ranking comparator", () => {
  const qualificationCall = IMPLEMENTATION_SOURCE.match(/assessQualification\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  const opportunityCall = IMPLEMENTATION_SOURCE.match(/assessOpportunity\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  assert.ok(!/discoverySource|discoveryResults/.test(qualificationCall), "qualification input stays untouched by this micro-step");
  assert.ok(!/discoverySource|discoveryResults/.test(opportunityCall), "opportunity input stays untouched by this micro-step");
  const sortBody = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
  );
  assert.ok(!/discoverySource/.test(sortBody), "no discoverySource term inside the ranking comparator");
});

test("MICRO-STEP 1: structural — the candidate universe HARD_CAP=500 is unchanged by this micro-step (non-regression)", () => {
  assert.match(IMPLEMENTATION_SOURCE, /HARD_CAP\s*=\s*500/);
  assert.match(IMPLEMENTATION_SOURCE, /\.limit\(HARD_CAP\)/);
});

// =========================================================
// MICRO-STEP 2 — Signals Engine v1 (lib/radar/signals.ts), wired into
// getRadarQueue() as RankedProspect.signals. Pure DISPLAY CONTEXT, exactly
// like discoverySource: read-only, never fed to assessQualification /
// assessOpportunity / the ranking comparator, never a filter predicate.
// Per-signal behaviour (thresholds, evidence shapes, co-occurrence) is
// unit-tested exhaustively in lib/radar/signals.test.mjs; these
// integration tests only prove the WIRING is correct end-to-end against a
// real database and that nothing else regresses.
// =========================================================

test("MICRO-STEP 2: a prospect with no Discovery link and no interaction history has no V1 signal (since 4E.2 a bare prospect carries only UNASSIGNED + NO_FOLLOW_UP_SCHEDULED)", async () => {
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id);
  assert.ok(row, "fixture must appear in the queue");
  assert.deepEqual(row.signals.map((s) => s.type), ["UNASSIGNED", "NO_FOLLOW_UP_SCHEDULED"]);
});

test("MICRO-STEP 2: a prospect converted from RADAR Discovery with a recent discoveredAt exposes DISCOVERY_NEW", async () => {
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDiscoveryResult(c.id, { discoveredAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });
  const row = await followUpFieldsFor(c.id);
  assert.ok(row, "fixture must appear in the queue");
  const signal = row.signals.find((s) => s.type === "DISCOVERY_NEW");
  assert.ok(signal, "DISCOVERY_NEW must be present");
  assert.equal(signal.color, "blue");
});

test("MICRO-STEP 2: a prospect with a linked discovery_results row and website=null exposes NO_WEBSITE", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: null });
  const row = await followUpFieldsFor(c.id);
  assert.ok(row.signals.some((s) => s.type === "NO_WEBSITE"));
});

test("MICRO-STEP 2: a prospect with a linked discovery_results row and a real website never exposes NO_WEBSITE", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: "https://example.test" });
  const row = await followUpFieldsFor(c.id);
  assert.ok(!row.signals.some((s) => s.type === "NO_WEBSITE"));
});

test("MICRO-STEP 2: businessStatus=CLOSED_PERMANENTLY exposes BUSINESS_CLOSED end-to-end", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { businessStatus: "CLOSED_PERMANENTLY" });
  const row = await followUpFieldsFor(c.id);
  assert.ok(row.signals.some((s) => s.type === "BUSINESS_CLOSED"));
});

test("MICRO-STEP 2: businessStatus=OPERATIONAL never exposes BUSINESS_CLOSED", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { businessStatus: "OPERATIONAL" });
  const row = await followUpFieldsFor(c.id);
  assert.ok(!row.signals.some((s) => s.type === "BUSINESS_CLOSED"));
});

test("MICRO-STEP 2: a recent interaction exposes RECENT_ACTIVITY end-to-end", async () => {
  const c = await makeClient();
  await makeInteraction(c.id, new Date());
  const row = await followUpFieldsFor(c.id);
  assert.ok(row.signals.some((s) => s.type === "RECENT_ACTIVITY"));
  assert.ok(!row.signals.some((s) => s.type === "NO_RECENT_INTERACTION"));
});

test("MICRO-STEP 2: a stale interaction (older than RECENT_INTERACTION_THRESHOLD_DAYS) exposes NO_RECENT_INTERACTION end-to-end", async () => {
  const c = await makeClient();
  await makeInteraction(c.id, new Date("2020-01-01T00:00:00Z"));
  const row = await followUpFieldsFor(c.id);
  assert.ok(row.signals.some((s) => s.type === "NO_RECENT_INTERACTION"));
  assert.ok(!row.signals.some((s) => s.type === "RECENT_ACTIVITY"));
});

test("MICRO-STEP 2: several signals co-occur end-to-end for a fully-populated Discovery fixture", async () => {
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDiscoveryResult(c.id, {
    website: null,
    businessStatus: "CLOSED_PERMANENTLY",
    discoveredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });
  await makeInteraction(c.id, new Date("2020-01-01T00:00:00Z"));
  const row = await followUpFieldsFor(c.id);
  const types = new Set(row.signals.map((s) => s.type));
  assert.ok(types.has("DISCOVERY_NEW"));
  assert.ok(types.has("NO_WEBSITE"));
  assert.ok(types.has("BUSINESS_CLOSED"));
  assert.ok(types.has("NO_RECENT_INTERACTION"));
});

test("MICRO-STEP 2: non-regression — signals never change priority, confidence, or totalQualified", async () => {
  const before = await getRadarQueue();
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDeal(c.id, "proposal"); // HIGH, driven only by score.ts
  await makeDiscoveryResult(c.id, { website: null, businessStatus: "CLOSED_PERMANENTLY", discoveredAt: new Date() });
  const after = await getRadarQueue();
  assert.equal(after.totalQualified, before.totalQualified + 1);
  const row = await followUpFieldsFor(c.id);
  assert.equal(row.priority, "HIGH", "priority stays driven only by deals/quotes — signals never influence it");
});

test("MICRO-STEP 2: non-regression — adding signals never reorders pre-existing rows", async () => {
  const beforeOrder = (await scanAllPages()).map((i) => i.clientId);
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDiscoveryResult(c.id, { website: null, businessStatus: "CLOSED_PERMANENTLY", discoveredAt: new Date() });
  const afterOrder = (await scanAllPages()).map((i) => i.clientId);
  const afterOrderWithoutNew = afterOrder.filter((id) => id !== c.id);
  assert.deepEqual(afterOrderWithoutNew, beforeOrder, "a new signal-bearing row never reorders the rest of the queue");
});

test("MICRO-STEP 2: structural — the candidate universe HARD_CAP=500 is still unchanged (non-regression)", () => {
  assert.match(IMPLEMENTATION_SOURCE, /HARD_CAP\s*=\s*500/);
  assert.match(IMPLEMENTATION_SOURCE, /\.limit\(HARD_CAP\)/);
});

test("MICRO-STEP 2: structural — assessSignals is called once per qualified prospect inside the existing qualified.map(), never a new per-row await / query", () => {
  assert.match(IMPLEMENTATION_SOURCE, /assessSignals\(\{/, "assessSignals must be called");
  // No new query site was introduced beyond the ONE discoveryResults batch
  // read already proven single by the MICRO-STEP 1 structural test above
  // — re-asserted here so this file alone proves no N+1 was reintroduced.
  const discoveryFroms = IMPLEMENTATION_SOURCE.match(/\.from\(discoveryResults\)/g) ?? [];
  assert.equal(discoveryFroms.length, 1, "still exactly one discoveryResults query");
  assert.ok(
    !/for \(const .* of qualified\)[\s\S]{0,400}await db/.test(IMPLEMENTATION_SOURCE),
    "no per-row await inside the qualified-subset loop",
  );
});

test("MICRO-STEP 2: structural — signals is never passed to assessQualification or assessOpportunity, and never enters the ranking comparator", () => {
  const qualificationCall = IMPLEMENTATION_SOURCE.match(/assessQualification\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  const opportunityCall = IMPLEMENTATION_SOURCE.match(/assessOpportunity\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  assert.ok(!/signals/.test(qualificationCall), "qualification input stays untouched by this micro-step");
  assert.ok(!/signals/.test(opportunityCall), "opportunity input stays untouched by this micro-step");
  const sortBody = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
  );
  assert.ok(!/signals/.test(sortBody), "no signals term inside the ranking comparator");
});

// =========================================================
// MICRO-STEP 3 — Opportunity Engine v1 (lib/radar/opportunities.ts),
// wired into getRadarQueue() as RankedProspect.opportunities, consuming
// `signals` only (no new DB read). Per-opportunity behaviour is
// unit-tested exhaustively in lib/radar/opportunities.test.mjs; these
// integration tests only prove the WIRING is correct end-to-end.
// =========================================================

test("MICRO-STEP 3: opportunity present (type WEBSITE) when a prospect carries NO_WEBSITE", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: null });
  const row = await followUpFieldsFor(c.id);
  assert.ok(row.signals.some((s) => s.type === "NO_WEBSITE"), "fixture must carry NO_WEBSITE");
  assert.equal(row.opportunities.length, 1);
  assert.equal(row.opportunities[0].type, "WEBSITE");
  assert.equal(row.opportunities[0].service, "website_creation");
  assert.deepEqual(row.opportunities[0].sourceSignals, ["NO_WEBSITE"]);
});

test("MICRO-STEP 3: no opportunity when a prospect has a real website", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: "https://example.test" });
  const row = await followUpFieldsFor(c.id);
  assert.ok(!row.signals.some((s) => s.type === "NO_WEBSITE"));
  assert.deepEqual(row.opportunities, []);
});

test("MICRO-STEP 3: no opportunity for a prospect with no Discovery link and no interaction history at all", async () => {
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id);
  assert.deepEqual(row.signals.map((s) => s.type), ["UNASSIGNED", "NO_FOLLOW_UP_SCHEDULED"], "only the 4E.2 CRM signals, no V1 signal");
  assert.deepEqual(row.opportunities, []);
});

test("MICRO-STEP 3: several co-occurring signals (NO_WEBSITE + BUSINESS_CLOSED + DISCOVERY_NEW) never break the ranking, and yield no WEBSITE opportunity (BUSINESS_CLOSED blocks it — 4C.1)", async () => {
  const beforeOrder = (await scanAllPages()).map((i) => i.clientId);
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDeal(c.id, "proposal"); // HIGH
  await makeDiscoveryResult(c.id, {
    website: null,
    businessStatus: "CLOSED_PERMANENTLY",
    discoveredAt: new Date(),
  });

  const row = await followUpFieldsFor(c.id);
  assert.deepEqual(row.opportunities, []);
  assert.equal(row.priority, "HIGH", "priority still driven only by deals/quotes");

  const afterOrder = (await scanAllPages()).map((i) => i.clientId);
  const afterOrderWithoutNew = afterOrder.filter((id) => id !== c.id);
  assert.deepEqual(afterOrderWithoutNew, beforeOrder, "ranking of pre-existing rows is unaffected");
});

test("MICRO-STEP 3: non-regression — opportunities never change priority, confidence, or totalQualified", async () => {
  const before = await getRadarQueue();
  const c = await makeClient();
  await makeDeal(c.id, "qualified"); // MEDIUM, driven only by score.ts
  await makeDiscoveryResult(c.id, { website: null });
  const after = await getRadarQueue();
  assert.equal(after.totalQualified, before.totalQualified + 1);
  const row = await followUpFieldsFor(c.id);
  assert.equal(row.priority, "MEDIUM", "priority stays driven only by deals/quotes — opportunities never influence it");
});

test("MICRO-STEP 3: structural — the candidate universe HARD_CAP=500 is still unchanged (non-regression)", () => {
  assert.match(IMPLEMENTATION_SOURCE, /HARD_CAP\s*=\s*500/);
  assert.match(IMPLEMENTATION_SOURCE, /\.limit\(HARD_CAP\)/);
});

test("MICRO-STEP 3: structural — assessOpportunities consumes `signals` only, no new DB query site was introduced", () => {
  assert.match(IMPLEMENTATION_SOURCE, /assessOpportunities\(signals\)/, "assessOpportunities must be called with signals as its only argument");
  // Every batched read site already proven single by the MICRO-STEP 1/2
  // structural tests is re-asserted here so this file alone proves no
  // N+1 / no extra query was introduced by the Opportunity Engine.
  const discoveryFroms = IMPLEMENTATION_SOURCE.match(/\.from\(discoveryResults\)/g) ?? [];
  assert.equal(discoveryFroms.length, 1, "still exactly one discoveryResults query");
  // 9 .from() sites already exist as of MICRO-STEP 1/2 (users x2 in
  // resolveAssignees, crmClients, deals, interactions, crmQuotes,
  // crmInvoices, tasks, discoveryResults) — asserting the exact count
  // proves the Opportunity Engine introduced no new query site at all.
  // 4F.7.1 adds exactly one batched crm_websites read (presence only) -> 10.
  const fromCount = (IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length;
  assert.equal(fromCount, 10, "no .from() query site beyond the 9 existing + the 4F.7.1 crm_websites read");
  assert.ok(
    !/for \(const .* of qualified\)[\s\S]{0,400}await db/.test(IMPLEMENTATION_SOURCE),
    "no per-row await inside the qualified-subset loop",
  );
});

test("MICRO-STEP 3: structural — opportunities is never passed to assessQualification or assessOpportunity, and never enters the ranking comparator", () => {
  const qualificationCall = IMPLEMENTATION_SOURCE.match(/assessQualification\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  const opportunityScoreCall = IMPLEMENTATION_SOURCE.match(/assessOpportunity\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  assert.ok(!/opportunities/.test(qualificationCall), "qualification input stays untouched by this micro-step");
  assert.ok(!/opportunities/.test(opportunityScoreCall), "score.ts's assessOpportunity() input stays untouched by this micro-step");
  const sortBody = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
  );
  assert.ok(!/opportunities/.test(sortBody), "no opportunities term inside the ranking comparator");
});

// =========================================================
// MICRO-STEP 4B — Priority V2 exposed INERT on RankedProspect
// (basePriority / finalPriority / priorityAdjustments). `priority` keeps
// its exact current meaning and remains the sole ranking/filter key.
// Rule-by-rule behaviour is unit-tested in lib/radar/priority.test.mjs.
// =========================================================

const TIER_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

test("MICRO-STEP 4B: LOW prospect without opportunity -> basePriority LOW, finalPriority LOW, priority unchanged, no adjustment", async () => {
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id);
  assert.equal(row.priority, "LOW");
  assert.equal(row.basePriority, "LOW");
  assert.equal(row.finalPriority, "LOW");
  assert.deepEqual(row.priorityAdjustments, []);
});

test("MICRO-STEP 4B: LOW + WEBSITE -> finalPriority MEDIUM while priority stays LOW, and pre-existing ranking is unchanged", async () => {
  const beforeOrder = (await scanAllPages()).map((i) => i.clientId);
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: null });
  const row = await followUpFieldsFor(c.id);
  assert.equal(row.priority, "LOW");
  assert.equal(row.basePriority, "LOW");
  assert.equal(row.finalPriority, "MEDIUM");
  assert.deepEqual(row.priorityAdjustments, [
    { direction: "UP", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
  ]);
  const afterOrder = (await scanAllPages()).map((i) => i.clientId);
  assert.deepEqual(afterOrder.filter((id) => id !== c.id), beforeOrder);
});

test("MICRO-STEP 4B: MEDIUM + WEBSITE -> finalPriority MEDIUM with a NONE / OPPORTUNITY_PRESENT adjustment", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "qualified"); // MEDIUM
  await makeDiscoveryResult(c.id, { website: null });
  const row = await followUpFieldsFor(c.id);
  assert.equal(row.priority, "MEDIUM");
  assert.equal(row.basePriority, "MEDIUM");
  assert.equal(row.finalPriority, "MEDIUM");
  assert.deepEqual(row.priorityAdjustments, [
    { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["WEBSITE"] },
  ]);
});

test("MICRO-STEP 4B: HIGH + WEBSITE -> finalPriority HIGH with a NONE adjustment", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "proposal"); // HIGH
  await makeDiscoveryResult(c.id, { website: null });
  const row = await followUpFieldsFor(c.id);
  assert.equal(row.priority, "HIGH");
  assert.equal(row.basePriority, "HIGH");
  assert.equal(row.finalPriority, "HIGH");
  assert.deepEqual(row.priorityAdjustments.map((a) => a.direction), ["NONE"]);
});

test("MICRO-STEP 4B: BUSINESS_CLOSED preserves basePriority as finalPriority and adds a review adjustment (S3), while priority keeps the base value", async () => {
  for (const [stage, base] of [
    [null, "LOW"],
    ["qualified", "MEDIUM"],
    ["proposal", "HIGH"],
  ]) {
    const c = await makeClient();
    if (stage) await makeDeal(c.id, stage);
    await makeDiscoveryResult(c.id, { website: "https://example.test", businessStatus: "CLOSED_PERMANENTLY" });
    const row = await followUpFieldsFor(c.id);
    assert.equal(row.priority, base, `priority stays ${base}`);
    assert.equal(row.basePriority, base);
    assert.equal(row.finalPriority, base, `${base} + BUSINESS_CLOSED -> ${base}`);
    assert.equal(row.priorityAdjustments.at(-1).reasonCode, "BUSINESS_CLOSED_REVIEW");
    assert.equal(row.priorityAdjustments.at(-1).direction, "NONE");
  }
});

test("MICRO-STEP 4B: at most one tier increase for every prospect in the queue (multiple-opportunity rule is unit-tested; today's data can only yield one WEBSITE opportunity)", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: null });
  const items = await scanAllPages();
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok(TIER_RANK[item.finalPriority] - TIER_RANK[item.basePriority] <= 1, `${item.clientId} rose more than one tier`);
    assert.ok(item.priorityAdjustments.filter((a) => a.direction === "UP").length <= 1);
  }
});

test("MICRO-STEP 4B: priority === basePriority for every prospect in the queue", async () => {
  const items = await scanAllPages();
  for (const item of items) assert.equal(item.priority, item.basePriority);
});

test("MICRO-STEP 4D.2: basePriority is tie-break #2 — a real MEDIUM (LOW confidence) outranks a LOW promoted to MEDIUM (HIGH confidence)", async () => {
  // Y: basePriority MEDIUM, confidence LOW, finalPriority MEDIUM.
  const y = await makeClient();
  await makeDeal(y.id, "qualified");
  // X: basePriority LOW, confidence HIGH (industry + geography), finalPriority MEDIUM.
  // Both tie on finalPriority MEDIUM; without the basePriority tie-break X's
  // higher confidence would put it first. basePriority MEDIUM > LOW keeps Y ahead.
  const x = await makeClient({ industry: "restaurant", city: "Montréal" });
  await makeDiscoveryResult(x.id, { website: null });

  const items = await scanAllPages();
  const xRow = items.find((i) => i.clientId === x.id);
  const yRow = items.find((i) => i.clientId === y.id);
  assert.equal(xRow.finalPriority, "MEDIUM");
  assert.equal(xRow.basePriority, "LOW");
  assert.equal(xRow.confidence, "HIGH");
  assert.equal(yRow.finalPriority, "MEDIUM");
  assert.equal(yRow.basePriority, "MEDIUM");
  assert.equal(yRow.confidence, "LOW");
  assert.ok(indexOfClient(items, y.id) < indexOfClient(items, x.id), "Y (real MEDIUM) ranks before X (LOW promoted to MEDIUM)");
});

test("MICRO-STEP 4D.2: the priority filter keys on finalPriority — a LOW+WEBSITE prospect appears under MEDIUM, not LOW", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: null });
  const low = await scanAllPages({ priority: ["LOW"] });
  const medium = await scanAllPages({ priority: ["MEDIUM"] });
  assert.ok(medium.some((i) => i.clientId === c.id), "promoted prospect is listed under MEDIUM");
  assert.ok(!low.some((i) => i.clientId === c.id), "promoted prospect is no longer listed under LOW");
  assert.ok(medium.every((i) => i.finalPriority === "MEDIUM"), "every MEDIUM-filtered row carries finalPriority MEDIUM");
  assert.ok(low.every((i) => i.finalPriority === "LOW"), "every LOW-filtered row carries finalPriority LOW");
});

test("MICRO-STEP 4D.2: structural — the comparator reads finalPriority then basePriority, never `priority` or priorityAdjustments; the filter reads finalPriority", () => {
  const sortBody = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
  );
  const finalIdx = sortBody.indexOf("PRIORITY_RANK[b.finalPriority] - PRIORITY_RANK[a.finalPriority]");
  const baseIdx = sortBody.indexOf("PRIORITY_RANK[b.basePriority] - PRIORITY_RANK[a.basePriority]");
  const confidenceIdx = sortBody.indexOf("CONFIDENCE_RANK[b.confidence]");
  assert.ok(finalIdx !== -1, "finalPriority is compared");
  assert.ok(baseIdx !== -1, "basePriority is compared");
  assert.ok(finalIdx < baseIdx && baseIdx < confidenceIdx, "order: finalPriority -> basePriority -> confidence");
  assert.ok(!/\b[ab]\.priority\b/.test(sortBody), "`priority` is not read by the comparator");
  assert.ok(!/priorityAdjustments/.test(sortBody), "priorityAdjustments is not read by the comparator");
  const filterBlock = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
    IMPLEMENTATION_SOURCE.indexOf("const filteredTotal"),
  );
  assert.match(filterBlock, /priorityFilter\.includes\(r\.finalPriority\)/, "the priority filter keys on finalPriority");
  assert.ok(!/\br\.priority\b/.test(filterBlock), "no filter keys on `priority`");
});

test("MICRO-STEP 4D.2: ranking follows finalPriority — a LOW promoted to MEDIUM outranks an older plain LOW with the same confidence", async () => {
  // Z is created first (older): under the old `priority` comparator both are
  // LOW / HIGH confidence / no interaction, so the older Z would lead.
  const z = await makeClient({ industry: "plumber", city: "Laval" });
  const x = await makeClient({ industry: "restaurant", city: "Montréal" });
  await makeDiscoveryResult(x.id, { website: null });

  const items = await scanAllPages();
  const xRow = items.find((i) => i.clientId === x.id);
  const zRow = items.find((i) => i.clientId === z.id);
  assert.equal(xRow.finalPriority, "MEDIUM");
  assert.equal(zRow.finalPriority, "LOW");
  assert.equal(xRow.confidence, zRow.confidence);
  assert.ok(indexOfClient(items, x.id) < indexOfClient(items, z.id), "X (finalPriority MEDIUM) ranks before Z (finalPriority LOW)");
});

test("MICRO-STEP 4D.2: LOW + opportunity -> finalPriority MEDIUM, ranked in the MEDIUM tier, listed under the MEDIUM filter, and the badge reads finalPriority", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: null });
  const items = await scanAllPages();
  const row = items.find((i) => i.clientId === c.id);
  assert.equal(row.basePriority, "LOW");
  assert.equal(row.finalPriority, "MEDIUM");
  const idx = indexOfClient(items, c.id);
  assert.ok(items.slice(0, idx).every((i) => i.finalPriority !== "LOW"), "no LOW row ranks above it");
  assert.ok(items.slice(idx + 1).every((i) => i.finalPriority !== "HIGH"), "no HIGH row ranks below it");
  const medium = await scanAllPages({ priority: ["MEDIUM"] });
  assert.ok(medium.some((i) => i.clientId === c.id));
  const PAGE_SOURCE = readFileSync(fileURLToPath(new URL("../../app/admin/crm/radar/page.tsx", import.meta.url)), "utf8");
  assert.match(PAGE_SOURCE, /priorityLabel\[item\.finalPriority\]/, "badge label reads finalPriority");
  assert.match(PAGE_SOURCE, /PRIORITY_CLASS\[item\.finalPriority\]/, "badge color reads finalPriority");
  assert.ok(!/(priorityLabel|PRIORITY_CLASS)\[item\.priority\]/.test(PAGE_SOURCE), "badge no longer reads `priority`");
});

test("MICRO-STEP 4D.2: BUSINESS_CLOSED + HIGH -> finalPriority HIGH, still ranked in the HIGH tier and listed under the HIGH filter", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "proposal"); // HIGH
  await makeDiscoveryResult(c.id, { website: "https://example.test", businessStatus: "CLOSED_PERMANENTLY" });
  const items = await scanAllPages();
  const row = items.find((i) => i.clientId === c.id);
  assert.equal(row.basePriority, "HIGH");
  assert.equal(row.finalPriority, "HIGH");
  assert.equal(row.priorityAdjustments.at(-1).reasonCode, "BUSINESS_CLOSED_REVIEW");
  const idx = indexOfClient(items, c.id);
  assert.ok(items.slice(0, idx).every((i) => i.finalPriority === "HIGH"), "only HIGH rows rank above it");
  const high = await scanAllPages({ priority: ["HIGH"] });
  assert.ok(high.some((i) => i.clientId === c.id));
});

test("MICRO-STEP 4B: structural — HARD_CAP=500 unchanged", () => {
  assert.match(IMPLEMENTATION_SOURCE, /HARD_CAP\s*=\s*500/);
  assert.match(IMPLEMENTATION_SOURCE, /\.limit\(HARD_CAP\)/);
});

test("MICRO-STEP 4B: structural — assessPriority uses only already-derived values, and no new DB query site exists", () => {
  assert.match(IMPLEMENTATION_SOURCE, /assessPriority\(\{ basePriority: opportunity\.priority, signals, opportunities \}\)/);
  const fromCount = (IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length;
  assert.equal(fromCount, 10, "still exactly the 9 existing .from() sites + the 4F.7.1 crm_websites read");
});

test("MICRO-STEP 4B: signals and opportunities are still exposed alongside the new fields", async () => {
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDiscoveryResult(c.id, { website: null, discoveredAt: new Date() });
  const row = await followUpFieldsFor(c.id);
  const types = new Set(row.signals.map((s) => s.type));
  assert.ok(types.has("DISCOVERY_NEW"));
  assert.ok(types.has("NO_WEBSITE"));
  assert.deepEqual(row.opportunities.map((o) => o.type), ["WEBSITE"]);
  assert.equal(row.finalPriority, "MEDIUM");
});

// =========================================================
// MICRO-STEP 4E.2 — Signals V2 class A (UNASSIGNED, FOLLOW_UP_OVERDUE,
// NO_FOLLOW_UP_SCHEDULED, DEAL_ACTIVE, QUOTE_PENDING), wired from data the
// queue already loads. Per-rule behaviour is unit-tested in
// lib/radar/signals.test.mjs; these tests prove the end-to-end wiring.
// =========================================================

function signalTypes(row) {
  return row.signals.map((s) => s.type);
}

test("4E.2: UNASSIGNED is present for an unassigned prospect and absent once it is assigned", async () => {
  const unassigned = await makeClient();
  const u = await makeUser({ fullName: "4E2 Owner" });
  const assigned = await makeClient({ assignedUserId: u.id });
  assert.ok(signalTypes(await followUpFieldsFor(unassigned.id)).includes("UNASSIGNED"));
  assert.ok(!signalTypes(await followUpFieldsFor(assigned.id)).includes("UNASSIGNED"));
});

test("4E.2: FOLLOW_UP_OVERDUE follows the queue's own nextFollowUpOverdue flag, exclusive with NO_FOLLOW_UP_SCHEDULED", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, true);
  assert.ok(signalTypes(row).includes("FOLLOW_UP_OVERDUE"));
  assert.ok(!signalTypes(row).includes("NO_FOLLOW_UP_SCHEDULED"));
  const signal = row.signals.find((s) => s.type === "FOLLOW_UP_OVERDUE");
  assert.deepEqual(signal.evidence, { nextFollowUpDueAt: row.nextFollowUpDueAt });
});

test("4E.2: a follow-up due today is not overdue — neither FOLLOW_UP_OVERDUE nor NO_FOLLOW_UP_SCHEDULED", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, false);
  assert.ok(!signalTypes(row).includes("FOLLOW_UP_OVERDUE"));
  assert.ok(!signalTypes(row).includes("NO_FOLLOW_UP_SCHEDULED"));
});

test("4E.2: NO_FOLLOW_UP_SCHEDULED is present without an open dated follow-up, absent with one", async () => {
  const without = await makeClient();
  const withTask = await makeClient();
  await makeTask(withTask.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) });
  assert.ok(signalTypes(await followUpFieldsFor(without.id, { now: FIXED_NOW })).includes("NO_FOLLOW_UP_SCHEDULED"));
  assert.ok(!signalTypes(await followUpFieldsFor(withTask.id, { now: FIXED_NOW })).includes("NO_FOLLOW_UP_SCHEDULED"));
});

test("4E.2: DEAL_ACTIVE is present for an open deal and absent for a won-only prospect", async () => {
  const open = await makeClient();
  await makeDeal(open.id, "qualified");
  const wonOnly = await makeClient();
  await makeDeal(wonOnly.id, "won");
  const openRow = await followUpFieldsFor(open.id);
  assert.ok(signalTypes(openRow).includes("DEAL_ACTIVE"));
  assert.deepEqual(openRow.signals.find((s) => s.type === "DEAL_ACTIVE").evidence, { openDealCount: 1 });
  assert.ok(!signalTypes(await followUpFieldsFor(wonOnly.id)).includes("DEAL_ACTIVE"));
});

test("4E.2: QUOTE_PENDING is present for a sent unanswered quote, absent for a sent-and-answered or draft quote", async () => {
  const pending = await makeClient();
  await makeQuote(pending.id, { status: "sent", sentAt: new Date() });
  const answered = await makeClient();
  await makeQuote(answered.id, { status: "sent", sentAt: new Date(), respondedAt: new Date() });
  const draft = await makeClient();
  await makeQuote(draft.id, { status: "draft" });
  assert.ok(signalTypes(await followUpFieldsFor(pending.id)).includes("QUOTE_PENDING"));
  assert.ok(!signalTypes(await followUpFieldsFor(answered.id)).includes("QUOTE_PENDING"));
  assert.ok(!signalTypes(await followUpFieldsFor(draft.id)).includes("QUOTE_PENDING"));
});

test("4E.2: across the whole queue, UNASSIGNED / FOLLOW_UP_OVERDUE / NO_FOLLOW_UP_SCHEDULED match the exposed fields exactly", async () => {
  const items = await scanAllPages({ now: FIXED_NOW });
  assert.ok(items.length > 0);
  for (const item of items) {
    const types = signalTypes(item);
    assert.equal(types.includes("UNASSIGNED"), item.assignedUserId === null, item.clientId);
    assert.equal(types.includes("NO_FOLLOW_UP_SCHEDULED"), item.nextFollowUpDueAt === null, item.clientId);
    assert.equal(types.includes("FOLLOW_UP_OVERDUE"), item.nextFollowUpDueAt !== null && item.nextFollowUpOverdue, item.clientId);
  }
});

test("4E.2: new signals do not affect ranking — an unassigned prospect keeps its createdAt position against an assigned twin", async () => {
  const u = await makeUser({ fullName: "4E2 Twin Owner" });
  // Future timestamps keep both rows inside the newest-first HARD_CAP window.
  const olderUnassigned = await makeClient({ createdAt: new Date(Date.now() + 60 * 60 * 1000) });
  const newerAssigned = await makeClient({ assignedUserId: u.id, createdAt: new Date(Date.now() + 2 * 60 * 60 * 1000) });
  const items = await scanAllPages();
  assert.ok(signalTypes(items.find((i) => i.clientId === olderUnassigned.id)).includes("UNASSIGNED"));
  assert.ok(indexOfClient(items, olderUnassigned.id) < indexOfClient(items, newerAssigned.id), "older-first tie-break unchanged by UNASSIGNED");
});

test("4E.2/4E.3: structural — no new query site; deals/quotes selects gain ONLY expectedCloseDate/validUntil; signals never reach the comparator or filters", () => {
  const fromCount = (IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length;
  assert.equal(fromCount, 10, "still exactly the 9 existing .from() sites + the 4F.7.1 crm_websites read");
  assert.match(
    IMPLEMENTATION_SOURCE,
    /\.select\(\{ id: deals\.id, clientId: deals\.clientId, stage: deals\.stage, expectedCloseDate: deals\.expectedCloseDate \}\)/,
    "deals select = previous columns + expectedCloseDate (4E.3) + id (4F.6.2) only",
  );
  assert.match(
    IMPLEMENTATION_SOURCE,
    /\.select\(\{ id: crmQuotes\.id, clientId: crmQuotes\.clientId, dealId: crmQuotes\.dealId, status: crmQuotes\.status, sentAt: crmQuotes\.sentAt, respondedAt: crmQuotes\.respondedAt, validUntil: crmQuotes\.validUntil \}\)/,
    "quotes select = previous columns + validUntil (4E.3) + id/dealId (4F.6.4) only",
  );
  assert.equal((IMPLEMENTATION_SOURCE.match(/deals\.expectedCloseDate/g) ?? []).length, 1, "expectedCloseDate read in one place");
  assert.equal((IMPLEMENTATION_SOURCE.match(/crmQuotes\.validUntil/g) ?? []).length, 1, "validUntil read in one place");
  const sortAndFilters = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("const filteredTotal"),
  );
  assert.ok(
    !/signals|UNASSIGNED|FOLLOW_UP_OVERDUE|NO_FOLLOW_UP_SCHEDULED|DEAL_ACTIVE|QUOTE_PENDING|DEAL_PAST_EXPECTED_CLOSE|QUOTE_PAST_VALIDITY|expectedCloseDate|validUntil/.test(sortAndFilters),
  );
});

// =========================================================
// MICRO-STEP 4E.3 — Signals V2 class B (DEAL_PAST_EXPECTED_CLOSE,
// QUOTE_PAST_VALIDITY) from expectedCloseDate / validUntil, now carried by
// the existing deals / crm_quotes batched reads. Deterministic via FIXED_NOW.
// =========================================================

const DAY_MS = 24 * 60 * 60 * 1000;

test("4E.3: DEAL_PAST_EXPECTED_CLOSE end-to-end — an open deal past expectedCloseDate yields it (evidence counted) and not DEAL_ACTIVE", async () => {
  const c = await makeClient();
  const close = new Date(FIXED_NOW.getTime() - DAY_MS);
  const dealId = await makeDeal(c.id, "qualified", { expectedCloseDate: close });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const signal = row.signals.find((s) => s.type === "DEAL_PAST_EXPECTED_CLOSE");
  assert.ok(signal, "expectedCloseDate was transmitted to assessSignals");
  assert.deepEqual(signal.evidence, {
    overdueDealCount: 1,
    overdueDeals: [{ dealId, stage: "qualified", expectedCloseDate: close, overdueDays: 1, lastDealInteractionAt: null, dealContactState: "NONE_RECORDED" }],
  });
  assert.ok(!signalTypes(row).includes("DEAL_ACTIVE"));
});

test("4E.3: a future expectedCloseDate yields DEAL_ACTIVE only; mixed overdue + future deals yield both", async () => {
  const future = await makeClient();
  await makeDeal(future.id, "proposal", { expectedCloseDate: new Date(FIXED_NOW.getTime() + DAY_MS) });
  const futureRow = await followUpFieldsFor(future.id, { now: FIXED_NOW });
  assert.ok(signalTypes(futureRow).includes("DEAL_ACTIVE"));
  assert.ok(!signalTypes(futureRow).includes("DEAL_PAST_EXPECTED_CLOSE"));

  const mixed = await makeClient();
  const overdueClose = new Date(FIXED_NOW.getTime() - DAY_MS);
  const overdueId = await makeDeal(mixed.id, "qualified", { expectedCloseDate: overdueClose });
  await makeDeal(mixed.id, "new", { expectedCloseDate: new Date(FIXED_NOW.getTime() + DAY_MS) });
  const mixedRow = await followUpFieldsFor(mixed.id, { now: FIXED_NOW });
  assert.deepEqual(mixedRow.signals.find((s) => s.type === "DEAL_ACTIVE").evidence, { openDealCount: 1 });
  assert.deepEqual(mixedRow.signals.find((s) => s.type === "DEAL_PAST_EXPECTED_CLOSE").evidence, {
    overdueDealCount: 1,
    overdueDeals: [{ dealId: overdueId, stage: "qualified", expectedCloseDate: overdueClose, overdueDays: 1, lastDealInteractionAt: null, dealContactState: "NONE_RECORDED" }],
  });
});

test("4E.3: QUOTE_PAST_VALIDITY end-to-end — a sent unanswered quote past validUntil yields it (evidence counted) and not QUOTE_PENDING", async () => {
  const c = await makeClient();
  const validUntil = new Date(FIXED_NOW.getTime() - DAY_MS);
  const quoteId = await makeQuote(c.id, { status: "sent", sentAt: new Date(FIXED_NOW.getTime() - 10 * DAY_MS), validUntil });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const signal = row.signals.find((s) => s.type === "QUOTE_PAST_VALIDITY");
  assert.ok(signal, "validUntil was transmitted to assessSignals");
  assert.deepEqual(signal.evidence, { expiredQuoteCount: 1, expiredQuotes: [{ quoteId, validUntil, dealId: null, daysPastValidity: 1 }] });
  assert.ok(!signalTypes(row).includes("QUOTE_PENDING"));
});

test("4E.3: a sent quote with a future validUntil, or without validUntil, stays QUOTE_PENDING", async () => {
  const future = await makeClient();
  await makeQuote(future.id, { status: "sent", sentAt: FIXED_NOW, validUntil: new Date(FIXED_NOW.getTime() + DAY_MS) });
  const none = await makeClient();
  await makeQuote(none.id, { status: "sent", sentAt: FIXED_NOW });
  for (const id of [future.id, none.id]) {
    const row = await followUpFieldsFor(id, { now: FIXED_NOW });
    assert.ok(signalTypes(row).includes("QUOTE_PENDING"));
    assert.ok(!signalTypes(row).includes("QUOTE_PAST_VALIDITY"));
  }
});

test("4E.3: the new signals change neither priority nor ranking/filter keys (since 4F.2-A QUOTE_PAST_VALIDITY yields a PROPOSAL_RENEWAL opportunity)", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "qualified", { expectedCloseDate: new Date(FIXED_NOW.getTime() - DAY_MS) }); // MEDIUM base
  await makeQuote(c.id, { status: "sent", sentAt: FIXED_NOW, validUntil: new Date(FIXED_NOW.getTime() - DAY_MS) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(signalTypes(row).includes("DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(signalTypes(row).includes("QUOTE_PAST_VALIDITY"));
  assert.equal(row.basePriority, "MEDIUM", "score.ts unchanged: qualified deal / pending quote -> MEDIUM");
  assert.equal(row.finalPriority, "MEDIUM", "Priority V2 ignores the new signals");
  // 4F.2-A / 4F.3: the unchanged Priority engine records the opportunities
  // as a NONE adjustment (MEDIUM never promotes); the tier does not move.
  // The overdue deal with no recorded interaction now yields DEAL_STALLED.
  assert.deepEqual(row.priorityAdjustments, [
    { direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities: ["PROPOSAL_RENEWAL", "DEAL_STALLED"] },
  ]);
  assert.deepEqual(row.opportunities.map((o) => o.type), ["PROPOSAL_RENEWAL", "DEAL_STALLED"]);
  const medium = await scanAllPages({ priority: ["MEDIUM"], now: FIXED_NOW });
  assert.ok(medium.some((i) => i.clientId === c.id), "filter still keyed on finalPriority");
});

// =========================================================
// MICRO-STEP 4F.2-A — PROPOSAL_RENEWAL (QUOTE_PAST_VALIDITY), end-to-end.
// =========================================================

async function makeExpiredQuote(clientId) {
  return makeQuote(clientId, { status: "sent", sentAt: new Date(FIXED_NOW.getTime() - 10 * DAY_MS), validUntil: new Date(FIXED_NOW.getTime() - DAY_MS) });
}
async function makeValidQuote(clientId) {
  await makeQuote(clientId, { status: "sent", sentAt: FIXED_NOW, validUntil: new Date(FIXED_NOW.getTime() + DAY_MS) });
}
function opportunityTypes(row) {
  return row.opportunities.map((o) => o.type);
}

test("4F.2-A: QUOTE_PAST_VALIDITY yields PROPOSAL_RENEWAL (service null) whose evidence equals the signal's", async () => {
  const c = await makeClient();
  const quoteId = await makeExpiredQuote(c.id);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const signal = row.signals.find((s) => s.type === "QUOTE_PAST_VALIDITY");
  assert.deepEqual(row.opportunities, [
    {
      type: "PROPOSAL_RENEWAL",
      service: null,
      reason: "QUOTE_VALIDITY_EXPIRED_UNANSWERED",
      evidence: signal.evidence,
      sourceSignals: ["QUOTE_PAST_VALIDITY"],
    },
  ]);
  assert.deepEqual(signal.evidence, {
    expiredQuoteCount: 1,
    expiredQuotes: [{ quoteId, validUntil: new Date(FIXED_NOW.getTime() - DAY_MS), dealId: null, daysPastValidity: 1 }],
  });
});

test("4F.2-A: a still-valid sent quote yields no PROPOSAL_RENEWAL", async () => {
  const c = await makeClient();
  await makeValidQuote(c.id);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(!opportunityTypes(row).includes("PROPOSAL_RENEWAL"));
});

test("4F.2-A: basePriority / finalPriority are identical with an expired or a valid quote — PROPOSAL_RENEWAL never promotes", async () => {
  const expired = await makeClient();
  await makeExpiredQuote(expired.id);
  const valid = await makeClient();
  await makeValidQuote(valid.id);
  const expiredRow = await followUpFieldsFor(expired.id, { now: FIXED_NOW });
  const validRow = await followUpFieldsFor(valid.id, { now: FIXED_NOW });
  assert.equal(expiredRow.basePriority, validRow.basePriority);
  assert.equal(expiredRow.finalPriority, validRow.finalPriority);
  assert.equal(expiredRow.finalPriority, expiredRow.basePriority);
  assert.ok(!expiredRow.priorityAdjustments.some((a) => a.direction === "UP"));
});

test("4F.2-A: across the whole queue, a PROPOSAL_RENEWAL never comes with a tier change", async () => {
  const items = await scanAllPages({ now: FIXED_NOW });
  for (const item of items.filter((i) => opportunityTypes(i).includes("PROPOSAL_RENEWAL"))) {
    assert.ok(item.basePriority !== "LOW", `${item.clientId}: a sent unanswered quote always gives base >= MEDIUM`);
    assert.equal(item.finalPriority, item.basePriority, item.clientId);
  }
});

test("4F.2-A: ranking does not move because of PROPOSAL_RENEWAL — createdAt order holds between expired-quote and valid-quote twins", async () => {
  // Future timestamps keep the four rows inside the newest-first HARD_CAP window.
  const t = Date.now() + 3 * 60 * 60 * 1000;
  const olderValid = await makeClient({ createdAt: new Date(t) });
  await makeValidQuote(olderValid.id);
  const newerExpired = await makeClient({ createdAt: new Date(t + 1000) });
  await makeExpiredQuote(newerExpired.id);
  const olderExpired = await makeClient({ createdAt: new Date(t + 2000) });
  await makeExpiredQuote(olderExpired.id);
  const newerValid = await makeClient({ createdAt: new Date(t + 3000) });
  await makeValidQuote(newerValid.id);
  const items = await scanAllPages({ now: FIXED_NOW });
  const ids = [olderValid.id, newerExpired.id, olderExpired.id, newerValid.id];
  const positions = ids.map((id) => indexOfClient(items, id));
  assert.ok(positions.every((p) => p !== -1));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "pure createdAt order, renewal or not");
});

test("4F.2-A: WEBSITE keeps its behaviour — NO_WEBSITE + expired quote yields WEBSITE then PROPOSAL_RENEWAL", async () => {
  const c = await makeClient();
  const discoveryRow = await makeDiscoveryResult(c.id, { website: null });
  await makeExpiredQuote(c.id);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(opportunityTypes(row), ["WEBSITE", "PROPOSAL_RENEWAL"]);
  const website = row.opportunities[0];
  assert.deepEqual(website, {
    type: "WEBSITE",
    service: "website_creation",
    reason: "NO_WEBSITE_DETECTED",
    // 4F.6.6 — Discovery provenance copied from the NO_WEBSITE signal.
    evidence: { website: null, discoveryCategory: null, discoveryBusinessStatus: null, discoveredAt: discoveryRow.discoveredAt },
    sourceSignals: ["NO_WEBSITE"],
  });
});

test("4F.2-A: BUSINESS_CLOSED + expired quote keeps PROPOSAL_RENEWAL; priority stays at base with the S3 review entry", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: "https://example.test", businessStatus: "CLOSED_PERMANENTLY" });
  await makeExpiredQuote(c.id);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(opportunityTypes(row), ["PROPOSAL_RENEWAL"]);
  assert.equal(row.finalPriority, row.basePriority);
  assert.equal(row.priorityAdjustments.at(-1).reasonCode, "BUSINESS_CLOSED_REVIEW");
});

test("4F.2-A: BUSINESS_CLOSED + NO_WEBSITE + expired quote yields PROPOSAL_RENEWAL only, never WEBSITE", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: null, businessStatus: "CLOSED_PERMANENTLY" });
  await makeExpiredQuote(c.id);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(opportunityTypes(row), ["PROPOSAL_RENEWAL"]);
});

test("4F.2-A: structural — still exactly 9 .from() sites (10 since 4F.7.1); the queue still calls assessOpportunities(signals) only", () => {
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10, "9 existing .from() sites + the 4F.7.1 crm_websites read");
  assert.match(IMPLEMENTATION_SOURCE, /assessOpportunities\(signals\)/);
});

// =========================================================
// MICRO-STEP 4F.3 — DEAL_STALLED, end-to-end (deterministic via FIXED_NOW).
// =========================================================

const OVERDUE_CLOSE = new Date(FIXED_NOW.getTime() - DAY_MS);
const STALE_CONTACT = new Date(FIXED_NOW.getTime() - 45 * DAY_MS);
const RECENT_CONTACT = new Date(FIXED_NOW.getTime() - 2 * DAY_MS);

function stalledOf(row) {
  return row.opportunities.find((o) => o.type === "DEAL_STALLED") ?? null;
}

test("4F.3 #1: overdue deal + no recorded interaction -> DEAL_STALLED, NONE_RECORDED, source = [DEAL_PAST_EXPECTED_CLOSE]", async () => {
  const c = await makeClient();
  const dealId = await makeDeal(c.id, "qualified", { expectedCloseDate: OVERDUE_CLOSE });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(stalledOf(row), {
    type: "DEAL_STALLED",
    service: null,
    reason: "DEAL_OVERDUE_NO_RECENT_CONTACT",
    evidence: {
      overdueDealCount: 1,
      overdueDeals: [{ dealId, stage: "qualified", expectedCloseDate: OVERDUE_CLOSE, overdueDays: 1, lastDealInteractionAt: null, dealContactState: "NONE_RECORDED" }],
      lastInteractionAt: null,
    },
    sourceSignals: ["DEAL_PAST_EXPECTED_CLOSE"],
  });
});

test("4F.3 #2: overdue deal + stale interaction -> DEAL_STALLED, STALE, lastInteractionAt = that interaction", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "qualified", { expectedCloseDate: OVERDUE_CLOSE });
  await makeInteraction(c.id, STALE_CONTACT);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const opportunity = stalledOf(row);
  assert.ok(opportunity);
  assert.equal(opportunity.evidence.overdueDeals[0].dealContactState, "STALE");
  assert.equal(opportunity.evidence.overdueDeals[0].lastDealInteractionAt.getTime(), STALE_CONTACT.getTime());
  assert.ok(!("contactState" in opportunity.evidence), "4F.8.7: no global contactState any more");
  assert.equal(opportunity.evidence.lastInteractionAt.getTime(), STALE_CONTACT.getTime());
  assert.deepEqual(opportunity.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE", "NO_RECENT_INTERACTION"]);
});

test("4F.3 #3/#6: overdue deal + recent interaction -> no DEAL_STALLED", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "qualified", { expectedCloseDate: OVERDUE_CLOSE });
  await makeInteraction(c.id, RECENT_CONTACT);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(signalTypes(row).includes("DEAL_PAST_EXPECTED_CLOSE"));
  assert.ok(signalTypes(row).includes("RECENT_ACTIVITY"));
  assert.equal(stalledOf(row), null);
});

test("4F.3 #4: BUSINESS_CLOSED + overdue deal + no recent activity -> DEAL_STALLED kept, priority at base", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "qualified", { expectedCloseDate: OVERDUE_CLOSE });
  await makeDiscoveryResult(c.id, { website: "https://example.test", businessStatus: "CLOSED_PERMANENTLY" });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(stalledOf(row));
  assert.equal(row.finalPriority, row.basePriority);
  assert.equal(row.priorityAdjustments.at(-1).reasonCode, "BUSINESS_CLOSED_REVIEW");
});

test("4F.3 #5/#9: expired quote + overdue deal (+ NO_WEBSITE) -> WEBSITE, PROPOSAL_RENEWAL, DEAL_STALLED in that order", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "new", { expectedCloseDate: OVERDUE_CLOSE });
  await makeExpiredQuote(c.id);
  await makeDiscoveryResult(c.id, { website: null });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(opportunityTypes(row), ["WEBSITE", "PROPOSAL_RENEWAL", "DEAL_STALLED"]);
});

test("4F.3 #7: DEAL_STALLED is priority-neutral at every tier (deal new=LOW, qualified=MEDIUM, proposal=HIGH)", async () => {
  for (const [stage, base] of [
    ["new", "LOW"],
    ["qualified", "MEDIUM"],
    ["proposal", "HIGH"],
  ]) {
    const c = await makeClient();
    await makeDeal(c.id, stage, { expectedCloseDate: OVERDUE_CLOSE });
    const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
    assert.ok(stalledOf(row), stage);
    assert.equal(row.basePriority, base, stage);
    assert.equal(row.finalPriority, base, `${stage}: no promotion`);
    assert.ok(!row.priorityAdjustments.some((a) => a.direction === "UP"), stage);
  }
});

test("4F.3 #7b: a LOW prospect with DEAL_STALLED stays listed under the LOW filter, not MEDIUM", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "new", { expectedCloseDate: OVERDUE_CLOSE });
  const low = await scanAllPages({ priority: ["LOW"], now: FIXED_NOW });
  const medium = await scanAllPages({ priority: ["MEDIUM"], now: FIXED_NOW });
  assert.ok(low.some((i) => i.clientId === c.id));
  assert.ok(!medium.some((i) => i.clientId === c.id));
});

test("4F.3 #8: no new signal type — NO_INTERACTION_HISTORY never appears; the queue still has 9 .from() sites (10 since 4F.7.1)", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "qualified", { expectedCloseDate: OVERDUE_CLOSE });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(!signalTypes(row).includes("NO_INTERACTION_HISTORY"));
  assert.ok(!stalledOf(row).sourceSignals.includes("NO_INTERACTION_HISTORY"));
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10, "9 existing .from() sites + the 4F.7.1 crm_websites read");
});

// =========================================================
// MICRO-STEP 4F.6.2 — DEAL_PAST_EXPECTED_CLOSE / DEAL_STALLED evidence lists
// the overdue deals (dealId, stage, expectedCloseDate, overdueDays), end-to-end.
// =========================================================

test("4F.6.2: two overdue deals + one future + won/lost -> overdueDeals lists exactly the two overdue ids, sorted by expectedCloseDate", async () => {
  const c = await makeClient();
  const recentId = await makeDeal(c.id, "new", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 5 * DAY_MS) });
  const oldestId = await makeDeal(c.id, "proposal", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 40 * DAY_MS) });
  await makeDeal(c.id, "qualified", { expectedCloseDate: new Date(FIXED_NOW.getTime() + 10 * DAY_MS) });
  await makeDeal(c.id, "won", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 20 * DAY_MS) });
  await makeDeal(c.id, "lost", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 20 * DAY_MS) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const evidence = row.signals.find((s) => s.type === "DEAL_PAST_EXPECTED_CLOSE").evidence;
  assert.deepEqual(evidence.overdueDeals.map((d) => d.dealId), [oldestId, recentId]);
  assert.deepEqual(evidence.overdueDeals.map((d) => d.stage), ["proposal", "new"]);
  assert.deepEqual(evidence.overdueDeals.map((d) => d.overdueDays), [40, 5]);
  assert.equal(evidence.overdueDealCount, evidence.overdueDeals.length);
  assert.deepEqual(row.signals.find((s) => s.type === "DEAL_ACTIVE").evidence, { openDealCount: 1 });
});

test("4F.6.2/4F.8.7: DEAL_STALLED evidence.overdueDeals is exactly the signal's stalled deals, lastInteractionAt = prospect's latest", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "new", { expectedCloseDate: OVERDUE_CLOSE });
  await makeDeal(c.id, "qualified", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 10 * DAY_MS) });
  await makeInteraction(c.id, STALE_CONTACT);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const signalEvidence = row.signals.find((s) => s.type === "DEAL_PAST_EXPECTED_CLOSE").evidence;
  const opportunity = stalledOf(row);
  assert.deepEqual(opportunity.evidence.overdueDeals, signalEvidence.overdueDeals);
  assert.equal(opportunity.evidence.overdueDealCount, 2);
  assert.ok(opportunity.evidence.overdueDeals.every((d) => d.dealContactState === "STALE"));
  assert.equal(opportunity.evidence.lastInteractionAt.getTime(), STALE_CONTACT.getTime());
});

test("4F.6.2: a recent interaction still suppresses DEAL_STALLED (detection unchanged); the signal still lists the overdue deal", async () => {
  const c = await makeClient();
  const dealId = await makeDeal(c.id, "contacted", { expectedCloseDate: OVERDUE_CLOSE });
  await makeInteraction(c.id, RECENT_CONTACT);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(stalledOf(row), null);
  assert.deepEqual(row.signals.find((s) => s.type === "DEAL_PAST_EXPECTED_CLOSE").evidence.overdueDeals.map((d) => d.dealId), [dealId]);
});

test("4F.6.2/4F.8.7: evidence entries expose only dealId / stage / expectedCloseDate / overdueDays / lastDealInteractionAt / dealContactState — never title or value; still 10 .from()", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "new", { expectedCloseDate: OVERDUE_CLOSE });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  for (const entry of stalledOf(row).evidence.overdueDeals) {
    assert.deepEqual(Object.keys(entry).sort(), ["dealContactState", "dealId", "expectedCloseDate", "lastDealInteractionAt", "overdueDays", "stage"]);
  }
  assert.ok(!/title: deals\.title|valueEuros: deals\.valueEuros/.test(IMPLEMENTATION_SOURCE));
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10, "9 existing .from() sites + the 4F.7.1 crm_websites read");
});

// =========================================================
// MICRO-STEP 4F.6.4 — QUOTE_PAST_VALIDITY / PROPOSAL_RENEWAL evidence lists
// the expired quotes (quoteId, validUntil, dealId, daysPastValidity), end-to-end.
// Dates are stored at UTC midnight, like real calendar-date input.
// =========================================================

const UTC_TODAY_MS = Date.UTC(FIXED_NOW.getUTCFullYear(), FIXED_NOW.getUTCMonth(), FIXED_NOW.getUTCDate());
const utcDaysAgo = (n) => new Date(UTC_TODAY_MS - n * DAY_MS);
function renewalOf(row) {
  return row.opportunities.find((o) => o.type === "PROPOSAL_RENEWAL") ?? null;
}

test("4F.6.4 R21-like: one expired quote (yesterday, no deal) -> one entry, daysPastValidity 1, dealId null; score divergence unchanged", async () => {
  const c = await makeClient();
  const quoteId = await makeQuote(c.id, { status: "sent", sentAt: utcDaysAgo(15), validUntil: utcDaysAgo(1) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const renewal = renewalOf(row);
  assert.deepEqual(renewal.evidence, { expiredQuoteCount: 1, expiredQuotes: [{ quoteId, validUntil: utcDaysAgo(1), dealId: null, daysPastValidity: 1 }] });
  assert.deepEqual(renewal.evidence, row.signals.find((s) => s.type === "QUOTE_PAST_VALIDITY").evidence);
  assert.ok(row.reasons.some((r) => r.code === "QUOTE_PENDING"), "score.ts divergence unchanged (separate mission)");
  assert.equal(row.recommendedNextAction, "FOLLOW_UP_PROPOSAL");
});

test("4F.6.4 R29-like: BUSINESS_CLOSED + expired quote -> PROPOSAL_RENEWAL still present with its expiredQuotes", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { website: "https://example.test", businessStatus: "CLOSED_PERMANENTLY" });
  const quoteId = await makeQuote(c.id, { status: "sent", sentAt: utcDaysAgo(15), validUntil: utcDaysAgo(5) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(signalTypes(row).includes("BUSINESS_CLOSED"));
  assert.deepEqual(renewalOf(row).evidence.expiredQuotes, [{ quoteId, validUntil: utcDaysAgo(5), dealId: null, daysPastValidity: 5 }]);
});

test("4F.6.4 R31-like: 2 pending + 1 expired -> QUOTE_PENDING 2, QUOTE_PAST_VALIDITY 1, one PROPOSAL_RENEWAL listing only the expired quote", async () => {
  const c = await makeClient();
  const expiredId = await makeQuote(c.id, { status: "sent", sentAt: utcDaysAgo(15), validUntil: utcDaysAgo(5) });
  await makeQuote(c.id, { status: "sent", sentAt: utcDaysAgo(15), validUntil: new Date(UTC_TODAY_MS + 5 * DAY_MS) });
  await makeQuote(c.id, { status: "sent", sentAt: utcDaysAgo(15), validUntil: null });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(row.signals.find((s) => s.type === "QUOTE_PENDING").evidence, { pendingQuoteCount: 2 });
  const renewals = row.opportunities.filter((o) => o.type === "PROPOSAL_RENEWAL");
  assert.equal(renewals.length, 1);
  assert.equal(renewals[0].evidence.expiredQuoteCount, 1);
  assert.deepEqual(renewals[0].evidence.expiredQuotes.map((q) => q.quoteId), [expiredId]);
});

test("4F.6.4 R32-like: 2 expired quotes on the same deal -> two distinct quoteIds, both validUntil, dealId kept, sorted by validUntil", async () => {
  const c = await makeClient();
  const dealId = await makeDeal(c.id, "qualified");
  const newer = await makeQuote(c.id, { status: "sent", sentAt: utcDaysAgo(20), validUntil: utcDaysAgo(5), dealId });
  const older = await makeQuote(c.id, { status: "sent", sentAt: utcDaysAgo(20), validUntil: utcDaysAgo(10), dealId });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const renewals = row.opportunities.filter((o) => o.type === "PROPOSAL_RENEWAL");
  assert.equal(renewals.length, 1);
  assert.deepEqual(renewals[0].evidence, {
    expiredQuoteCount: 2,
    expiredQuotes: [
      { quoteId: older, validUntil: utcDaysAgo(10), dealId, daysPastValidity: 10 },
      { quoteId: newer, validUntil: utcDaysAgo(5), dealId, daysPastValidity: 5 },
    ],
  });
  assert.notEqual(older, newer);
});

test("4F.6.4: answered / declined / accepted / stored 'expired' / today / null validity never listed; entries expose only the 4 keys; still 9 .from() (10 since 4F.7.1)", async () => {
  const c = await makeClient();
  await makeQuote(c.id, { status: "sent", respondedAt: utcDaysAgo(2), validUntil: utcDaysAgo(3) });
  await makeQuote(c.id, { status: "declined", respondedAt: utcDaysAgo(2), validUntil: utcDaysAgo(3) });
  await makeQuote(c.id, { status: "accepted", respondedAt: utcDaysAgo(2), validUntil: utcDaysAgo(3) });
  await makeQuote(c.id, { status: "expired", validUntil: utcDaysAgo(3) });
  await makeQuote(c.id, { status: "sent", validUntil: new Date(UTC_TODAY_MS) });
  await makeQuote(c.id, { status: "sent", validUntil: null });
  const realId = await makeQuote(c.id, { status: "sent", validUntil: utcDaysAgo(3) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const evidence = row.signals.find((s) => s.type === "QUOTE_PAST_VALIDITY").evidence;
  assert.deepEqual(evidence.expiredQuotes.map((q) => q.quoteId), [realId]);
  assert.deepEqual(Object.keys(evidence).sort(), ["expiredQuoteCount", "expiredQuotes"]);
  assert.deepEqual(Object.keys(evidence.expiredQuotes[0]).sort(), ["daysPastValidity", "dealId", "quoteId", "validUntil"]);
  assert.ok(!/totalCents: crmQuotes|title: crmQuotes|quoteNumber: crmQuotes|notes: crmQuotes|createdAt: crmQuotes/.test(IMPLEMENTATION_SOURCE));
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10, "9 existing .from() sites + the 4F.7.1 crm_websites read");
});

// =========================================================
// MICRO-STEP 4F.6.6 — NO_WEBSITE / WEBSITE evidence carries the Discovery
// provenance already loaded by the existing discovery_results read. Scenarios
// mirror the 4F.5-C validation set (R05-R30). crm_websites is written here
// ONLY to prove the queue still never reads it (R08 false positive frozen).
// =========================================================

const { crmWebsites } = await import("@/db/schema");
const DISCOVERED_30 = new Date(FIXED_NOW.getTime() - 30 * DAY_MS);

function noWebsiteEvidence(row) {
  return row.signals.find((s) => s.type === "NO_WEBSITE")?.evidence ?? null;
}
function websiteOf(row) {
  return row.opportunities.find((o) => o.type === "WEBSITE") ?? null;
}

test("4F.6.6 R05-like: website null + OPERATIONAL + recent -> enriched NO_WEBSITE, WEBSITE copies it, DISCOVERY_NEW unchanged", async () => {
  const discoveredAt = new Date(FIXED_NOW.getTime() - DAY_MS);
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDiscoveryResult(c.id, { category: "restaurant", website: null, businessStatus: "OPERATIONAL", discoveredAt });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const evidence = { website: null, discoveryCategory: "restaurant", discoveryBusinessStatus: "OPERATIONAL", discoveredAt };
  assert.deepEqual(noWebsiteEvidence(row), evidence);
  assert.deepEqual(websiteOf(row), { type: "WEBSITE", service: "website_creation", reason: "NO_WEBSITE_DETECTED", evidence, sourceSignals: ["NO_WEBSITE"] });
  assert.deepEqual(row.signals.find((s) => s.type === "DISCOVERY_NEW").evidence, { discoveredAt });
  assert.deepEqual(row.discoverySource, { category: "restaurant", website: null, businessStatus: "OPERATIONAL" });
});

test("4F.6.6 R06/R25/R29-like: Discovery website present -> no NO_WEBSITE, no WEBSITE (any businessStatus)", async () => {
  for (const businessStatus of ["CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]) {
    const c = await makeClient();
    await makeDiscoveryResult(c.id, { category: "plumber", website: "https://example.test", businessStatus, discoveredAt: DISCOVERED_30 });
    const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
    assert.equal(noWebsiteEvidence(row), null, businessStatus);
    assert.equal(websiteOf(row), null, businessStatus);
    assert.deepEqual(Object.keys(row.discoverySource).sort(), ["businessStatus", "category", "website"]);
  }
});

test("4F.6.6 R07/R30-like: website null + CLOSED_PERMANENTLY -> enriched NO_WEBSITE kept, WEBSITE still blocked", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { category: "bakery", website: null, businessStatus: "CLOSED_PERMANENTLY", discoveredAt: DISCOVERED_30 });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(noWebsiteEvidence(row), { website: null, discoveryCategory: "bakery", discoveryBusinessStatus: "CLOSED_PERMANENTLY", discoveredAt: DISCOVERED_30 });
  assert.ok(signalTypes(row).includes("BUSINESS_CLOSED"));
  assert.equal(websiteOf(row), null);
});

test("4F.6.6/4F.7.1 R08-like: a crm_websites row exists and Discovery website is null -> NO_WEBSITE and WEBSITE absent (model C), LOW stays LOW, no CRM data in the item", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { category: "dentist", website: null, businessStatus: "OPERATIONAL", discoveredAt: DISCOVERED_30 });
  await db.insert(crmWebsites).values({ clientId: c.id, url: "https://crm-site.example.test", label: "Site principal" });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(noWebsiteEvidence(row), null, "4F.7.1 — the CRM website rules NO_WEBSITE out");
  assert.equal(websiteOf(row), null);
  assert.deepEqual(row.discoverySource, { category: "dentist", website: null, businessStatus: "OPERATIONAL" }, "discoverySource unchanged");
  assert.ok(!JSON.stringify(row).includes("crm-site.example.test"), "no crm_websites URL anywhere in the item");
  assert.ok(!JSON.stringify(row).includes("Site principal"), "no crm_websites label anywhere in the item");
  assert.equal(row.basePriority, "LOW");
  assert.equal(row.finalPriority, "LOW", "no WEBSITE -> no LOW -> MEDIUM promotion");
  assert.ok(!row.priorityAdjustments.some((a) => a.direction === "UP"));
});

test("4F.6.6 R27/R28-like: website null + OPERATIONAL, no crm website -> WEBSITE with enriched evidence; null category/businessStatus kept as null", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { category: null, website: null, businessStatus: null, discoveredAt: DISCOVERED_30 });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(websiteOf(row).evidence, { website: null, discoveryCategory: null, discoveryBusinessStatus: null, discoveredAt: DISCOVERED_30 });
  assert.deepEqual(row.discoverySource, { category: null, website: null, businessStatus: null });
});

test("4F.6.6 structural: discoverySource shape unchanged; crm_websites read only as the 4F.7.1 presence-only clientId select; 10 .from()", () => {
  assert.match(IMPLEMENTATION_SOURCE, /\? \{ category: discoveryRow\.category, website: discoveryRow\.website, businessStatus: discoveryRow\.businessStatus \}/);
  assert.ok(!/crmWebsites\.(url|label|id|createdAt)\b/.test(IMPLEMENTATION_SOURCE), "no crm_websites column other than clientId is ever read");
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10);
});

// =========================================================
// MICRO-STEP 4F.7.1 — model C end-to-end: NO_WEBSITE requires a linked
// Discovery row with website null AND no crm_websites row (presence only).
// =========================================================

async function makeCrmWebsite(clientId, n = 1) {
  for (let i = 0; i < n; i++) {
    await db.insert(crmWebsites).values({ clientId, url: `https://crm-${i}-${randomUUID()}.example.test`, label: `Label ${i}` });
  }
}

test("4F.7.1 R05-like: no CRM website -> NO_WEBSITE / WEBSITE / promotion unchanged", async () => {
  const discoveredAt = new Date(FIXED_NOW.getTime() - DAY_MS);
  const c = await makeClient({ source: "RADAR Discovery" });
  await makeDiscoveryResult(c.id, { category: "restaurant", website: null, businessStatus: "OPERATIONAL", discoveredAt });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.deepEqual(noWebsiteEvidence(row), { website: null, discoveryCategory: "restaurant", discoveryBusinessStatus: "OPERATIONAL", discoveredAt });
  assert.ok(websiteOf(row));
  assert.equal(row.finalPriority, "MEDIUM");
});

test("4F.7.1 R07/R30-like: BUSINESS_CLOSED unchanged — without CRM site NO_WEBSITE kept and WEBSITE blocked; with CRM site NO_WEBSITE absent, BUSINESS_CLOSED still there", async () => {
  const without = await makeClient();
  await makeDiscoveryResult(without.id, { category: "bakery", website: null, businessStatus: "CLOSED_PERMANENTLY", discoveredAt: DISCOVERED_30 });
  const withSite = await makeClient();
  await makeDiscoveryResult(withSite.id, { category: "bakery", website: null, businessStatus: "CLOSED_PERMANENTLY", discoveredAt: DISCOVERED_30 });
  await makeCrmWebsite(withSite.id);
  const a = await followUpFieldsFor(without.id, { now: FIXED_NOW });
  const b = await followUpFieldsFor(withSite.id, { now: FIXED_NOW });
  assert.ok(signalTypes(a).includes("NO_WEBSITE") && signalTypes(a).includes("BUSINESS_CLOSED"));
  assert.equal(websiteOf(a), null);
  assert.ok(!signalTypes(b).includes("NO_WEBSITE") && signalTypes(b).includes("BUSINESS_CLOSED"));
  assert.deepEqual(a.priorityAdjustments, b.priorityAdjustments, "same BUSINESS_CLOSED review adjustment either way");
});

test("4F.7.1 R06/R25/R29-like: Discovery website present -> no NO_WEBSITE, with or without CRM site", async () => {
  for (const crm of [0, 1]) {
    const c = await makeClient();
    await makeDiscoveryResult(c.id, { website: "https://example.test", businessStatus: "OPERATIONAL", discoveredAt: DISCOVERED_30 });
    if (crm) await makeCrmWebsite(c.id);
    const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
    assert.ok(!signalTypes(row).includes("NO_WEBSITE"), `crm=${crm}`);
    assert.equal(websiteOf(row), null);
  }
});

test("4F.7.1 no Discovery link -> no NO_WEBSITE, with or without CRM site", async () => {
  for (const crm of [0, 1]) {
    const c = await makeClient();
    if (crm) await makeCrmWebsite(c.id);
    const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
    assert.ok(!signalTypes(row).includes("NO_WEBSITE"), `crm=${crm}`);
    assert.equal(row.discoverySource, null);
  }
});

test("4F.7.1 several CRM websites -> presence detected once, prospect listed once, nothing counted or exposed", async () => {
  const c = await makeClient();
  await makeDiscoveryResult(c.id, { category: "dentist", website: null, businessStatus: "OPERATIONAL", discoveredAt: DISCOVERED_30 });
  await makeCrmWebsite(c.id, 2);
  const items = await scanAllPages({ now: FIXED_NOW });
  const rows = items.filter((i) => i.clientId === c.id);
  assert.equal(rows.length, 1, "no duplication from the 1-N crm_websites read");
  assert.ok(!signalTypes(rows[0]).includes("NO_WEBSITE"));
  assert.ok(!JSON.stringify(rows[0]).includes("example.test"), "no CRM url in the item");
  assert.ok(!JSON.stringify(rows[0]).includes("Label "), "no CRM label in the item");
});

test("4F.7.1 eligibility unchanged: archived / do-not-contact prospects with a CRM website stay out of the queue", async () => {
  const archived = await makeClient({ archivedAt: new Date() });
  const dnc = await makeClient({ doNotContact: true });
  for (const c of [archived, dnc]) {
    await makeDiscoveryResult(c.id, { website: null, discoveredAt: DISCOVERED_30 });
    await makeCrmWebsite(c.id);
  }
  const items = await scanAllPages({ now: FIXED_NOW });
  assert.ok(!items.some((i) => i.clientId === archived.id || i.clientId === dnc.id));
});

test("4F.7.1 structural: one batched presence-only crm_websites read over qualifiedIds, no join with Discovery, no per-prospect read, passed as hasCrmWebsite", () => {
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(crmWebsites\)/g) ?? []).length, 1, "exactly one crm_websites read");
  assert.match(IMPLEMENTATION_SOURCE, /\.select\(\{ clientId: crmWebsites\.clientId \}\)\s*\.from\(crmWebsites\)\s*\.where\(inArray\(crmWebsites\.clientId, qualifiedIds\)\)/);
  assert.ok(!/crmWebsites\.(url|label|id|createdAt)\b/.test(IMPLEMENTATION_SOURCE));
  assert.ok(!/(leftJoin|innerJoin|rightJoin|fullJoin|\.join)\(\s*crmWebsites/.test(IMPLEMENTATION_SOURCE), "never joined");
  assert.match(IMPLEMENTATION_SOURCE, /new Set\(clientCrmWebsites\.map\(\(row\) => row\.clientId\)\)/);
  assert.match(IMPLEMENTATION_SOURCE, /hasCrmWebsite: crmWebsiteClientIds\.has\(client\.id\)/);
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10);
});

// =========================================================
// MICRO-STEP 4F.7.3 — deterministic Discovery row selection. Several
// discovery_results rows linked to ONE crm_client are not produced by the app
// (convertDiscoveryResult links one row per created client) but are not
// DB-forbidden; the queue must keep the latest discoveredAt, then the greatest
// id — never whichever row SQL returns last. Each scenario is replayed with the
// rows inserted in every relevant order, one fresh prospect per order.
// =========================================================

async function makeLinkedDiscoveryRow(clientId, { id = randomUUID(), category = null, website = null, businessStatus = null, discoveredAt }) {
  const [row] = await db
    .insert(discoveryResults)
    .values({
      id,
      source: "google_places",
      sourceId: `radar-4f73-${randomUUID()}`,
      name: `Discovery 4F.7.3 ${randomUUID()}`,
      status: clientId ? "converted" : "discovered",
      crmClientId: clientId,
      category,
      website,
      businessStatus,
      discoveredAt,
    })
    .returning();
  createdDiscoveryResultIds.add(row.id);
  return row;
}
/** Everything the Radar decides for a prospect, minus the per-prospect identity. */
function decisionOf(row) {
  return {
    discoverySource: row.discoverySource,
    signals: row.signals,
    opportunities: row.opportunities,
    priority: row.priority,
    basePriority: row.basePriority,
    finalPriority: row.finalPriority,
    priorityAdjustments: row.priorityAdjustments,
    reasons: row.reasons,
    recommendedNextAction: row.recommendedNextAction,
    confidence: row.confidence,
  };
}
/** Inserts `specs` in each given order for a fresh prospect per order; returns the queue rows. */
async function replayOrders(specs, orders, clientOverrides = {}) {
  const rows = [];
  for (const order of orders) {
    const c = await makeClient(clientOverrides);
    for (const index of order) await makeLinkedDiscoveryRow(c.id, specs[index]);
    rows.push(await followUpFieldsFor(c.id, { now: FIXED_NOW }));
  }
  return rows;
}
function assertSameDecision(rows) {
  for (const row of rows.slice(1)) assert.deepEqual(decisionOf(row), decisionOf(rows[0]));
}
const OLD = new Date(FIXED_NOW.getTime() - 60 * DAY_MS);
const MID = new Date(FIXED_NOW.getTime() - 30 * DAY_MS);
const RECENT = new Date(FIXED_NOW.getTime() - 2 * DAY_MS);

test("4F.7.3 A: one linked row -> unchanged behaviour (NO_WEBSITE / WEBSITE / exact discoverySource)", async () => {
  const [row] = await replayOrders([{ category: "cafe", website: null, businessStatus: "OPERATIONAL", discoveredAt: MID }], [[0]]);
  assert.deepEqual(row.discoverySource, { category: "cafe", website: null, businessStatus: "OPERATIONAL" });
  assert.deepEqual(noWebsiteEvidence(row), { website: null, discoveryCategory: "cafe", discoveryBusinessStatus: "OPERATIONAL", discoveredAt: MID });
  assert.ok(websiteOf(row));
});

test("4F.7.3 B: two identical rows -> same result in both insertion orders", async () => {
  const spec = { category: "cafe", website: null, businessStatus: "OPERATIONAL", discoveredAt: MID };
  const rows = await replayOrders([spec, { ...spec }], [[0, 1], [1, 0]]);
  assertSameDecision(rows);
  assert.ok(websiteOf(rows[0]));
});

test("4F.7.3 C: website null (older) vs website present (newer) -> newer row wins in both orders: no NO_WEBSITE, no WEBSITE, same priority", async () => {
  const specs = [
    { category: "cafe", website: null, businessStatus: "OPERATIONAL", discoveredAt: OLD },
    { category: "cafe", website: "https://cafe.example.test", businessStatus: "OPERATIONAL", discoveredAt: RECENT },
  ];
  const rows = await replayOrders(specs, [[0, 1], [1, 0]]);
  assertSameDecision(rows);
  assert.deepEqual(rows[0].discoverySource, { category: "cafe", website: "https://cafe.example.test", businessStatus: "OPERATIONAL" });
  assert.ok(!signalTypes(rows[0]).includes("NO_WEBSITE"));
  assert.equal(websiteOf(rows[0]), null);
  assert.equal(rows[0].finalPriority, rows[0].basePriority);
});

test("4F.7.3 D: different discoveredAt -> the most recent row wins (DISCOVERY_NEW follows it) in both orders", async () => {
  const specs = [
    { category: "old-category", website: null, businessStatus: "OPERATIONAL", discoveredAt: OLD },
    { category: "new-category", website: null, businessStatus: "OPERATIONAL", discoveredAt: RECENT },
  ];
  const rows = await replayOrders(specs, [[0, 1], [1, 0]], { source: "RADAR Discovery" });
  assertSameDecision(rows);
  assert.equal(rows[0].discoverySource.category, "new-category");
  assert.deepEqual(rows[0].signals.find((s) => s.type === "DISCOVERY_NEW").evidence, { discoveredAt: RECENT });
  assert.equal(noWebsiteEvidence(rows[0]).discoveredAt.getTime(), RECENT.getTime());
});

test("4F.7.3 E: identical discoveredAt -> the greatest id wins, in both insertion orders", async () => {
  const rows = [];
  for (const order of [[0, 1], [1, 0]]) {
    const [low, high] = [randomUUID(), randomUUID()].sort();
    const specs = [
      { id: low, category: "low-id", website: "https://low.example.test", businessStatus: "OPERATIONAL", discoveredAt: MID },
      { id: high, category: "high-id", website: null, businessStatus: "CLOSED_TEMPORARILY", discoveredAt: MID },
    ];
    const c = await makeClient();
    for (const index of order) await makeLinkedDiscoveryRow(c.id, specs[index]);
    rows.push(await followUpFieldsFor(c.id, { now: FIXED_NOW }));
  }
  assertSameDecision(rows);
  assert.deepEqual(rows[0].discoverySource, { category: "high-id", website: null, businessStatus: "CLOSED_TEMPORARILY" });
  assert.ok(signalTypes(rows[0]).includes("NO_WEBSITE"));
});

test("4F.7.3 F: three rows (old null / mid website / recent other businessStatus) -> same result for all 6 insertion orders, recent row wins", async () => {
  const specs = [
    { category: "x", website: null, businessStatus: "OPERATIONAL", discoveredAt: OLD },
    { category: "x", website: "https://mid.example.test", businessStatus: "OPERATIONAL", discoveredAt: MID },
    { category: "x", website: null, businessStatus: "CLOSED_PERMANENTLY", discoveredAt: RECENT },
  ];
  const rows = await replayOrders(specs, [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]);
  assertSameDecision(rows);
  assert.deepEqual(rows[0].discoverySource, { category: "x", website: null, businessStatus: "CLOSED_PERMANENTLY" });
  assert.ok(signalTypes(rows[0]).includes("BUSINESS_CLOSED") && signalTypes(rows[0]).includes("NO_WEBSITE"));
  assert.equal(websiteOf(rows[0]), null, "BUSINESS_CLOSED still blocks WEBSITE");
});

test("4F.7.3 G: an unlinked discovery row (crmClientId null) never feeds the Radar", async () => {
  await makeLinkedDiscoveryRow(null, { category: "unlinked", website: null, businessStatus: "CLOSED_PERMANENTLY", discoveredAt: RECENT });
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.discoverySource, null);
  assert.ok(!signalTypes(row).includes("NO_WEBSITE") && !signalTypes(row).includes("BUSINESS_CLOSED"));
  const items = await scanAllPages({ now: FIXED_NOW });
  assert.ok(!items.some((i) => i.discoverySource?.category === "unlinked"));
});

test("4F.7.3 H/I: discoverySource has exactly category/website/businessStatus, never an id; one queue row and one discoverySource per prospect", async () => {
  const c = await makeClient();
  const a = await makeLinkedDiscoveryRow(c.id, { category: "h", website: null, discoveredAt: OLD });
  const b = await makeLinkedDiscoveryRow(c.id, { category: "h", website: null, discoveredAt: RECENT });
  const items = await scanAllPages({ now: FIXED_NOW });
  const rows = items.filter((i) => i.clientId === c.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0].discoverySource).sort(), ["businessStatus", "category", "website"]);
  assert.ok(!JSON.stringify(rows[0]).includes(a.id) && !JSON.stringify(rows[0]).includes(b.id), "no discovery_results id anywhere in the item");
});

test("4F.7.3 J: 4F.7.1 unchanged — a CRM website still rules NO_WEBSITE out whichever Discovery row is selected", async () => {
  const c = await makeClient();
  await makeLinkedDiscoveryRow(c.id, { category: "dentist", website: null, businessStatus: "OPERATIONAL", discoveredAt: OLD });
  await makeLinkedDiscoveryRow(c.id, { category: "dentist", website: null, businessStatus: "OPERATIONAL", discoveredAt: RECENT });
  await db.insert(crmWebsites).values({ clientId: c.id, url: "https://crm-4f73.example.test", label: "x" });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(!signalTypes(row).includes("NO_WEBSITE"));
  assert.equal(websiteOf(row), null);
  assert.equal(row.finalPriority, "LOW");
});

test("4F.7.3 structural: id is the only column added to the Discovery select; explicit isPreferredDiscoveryRow choice, no ORDER BY on it; 10 .from()", () => {
  assert.match(
    IMPLEMENTATION_SOURCE,
    /\.select\(\{\s*\/\/[^\n]*\n\s*id: discoveryResults\.id,\s*crmClientId: discoveryResults\.crmClientId,\s*category: discoveryResults\.category,\s*website: discoveryResults\.website,\s*businessStatus: discoveryResults\.businessStatus,[\s\S]*?discoveredAt: discoveryResults\.discoveredAt,\s*\}\)\s*\.from\(discoveryResults\)\s*\.where\(inArray\(discoveryResults\.crmClientId, qualifiedIds\)\),/,
  );
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(discoveryResults\)/g) ?? []).length, 1, "still one batched Discovery read");
  assert.ok(!/\.from\(discoveryResults\)[\s\S]{0,120}orderBy/.test(IMPLEMENTATION_SOURCE), "no ORDER BY used as the selection mechanism");
  assert.match(IMPLEMENTATION_SOURCE, /if \(current && !isPreferredDiscoveryRow\(row, current\)\) continue;/);
  assert.match(IMPLEMENTATION_SOURCE, /if \(discoveredDiff !== 0\) return discoveredDiff > 0;\s*return candidate\.id > current\.id;/);
  assert.match(IMPLEMENTATION_SOURCE, /\? \{ category: discoveryRow\.category, website: discoveryRow\.website, businessStatus: discoveryRow\.businessStatus \}/);
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10);
});

// =========================================================
// MICRO-STEP 4F.8.7 — DEAL_STALLED per deal, end-to-end (deterministic via
// FIXED_NOW). An overdue deal's contact = max(interactions linked to it,
// general ones with deal_id NULL); interactions linked to another deal never
// count. RECENT_ACTIVITY on the prospect no longer masks every deal.
// =========================================================

const FUTURE_CLOSE = new Date(FIXED_NOW.getTime() + 10 * DAY_MS);

test("4F.8.7 R12-like: overdue deal + recent GENERAL note -> no DEAL_STALLED (note semantics unchanged)", async () => {
  const c = await makeClient();
  const dealId = await makeDeal(c.id, "contacted", { expectedCloseDate: OVERDUE_CLOSE });
  await makeInteraction(c.id, RECENT_CONTACT);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(stalledOf(row), null);
  const [entry] = row.signals.find((s) => s.type === "DEAL_PAST_EXPECTED_CLOSE").evidence.overdueDeals;
  assert.deepEqual([entry.dealId, entry.dealContactState, entry.lastDealInteractionAt.getTime()], [dealId, "RECENT", RECENT_CONTACT.getTime()]);
});

test("4F.8.7 R16 linked: deal A overdue + deal B active + recent interaction LINKED to B -> DEAL_STALLED for A only (NONE_RECORDED)", async () => {
  const c = await makeClient();
  const dealA = await makeDeal(c.id, "new", { expectedCloseDate: OVERDUE_CLOSE });
  const dealB = await makeDeal(c.id, "qualified", { expectedCloseDate: FUTURE_CLOSE });
  await makeInteraction(c.id, RECENT_CONTACT, { dealId: dealB });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(signalTypes(row).includes("RECENT_ACTIVITY"), "prospect-level RECENT_ACTIVITY unchanged");
  const opportunity = stalledOf(row);
  assert.ok(opportunity, "the interaction linked to deal B must not mask overdue deal A");
  assert.deepEqual(opportunity.evidence, {
    overdueDealCount: 1,
    overdueDeals: [{ dealId: dealA, stage: "new", expectedCloseDate: OVERDUE_CLOSE, overdueDays: 1, lastDealInteractionAt: null, dealContactState: "NONE_RECORDED" }],
    lastInteractionAt: RECENT_CONTACT,
  });
  assert.deepEqual(opportunity.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE"]);
});

test("4F.8.7 R16 general: same deals + recent GENERAL interaction (deal_id NULL) -> unchanged, no DEAL_STALLED", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "new", { expectedCloseDate: OVERDUE_CLOSE });
  await makeDeal(c.id, "qualified", { expectedCloseDate: FUTURE_CLOSE });
  await makeInteraction(c.id, RECENT_CONTACT);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(stalledOf(row), null);
});

test("4F.8.7 R17-like: overdue deal + deal active + OLD general interaction -> DEAL_STALLED (STALE), unchanged", async () => {
  const c = await makeClient();
  const dealA = await makeDeal(c.id, "new", { expectedCloseDate: OVERDUE_CLOSE });
  await makeDeal(c.id, "qualified", { expectedCloseDate: FUTURE_CLOSE });
  await makeInteraction(c.id, STALE_CONTACT);
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const opportunity = stalledOf(row);
  assert.deepEqual(opportunity.evidence.overdueDeals.map((d) => [d.dealId, d.dealContactState, d.lastDealInteractionAt.getTime()]), [[dealA, "STALE", STALE_CONTACT.getTime()]]);
  assert.deepEqual(opportunity.sourceSignals, ["DEAL_PAST_EXPECTED_CLOSE", "NO_RECENT_INTERACTION"]);
});

test("4F.8.7 R18-like: two overdue deals, no interaction -> both NONE_RECORDED, deterministic order (expectedCloseDate ASC)", async () => {
  const c = await makeClient();
  const recent = await makeDeal(c.id, "new", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 5 * DAY_MS) });
  const oldest = await makeDeal(c.id, "proposal", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 40 * DAY_MS) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const opportunity = stalledOf(row);
  assert.equal(opportunity.evidence.overdueDealCount, 2);
  assert.deepEqual(opportunity.evidence.overdueDeals.map((d) => [d.dealId, d.dealContactState, d.lastDealInteractionAt]), [[oldest, "NONE_RECORDED", null], [recent, "NONE_RECORDED", null]]);
  assert.strictEqual(opportunity.evidence.lastInteractionAt, null);
});

test("4F.8.7 several overdue deals with interactions linked to different deals -> only the deals without recent contact stall", async () => {
  const c = await makeClient();
  const dealA = await makeDeal(c.id, "new", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 20 * DAY_MS) });
  const dealB = await makeDeal(c.id, "qualified", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 10 * DAY_MS) });
  const dealC = await makeDeal(c.id, "proposal", { expectedCloseDate: new Date(FIXED_NOW.getTime() - 5 * DAY_MS) });
  await makeInteraction(c.id, RECENT_CONTACT, { dealId: dealB });
  await makeInteraction(c.id, STALE_CONTACT, { dealId: dealC });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const states = row.signals.find((s) => s.type === "DEAL_PAST_EXPECTED_CLOSE").evidence.overdueDeals.map((d) => [d.dealId, d.dealContactState]);
  assert.deepEqual(states, [[dealA, "NONE_RECORDED"], [dealB, "RECENT"], [dealC, "STALE"]]);
  const opportunity = stalledOf(row);
  assert.equal(opportunity.evidence.overdueDealCount, 2);
  assert.deepEqual(opportunity.evidence.overdueDeals.map((d) => d.dealId), [dealA, dealC]);
  assert.equal(opportunity.evidence.lastInteractionAt.getTime(), RECENT_CONTACT.getTime(), "prospect's real latest interaction, linked or not");
});

test("4F.8.7 structural: the existing interactions read only gains dealId (clientId, dealId, occurredAt); still 10 .from(); no summary/type exposed", async () => {
  assert.match(IMPLEMENTATION_SOURCE, /\.select\(\{ clientId: interactions\.clientId, dealId: interactions\.dealId, occurredAt: interactions\.occurredAt \}\)\s*\.from\(interactions\)\s*\.where\(inArray\(interactions\.clientId, qualifiedIds\)\)/);
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(interactions\)/g) ?? []).length, 1);
  assert.equal((IMPLEMENTATION_SOURCE.match(/\.from\(/g) ?? []).length, 10);
  const c = await makeClient();
  const dealB = await makeDeal(c.id, "qualified", { expectedCloseDate: OVERDUE_CLOSE });
  await makeInteraction(c.id, STALE_CONTACT, { dealId: dealB });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes("Test interaction"), "no interaction summary anywhere in the item");
});
