// Integration tests for AI Commercial Radar / Phase 1C:
// lib/actions/radar.ts's getProspectQualification() — proving, against a
// real local database, that:
// - requireStaffMember("RADAR_WORK") genuinely gates the action
//   (unauthenticated, CLIENT, and a Workforce identity with no ACTIVE
//   RADAR_WORK grant are all rejected at runtime, not just by a
//   page-level guard);
// - the strongest possible commercial signal (a proposal-stage deal)
//   never overrides a doNotContact=true hard block — the opportunity
//   engine is never even invoked for an ineligible prospect;
// - missing data never becomes a fabricated negative fact, end to end
//   through the real Server Action wiring, not just the isolated pure
//   functions already covered by lib/radar/qualification.test.mjs and
//   lib/radar/score.test.mjs.
//
// RADAR AXIS-C CLEANUP — the gate itself changed from the legacy Axis-A
// requireStaffRole() to requireStaffMember("RADAR_WORK") (Axis-C), the one
// function RADAR GATE UNIFICATION missed (radar-queue.ts / radar-
// assignment.ts were already migrated). The fixtures below changed to
// match: a REAL users.id with a REAL ACTIVE EMPLOYEE staff_members row
// for "staff", since requireStaffMember() resolves access exclusively
// from that table by session.userId — a hardcoded fake userId string (the
// previous STAFF_SESSION shape) would now be denied outright, since no
// real staff_members row could ever match it. Same conventions as
// lib/actions/radar-queue.integration.test.mjs.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-qualification.integration.test.mjs
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

/** @type {{ session: object | null }} */
let mockState = { session: null };
function actAsStaff() {
  mockState = { session: STAFF_SESSION };
}
function actAsSuspendedStaff() {
  mockState = { session: SUSPENDED_STAFF_SESSION };
}
function actAsClient() {
  mockState = { session: CLIENT_SESSION };
}
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
const { crmClients, deals, interactions, crmQuotes, crmInvoices, users, staffMembers, staffRoles, organizations } = await import("@/db/schema");
const { inArray, eq } = await import("drizzle-orm");
const { getProspectQualification } = await import("./radar.ts");

const createdClientIds = new Set();
const createdUserIds = new Set();
const createdStaffMemberIds = new Set();

async function makeUser({ fullName = null } = {}) {
  const [row] = await db
    .insert(users)
    .values({ clerkUserId: `radar_p1c_${randomUUID()}`, email: `radar-p1c-${randomUUID()}@example.test`, fullName, status: "active" })
    .returning();
  createdUserIds.add(row.id);
  return row;
}

let INTERNAL_ORG_ID;
async function internalOrgId() {
  if (INTERNAL_ORG_ID === undefined) {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
    INTERNAL_ORG_ID = org?.id ?? null;
  }
  return INTERNAL_ORG_ID;
}
const STAFF_ROLE_ID_CACHE = new Map();
async function staffRoleId(name) {
  if (!STAFF_ROLE_ID_CACHE.has(name)) {
    const [r] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
    STAFF_ROLE_ID_CACHE.set(name, r?.id ?? null);
  }
  return STAFF_ROLE_ID_CACHE.get(name);
}
async function makeStaffMember(userId, status, roleName = "EMPLOYEE") {
  const orgId = await internalOrgId();
  const roleId = await staffRoleId(roleName);
  if (!orgId || !roleId) return null;
  const [row] = await db.insert(staffMembers).values({ userId, workspaceOrgId: orgId, roleId, status }).returning();
  createdStaffMemberIds.add(row.id);
  return row;
}

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

let STAFF_SESSION, SUSPENDED_STAFF_SESSION, CLIENT_SESSION;

