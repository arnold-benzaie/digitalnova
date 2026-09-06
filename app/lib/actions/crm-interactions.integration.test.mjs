// Integration tests for AI Commercial Radar / Phase 1F:
// lib/actions/crm-interactions.ts's createInteraction() — proving, against
// a real local database, the Phase 1F-A.2 canonical type x direction x
// outcome write matrix, DNC enforcement, auth-first authorization,
// anti-hallucination guarantees, structured audit metadata, and the
// append-only/no-dedup nature of the interaction log.
//
// Same mocking convention as radar-assignment.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session
// state, and the REAL requireStaffMember("RADAR_WORK") (Axis-C, never
// mocked) runs against real seeded users / staff_members rows in the
// local internal workspace (RADAR-CORE-2A-A).
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-interactions.integration.test.mjs
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

// RADAR-CORE-2A-A — createInteraction()'s human gate is now
// requireStaffMember("RADAR_WORK") (Axis-C) + requireSession() for the
// authoritative author id. So the "staff" identity here must be a REAL
// users.id with a real ACTIVE staff_members row in the internal
// workspace; a plain string userId would fail the uuid FK / the
// membership lookup. Seeded once in before() below and torn down in
// after().
const STAFF_USER_ID = randomUUID(); // ACTIVE EMPLOYEE — the default actor
const MANAGER_USER_ID = randomUUID(); // ACTIVE MANAGER
const SUSPENDED_USER_ID = randomUUID(); // SUSPENDED EMPLOYEE — must be denied
const NON_STAFF_USER_ID = randomUUID(); // authenticated but no staff_members row

function sessionFor(userId, role = "staff") {
  return {
    userId,
    clerkUserId: `test_clerk_${userId}`,
    email: `${userId}@example.test`,
    fullName: "Test Person",
    firstName: "Test",
    organizationId: "test-org",
    organizationName: "Test Org",
    role,
    previousLastLoginAt: null,
  };
}
const STAFF_SESSION = sessionFor(STAFF_USER_ID);
const CLIENT_SESSION = sessionFor(NON_STAFF_USER_ID, "client");

/** @type {{ session: object | null }} */
let mockState = { session: STAFF_SESSION };
function actAsStaff() {
  mockState = { session: STAFF_SESSION };
}
function actAs(userId) {
  mockState = { session: sessionFor(userId) };
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
    // Deliberately always null — logCrmAudit() reads getCurrentSession()
    // to stamp auditLog.actorUserId; keeping it null here preserves the
    // pre-2A audit-row expectations of this suite (the product's
    // logCrmAudit is untouched by 2A-A and stamps the real session in
    // production).
    getCurrentSession: async () => null,
  },
});

const { db } = await import("@/db");
const { auditLog, crmClients, interactions, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createInteraction } = await import("./crm-interactions.ts");

const createdClientIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();
let INTERNAL_ORG_ID;

async function roleId(name) {
  const [r] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
  return r?.id ?? null;
}
async function seedUser(userId) {
  await db
    .insert(users)
    .values({ id: userId, clerkUserId: `test_clerk_${userId}`, email: `${userId}@example.test`, fullName: "Test Person", status: "active" })
    .onConflictDoNothing();
  createdUserIds.add(userId);
}
async function seedStaffMember(userId, roleName, status) {
  const rid = await roleId(roleName);
  const [row] = await db
    .insert(staffMembers)
    .values({ userId, workspaceOrgId: INTERNAL_ORG_ID, roleId: rid, status })
    .returning();
  createdStaffMemberIds.add(row.id);
  return row;
}