before(async () => {
  const employeeUser = await makeUser({ fullName: "Gate EMPLOYEE (RADAR_WORK)" });
  await makeStaffMember(employeeUser.id, "ACTIVE", "EMPLOYEE");
  STAFF_SESSION = sessionFor(employeeUser, "staff");

  // Every StaffRole in the current catalogue (OWNER/ADMIN/MANAGER/EMPLOYEE)
  // holds RADAR_WORK (lib/rbac/permissions.ts) — there is no role that
  // lacks it. A SUSPENDED staff_members row is the faithful real-world
  // shape of "Workforce identity with no ACTIVE RADAR_WORK grant":
  // evaluateStaffPermission() denies it at "inactive-membership", before
  // the permission catalogue is even consulted.
  const suspendedUser = await makeUser({ fullName: "Gate SUSPENDED EMPLOYEE (no active RADAR_WORK)" });
  await makeStaffMember(suspendedUser.id, "SUSPENDED", "EMPLOYEE");
  SUSPENDED_STAFF_SESSION = sessionFor(suspendedUser, "staff");

  // Zero staff_members row: a pure CLIENT identity.
  CLIENT_SESSION = sessionFor(await makeUser({ fullName: "Gate CLIENT no Axis-C" }), "client");
});

beforeEach(() => {
  actAsStaff();
});

after(async () => {
  if (createdClientIds.size) await db.delete(deals).where(inArray(deals.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(interactions).where(inArray(interactions.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const [client] = await db
    .insert(crmClients)
    .values({
      name: overrides.name === undefined ? `Radar P1C Test ${randomUUID()}` : overrides.name,
      email: overrides.email === undefined ? "prospect@example.test" : overrides.email,
      phone: overrides.phone ?? null,
      industry: overrides.industry ?? null,
      country: overrides.country ?? null,
      region: overrides.region ?? null,
      city: overrides.city ?? null,
      doNotContact: overrides.doNotContact ?? false,
      doNotContactReason: overrides.doNotContactReason ?? null,
      archivedAt: overrides.archivedAt ?? null,
    })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDeal(clientId, stage) {
  await db.insert(deals).values({ clientId, title: `Deal ${randomUUID()}`, stage });
}

async function makeQuote(clientId, { status, sentAt = null, respondedAt = null }) {
  await db.insert(crmQuotes).values({ clientId, quoteNumber: `Q-${randomUUID()}`, title: "Test quote", status, sentAt, respondedAt });
}

async function makeInvoice(clientId, { paidAt = null }) {
  await db.insert(crmInvoices).values({ clientId, invoiceNumber: `INV-${randomUUID()}`, title: "Test invoice", paidAt });
}

async function makeInteraction(clientId, occurredAt) {
  await db.insert(interactions).values({ clientId, type: "note", summary: "Test interaction", occurredAt });
}

// =========================================================
// Authorization — runtime proof, not textual checks
// =========================================================

test("UNAUTHENTICATED getProspectQualification: rejected", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => getProspectQualification(client.id));
});

test("NON-STAFF getProspectQualification: rejected", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => getProspectQualification(client.id));
});

test("Workforce sans RADAR_WORK actif (staff_members SUSPENDED) getProspectQualification: rejected", async () => {
  const client = await makeClient();
  actAsSuspendedStaff();
  await assert.rejects(() => getProspectQualification(client.id));
});

test("STAFF getProspectQualification: succeeds for a simple qualified prospect", async () => {
  const client = await makeClient({ name: "Staff OK Test", email: "ok@example.test" });
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "QUALIFIED");
  assert.equal(result.eligibility.contactable, true);
  assert.ok(result.opportunity !== null);
});

// =========================================================
// Qualification / eligibility wiring
// =========================================================

test("a nonexistent clientId is rejected", async () => {
  await assert.rejects(() => getProspectQualification(randomUUID()));
});

test("INSUFFICIENT_DATA: name only, no email or phone — opportunity is never computed", async () => {
  const client = await makeClient({ email: null, phone: null });
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "INSUFFICIENT_DATA");
  assert.equal(result.opportunity, null);
});

test("NOT_ELIGIBLE: archived prospect — opportunity is never computed", async () => {
  const client = await makeClient({ archivedAt: new Date() });
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "NOT_ELIGIBLE");
  assert.equal(result.eligibility.contactable, false);
  assert.equal(result.opportunity, null);
});

// ---- THE critical Phase 1C requirement: strongest signal + doNotContact ----
test("doNotContact=true blocks even the strongest possible commercial signal (proposal-stage deal + accepted quote + paid invoice)", async () => {
  const client = await makeClient({ doNotContact: true, doNotContactReason: "Explicit opt-out on file" });
  await makeDeal(client.id, "proposal");
  await makeQuote(client.id, { status: "accepted", sentAt: new Date(), respondedAt: new Date() });
  await makeInvoice(client.id, { paidAt: new Date() });

  const result = await getProspectQualification(client.id);

  assert.equal(result.qualificationStatus, "NOT_ELIGIBLE");
  assert.equal(result.eligibility.contactable, false);
  assert.equal(result.eligibility.reason, "do_not_contact");
  assert.equal(result.opportunity, null, "the opportunity engine must never be invoked for a doNotContact=true prospect, no matter how strong the underlying signals are");
});