before(async () => {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  INTERNAL_ORG_ID = org?.id ?? null;
  assert.ok(INTERNAL_ORG_ID, "local test DB must have an internal organization for the Axis-C gate");
  await seedUser(STAFF_USER_ID);
  await seedUser(MANAGER_USER_ID);
  await seedUser(SUSPENDED_USER_ID);
  await seedUser(NON_STAFF_USER_ID); // authenticated user with NO staff_members row
  await seedStaffMember(STAFF_USER_ID, "EMPLOYEE", "ACTIVE");
  await seedStaffMember(MANAGER_USER_ID, "MANAGER", "ACTIVE");
  await seedStaffMember(SUSPENDED_USER_ID, "EMPLOYEE", "SUSPENDED");
});

beforeEach(() => {
  actAsStaff();
});

after(async () => {
  if (createdClientIds.size) {
    const ids = [...createdClientIds];
    const rows = await db.select({ id: interactions.id }).from(interactions).where(inArray(interactions.clientId, ids));
    const interactionIds = rows.map((r) => r.id);
    if (interactionIds.length) await db.delete(auditLog).where(inArray(auditLog.targetId, interactionIds));
    // Deleting the client cascades interactions (onDelete: "cascade").
    await db.delete(crmClients).where(inArray(crmClients.id, ids));
  }
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const [client] = await db
    .insert(crmClients)
    .values({
      name: overrides.name === undefined ? `Interaction Test ${randomUUID()}` : overrides.name,
      email: "prospect@example.test",
      doNotContact: overrides.doNotContact ?? false,
    })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

function interactionFormData({ clientId, type = "note", direction, outcome, summary, createdBy, createdByUserId, actorUserId } = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("type", type);
  if (direction !== undefined) fd.set("direction", direction);
  if (outcome !== undefined) fd.set("outcome", outcome);
  fd.set("summary", summary ?? `Test summary ${randomUUID()}`);
  // Caller-supplied authorship fields — all of these MUST be ignored.
  if (createdBy !== undefined) fd.set("createdBy", createdBy);
  if (createdByUserId !== undefined) fd.set("createdByUserId", createdByUserId);
  if (actorUserId !== undefined) fd.set("actorUserId", actorUserId);
  return fd;
}

async function interactionsFor(clientId) {
  return db.select().from(interactions).where(eq(interactions.clientId, clientId));
}

async function auditRowsForTarget(targetId, action) {
  return db.select().from(auditLog).where(eq(auditLog.targetId, targetId)).then((rows) => rows.filter((r) => r.action === action));
}

// =========================================================
// Authorization — runtime proof, not textual checks
// =========================================================

test("UNAUTHENTICATED createInteraction: rejected", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id })));
});

test("NON-STAFF createInteraction: rejected", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id })));
});

test("STAFF createInteraction: succeeds for a valid note", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "note" }));
  assert.equal((await interactionsFor(client.id)).length, 1);
});

// =========================================================
// Type validation
// =========================================================

test("invalid interaction type is rejected, no insert", async () => {
  const client = await makeClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "bogus" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

test("blank/missing type is rejected — no silent default to note", async () => {
  const client = await makeClient();
  const fd = interactionFormData({ clientId: client.id });
  fd.delete("type");
  await assert.rejects(() => createInteraction(fd));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

// =========================================================
// NOTE — direction/outcome must both stay null
// =========================================================

test("note + null direction + null outcome: accepted", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "note" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.direction, null);
  assert.equal(row.outcome, null);
});

test("note + outbound direction: rejected", async () => {
  const client = await makeClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "note", direction: "outbound" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

test("note + inbound direction: rejected", async () => {
  const client = await makeClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "note", direction: "inbound" })));
});

test("note + any outcome: rejected", async () => {
  const client = await makeClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "note", outcome: "positive" })));
});

// =========================================================
// CALL — direction required; outcome optional for either direction
// =========================================================