// =========================================================
// Opportunity wiring against real data
// =========================================================

test("a real proposal-stage deal produces HIGH priority end-to-end", async () => {
  const client = await makeClient();
  await makeDeal(client.id, "proposal");
  const result = await getProspectQualification(client.id);
  assert.equal(result.qualificationStatus, "QUALIFIED");
  assert.equal(result.opportunity.priority, "HIGH");
  // RADAR-CORE-3F — reasons are semantic descriptors, not prose.
  assert.ok(result.opportunity.reasons.some((r) => r.code === "DEAL_STAGE_PROPOSAL"));
});

test("HIGH priority + LOW confidence is representable end-to-end (proposal deal, no other profile data)", async () => {
  const client = await makeClient({ industry: null, country: null, region: null, city: null });
  await makeDeal(client.id, "proposal");
  const result = await getProspectQualification(client.id);
  assert.equal(result.opportunity.priority, "HIGH");
  assert.equal(result.opportunity.confidence, "LOW");
});

// =========================================================
// Anti-hallucination — real DB round trip
// =========================================================

// RADAR-CORE-3F — the engine emits semantic RadarReason descriptors
// (`{ code }`, plus `value` on the two "recorded" codes) and a
// RadarNextActionCode, never prose. The anti-hallucination intent below is
// preserved at the code level; the FR/EN prose "no predictive language"
// guarantee lives in lib/radar/radar-copy.test.mjs.
const CODE_SHAPE = /^[A-Z][A-Z_]*$/;

test("null industry produces no industry-based reason (real row)", async () => {
  const client = await makeClient({ industry: null });
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => r.code === "INDUSTRY_RECORDED"));
});

test("null geography produces no location-based reason (real row)", async () => {
  const client = await makeClient({ country: null, region: null, city: null });
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => r.code === "LOCATION_RECORDED"));
});

test("no interactions never produces a 'not interested' style claim (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(result.opportunity.reasons.some((r) => r.code === "INTERACTION_NONE"));
  assert.ok(!result.opportunity.reasons.some((r) => /INTERESTED|INTENT|UNLIKELY/.test(r.code)));
});

test("no deal never produces a 'low intent' style claim (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => r.code.startsWith("DEAL_")));
});

test("no quote never produces a fabricated proposal/accepted reason (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => r.code.startsWith("QUOTE_")));
});

test("no invoice never produces a fabricated conversion reason (real row)", async () => {
  const client = await makeClient();
  const result = await getProspectQualification(client.id);
  assert.ok(!result.opportunity.reasons.some((r) => r.code === "PAID_INVOICE"));
});

test("the engine emits ONLY semantic codes across a fully-populated real prospect — never prose or a service recommendation", async () => {
  const client = await makeClient({ industry: "Boulangerie", country: "France", city: "Lyon" });
  await makeDeal(client.id, "qualified");
  await makeQuote(client.id, { status: "sent", sentAt: new Date(), respondedAt: null });
  await makeInteraction(client.id, new Date());
  await makeInvoice(client.id, { paidAt: null });

  const result = await getProspectQualification(client.id);

  for (const r of result.opportunity.reasons) {
    assert.match(r.code, CODE_SHAPE, `reason "${r.code}" must be an ALL_CAPS code, never prose`);
  }
  assert.match(result.opportunity.recommendedNextAction, CODE_SHAPE);
});

// =========================================================
// Determinism
// =========================================================

test("calling getProspectQualification twice for the same real prospect produces identical output", async () => {
  const client = await makeClient({ industry: "Santé", city: "Toulouse" });
  await makeDeal(client.id, "qualified");
  await makeQuote(client.id, { status: "sent", sentAt: new Date("2026-08-01T00:00:00Z"), respondedAt: null });

  const first = await getProspectQualification(client.id);
  const second = await getProspectQualification(client.id);
  assert.deepEqual(first, second);
});