test("call without direction: rejected", async () => {
  const client = await makeClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "call" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

for (const direction of ["outbound", "inbound"]) {
  test(`call + ${direction} + null outcome: accepted`, async () => {
    const client = await makeClient();
    await createInteraction(interactionFormData({ clientId: client.id, type: "call", direction }));
    const [row] = await interactionsFor(client.id);
    assert.equal(row.direction, direction);
    assert.equal(row.outcome, null);
  });

  for (const outcome of ["positive", "neutral", "negative"]) {
    test(`call + ${direction} + ${outcome}: accepted`, async () => {
      const client = await makeClient();
      await createInteraction(interactionFormData({ clientId: client.id, type: "call", direction, outcome }));
      const [row] = await interactionsFor(client.id);
      assert.equal(row.direction, direction);
      assert.equal(row.outcome, outcome);
    });
  }
}

// =========================================================
// EMAIL — direction required; outcome forbidden when outbound
// =========================================================

test("email without direction: rejected", async () => {
  const client = await makeClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "email" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

test("email + outbound + null outcome: accepted (the only valid outbound-email state)", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "email", direction: "outbound" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.direction, "outbound");
  assert.equal(row.outcome, null);
});

for (const outcome of ["positive", "neutral", "negative"]) {
  test(`email + outbound + ${outcome}: rejected — nothing has happened yet at send time`, async () => {
    const client = await makeClient();
    await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "email", direction: "outbound", outcome })));
    assert.equal((await interactionsFor(client.id)).length, 0);
  });
}

test("email + inbound + null outcome: accepted", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "email", direction: "inbound" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.direction, "inbound");
  assert.equal(row.outcome, null);
});

for (const outcome of ["positive", "neutral", "negative"]) {
  test(`email + inbound + ${outcome}: accepted`, async () => {
    const client = await makeClient();
    await createInteraction(interactionFormData({ clientId: client.id, type: "email", direction: "inbound", outcome }));
    const [row] = await interactionsFor(client.id);
    assert.equal(row.direction, "inbound");
    assert.equal(row.outcome, outcome);
  });
}

// =========================================================
// MEETING — direction always null; outcome optional
// =========================================================

test("meeting + null direction + null outcome: accepted", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "meeting" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.direction, null);
  assert.equal(row.outcome, null);
});

for (const outcome of ["positive", "neutral", "negative"]) {
  test(`meeting + null direction + ${outcome}: accepted`, async () => {
    const client = await makeClient();
    await createInteraction(interactionFormData({ clientId: client.id, type: "meeting", outcome }));
    const [row] = await interactionsFor(client.id);
    assert.equal(row.direction, null);
    assert.equal(row.outcome, outcome);
  });
}

for (const direction of ["outbound", "inbound"]) {
  test(`meeting + ${direction} direction: rejected — a meeting is bidirectional by nature`, async () => {
    const client = await makeClient();
    await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "meeting", direction })));
    assert.equal((await interactionsFor(client.id)).length, 0);
  });
}

// =========================================================
// DNC enforcement — outbound-only, narrowest correct rule
// =========================================================

test("DNC client + outbound call: rejected, no insert", async () => {
  const client = await makeClient({ doNotContact: true });
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "call", direction: "outbound" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

test("DNC client + outbound email: rejected, no insert", async () => {
  const client = await makeClient({ doNotContact: true });
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "email", direction: "outbound" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

test("DNC client + inbound call: allowed — recording history is not initiating contact", async () => {
  const client = await makeClient({ doNotContact: true });
  await createInteraction(interactionFormData({ clientId: client.id, type: "call", direction: "inbound" }));
  assert.equal((await interactionsFor(client.id)).length, 1);
});

test("DNC client + inbound email: allowed", async () => {
  const client = await makeClient({ doNotContact: true });
  await createInteraction(interactionFormData({ clientId: client.id, type: "email", direction: "inbound" }));
  assert.equal((await interactionsFor(client.id)).length, 1);
});

test("DNC client + note: allowed — never involves contacting the client", async () => {
  const client = await makeClient({ doNotContact: true });
  await createInteraction(interactionFormData({ clientId: client.id, type: "note" }));
  assert.equal((await interactionsFor(client.id)).length, 1);
});

test("DNC client + meeting: allowed — records something that already happened", async () => {
  const client = await makeClient({ doNotContact: true });
  await createInteraction(interactionFormData({ clientId: client.id, type: "meeting" }));
  assert.equal((await interactionsFor(client.id)).length, 1);
});

// =========================================================
// Anti-hallucination — free text must never silently become a structured fact
// =========================================================

test("summary containing positive language does not set outcome", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "note", summary: "The client seemed really interested and positive!" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.outcome, null);
});

test("summary containing negative language does not set outcome", async () => {
  const client = await makeClient();
  await createInteraction(
    interactionFormData({
      clientId: client.id,
      type: "call",
      direction: "outbound",
      summary: "They were rude and said absolutely not, never contact again.",
    }),
  );
  const [row] = await interactionsFor(client.id);
  assert.equal(row.outcome, null);
});

test("summary implying a reply does not set direction", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "note", summary: "They replied to our email this morning." }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.direction, null);
});

test("no_response is not an accepted outcome value", async () => {
  const client = await makeClient();
  await assert.rejects(() =>
    createInteraction(interactionFormData({ clientId: client.id, type: "call", direction: "outbound", outcome: "no_response" })),
  );
  assert.equal((await interactionsFor(client.id)).length, 0);
});

// =========================================================
// Persistence
// =========================================================

test("accepted direction is stored verbatim", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "call", direction: "inbound" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.direction, "inbound");
});

test("accepted outcome is stored verbatim", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "meeting", outcome: "negative" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.outcome, "negative");
});

test("blank optional direction/outcome are stored as NULL, not empty string", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "note" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.direction, null);
  assert.notEqual(row.direction, "");
  assert.equal(row.outcome, null);
  assert.notEqual(row.outcome, "");
});

// =========================================================
// Audit
// =========================================================

test("accepted interaction produces a crm.interaction_logged audit entry with structured metadata", async () => {
  const client = await makeClient();
  await createInteraction(
    interactionFormData({ clientId: client.id, type: "call", direction: "outbound", outcome: "positive", summary: "Great first call." }),
  );
  const [interaction] = await interactionsFor(client.id);
  const auditRows = await auditRowsForTarget(interaction.id, "crm.interaction_logged");
  assert.equal(auditRows.length, 1);
  const meta = auditRows[0].metadata;
  assert.equal(meta.type, "call");
  assert.equal(meta.direction, "outbound");
  assert.equal(meta.outcome, "positive");
  assert.ok(meta.occurredAt);
  // summary is intentionally kept — lib/audit-labels.ts's
  // describeAuditEntry() reads metadata.summary for this action's
  // activity-feed display; dropping it would silently degrade that
  // existing contract (see the implementation report for this phase).
  assert.equal(meta.summary, "Great first call.");
  assert.equal(meta.clientId, client.id); // folded in automatically by logCrmAudit()
});

test("rejected interaction produces no interaction row (and therefore no audit entry referencing one)", async () => {
  const client = await makeClient();
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "email", direction: "outbound", outcome: "positive" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

// =========================================================
// Append-only — no artificial deduplication
// =========================================================

test("multiple legitimate interaction attempts for the same client are all allowed, never deduplicated", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "call", direction: "outbound" }));
  await createInteraction(interactionFormData({ clientId: client.id, type: "call", direction: "outbound" }));
  await createInteraction(interactionFormData({ clientId: client.id, type: "call", direction: "outbound" }));
  assert.equal((await interactionsFor(client.id)).length, 3);
});

// =========================================================
// RADAR-CORE-2A-A — interaction authorship integrity
// =========================================================

test("2A: a submitted createdBy form field is IGNORED — created_by stays NULL, created_by_user_id is the session user", async () => {
  const client = await makeClient();
  await createInteraction(interactionFormData({ clientId: client.id, type: "note", createdBy: "Fake Admin" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.createdBy, null, "the spoofable free-text createdBy is never written on a human write");
  assert.equal(row.createdByUserId, STAFF_USER_ID, "authorship is the authenticated session user id");
});

test("2A: submitted createdByUserId / actorUserId fields are IGNORED — author is always session.userId", async () => {
  const client = await makeClient();
  await createInteraction(
    interactionFormData({
      clientId: client.id,
      type: "note",
      createdBy: "Someone Else",
      createdByUserId: MANAGER_USER_ID, // a real other user id
      actorUserId: NON_STAFF_USER_ID,
    }),
  );
  const [row] = await interactionsFor(client.id);
  assert.equal(row.createdByUserId, STAFF_USER_ID, "never the caller-supplied target");
  assert.notEqual(row.createdByUserId, MANAGER_USER_ID);
  assert.notEqual(row.createdByUserId, NON_STAFF_USER_ID);
  assert.equal(row.createdBy, null);
});

test("2A: created_by_user_id always equals the authenticated session's user id (acting as a different active member)", async () => {
  const client = await makeClient();
  actAs(MANAGER_USER_ID);
  await createInteraction(interactionFormData({ clientId: client.id, type: "note" }));
  const [row] = await interactionsFor(client.id);
  assert.equal(row.createdByUserId, MANAGER_USER_ID);
});

test("2A: ACTIVE EMPLOYEE (RADAR_WORK) may create an interaction", async () => {
  const client = await makeClient();
  actAs(STAFF_USER_ID);
  await createInteraction(interactionFormData({ clientId: client.id, type: "note" }));
  assert.equal((await interactionsFor(client.id)).length, 1);
});

test("2A: ACTIVE MANAGER (RADAR_WORK) may create an interaction", async () => {
  const client = await makeClient();
  actAs(MANAGER_USER_ID);
  await createInteraction(interactionFormData({ clientId: client.id, type: "note" }));
  assert.equal((await interactionsFor(client.id)).length, 1);
});

test("2A: a SUSPENDED staff member is DENIED — no interaction inserted", async () => {
  const client = await makeClient();
  actAs(SUSPENDED_USER_ID);
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "note" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

test("2A: an authenticated user with NO staff_members row is DENIED — no interaction inserted", async () => {
  const client = await makeClient();
  actAs(NON_STAFF_USER_ID);
  await assert.rejects(() => createInteraction(interactionFormData({ clientId: client.id, type: "note" })));
  assert.equal((await interactionsFor(client.id)).length, 0);
});

test("2A: a legacy row (created_by_user_id NULL, created_by free text) is read back verbatim — no backfill, no rewrite", async () => {
  const client = await makeClient();
  const [legacy] = await db
    .insert(interactions)
    .values({ clientId: client.id, type: "note", summary: "Historical note", createdBy: "Legacy Person" })
    .returning();
  const [row] = await db.select().from(interactions).where(eq(interactions.id, legacy.id));
  assert.equal(row.createdBy, "Legacy Person", "existing free-text authorship is preserved unchanged");
  assert.equal(row.createdByUserId, null, "legacy rows are never attributed to a real user");
});

test("2A: structural — createInteraction never reads a caller createdBy/createdByUserId/actorUserId, and gates on RADAR_WORK", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("./crm-interactions.ts", import.meta.url)), "utf8");
  assert.ok(src.includes('requireStaffMember("RADAR_WORK")'), "human gate is Axis-C RADAR_WORK");
  assert.ok(src.includes("await requireSession()"), "actor id comes from the session");
  assert.ok(src.includes("createdByUserId: actorUserId"), "structured author is the session user id");
  assert.ok(!/formData\.get\(["']createdBy["']\)/.test(src), "never reads a caller createdBy");
  assert.ok(!/formData\.get\(["'](createdByUserId|actorUserId)["']\)/.test(src), "never reads a caller actor id");
  assert.ok(!src.includes("requireStaffRole"), "the Axis-A gate is fully replaced");
});
