// lib/actions/radar-assignment.test.mjs — PHASE RADAR-CORE-1A unit tests
// for claimProspect / assignProspect / unassignProspect.
//
// Every dependency is mocked at the module boundary (same technique as
// lib/actions/workforce.test.mjs / workforce-ui.test.mjs):
//   @/lib/rbac/require-staff-member — requireStaffMember (records the exact
//     permission, can deny with a NEXT_REDIRECT) + evaluateStaffPermission
//     (the non-redirecting foreign-unassign escalation).
//   @/lib/session                   — requireSession -> { userId }.
//   @/lib/notifications             — getInternalOrganizationId.
//   @/db                            — a chain fake: db.transaction(cb) runs
//     cb(fakeTx); fakeTx.select routes the FOR UPDATE crm_clients read vs
//     the staff_members⋈staff_roles assignee read; fakeTx.update captures
//     the .set() payload and returns a configurable RETURNING.
//   @/lib/audit                     — logAudit spy (records input + whether
//     it was handed the transaction executor).
//   next/cache                      — revalidatePath spy.
//
// The REAL transactional row-lock / serialisation / rollback are proven
// against a disposable Postgres by radar-assignment.integration.test.mjs.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-assignment.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SESSION_UUID = "5e551011-0000-4000-8000-000000000001"; // the acting staff member
const CLIENT_UUID = "c11c11c1-0000-4000-8000-000000000002";
const ASSIGNEE_UUID = "a5519eee-0000-4000-8000-000000000003";
const OTHER_STAFF_UUID = "07de5a1f-0000-4000-8000-000000000009"; // a different current assignee
const INTERNAL_ORG_ID = "17ce1000-0000-4000-8000-000000000004";

// ---- mock state -----------------------------------------------------------
let permissionCalls = [];
let denyPerms = new Set(); // permission -> deny (NEXT_REDIRECT)
let evaluateAssignOk = true; // evaluateStaffPermission result for the foreign-unassign escalation

mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (denyPerms.has(permission)) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "ADMIN";
    },
    evaluateStaffPermission: async ({ userId, permission }) => {
      evaluateCalls.push({ userId, permission });
      return evaluateAssignOk ? { ok: true, role: "MANAGER" } : { ok: false, reason: "permission-denied" };
    },
  },
});
let evaluateCalls = [];

let internalOrgId = INTERNAL_ORG_ID;
mock.module("@/lib/notifications", { namedExports: { getInternalOrganizationId: async () => internalOrgId } });

let sessionUserId = SESSION_UUID;
mock.module("@/lib/session", { namedExports: { requireSession: async () => ({ userId: sessionUserId }) } });

let auditWrites = [];
let auditShouldThrow = null; // set to an Error to make logAudit reject (rollback path)
let fakeTxRef = null;
mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async (input, executor) => {
      auditWrites.push({ input, handedTx: executor === fakeTxRef });
      if (auditShouldThrow) throw auditShouldThrow;
    },
  },
});

let revalidateCalls = [];
mock.module("next/cache", { namedExports: { revalidatePath: (p) => revalidateCalls.push(p) } });

// crm_clients FOR UPDATE row: { id, assignedUserId } | undefined
let lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
// staff_members⋈staff_roles assignee row: { status, roleName } | undefined
let assigneeRow = { status: "ACTIVE", roleName: "MANAGER" };
let updateReturning = [{ assignedUserId: "written" }];
let selectError = null; // reject the locked read (infra failure)
let updateError = null; // reject the update (infra failure)
let forUpdateUsed = false;
let updateSetCapture = null;
let transactionEntered = false;

function makeSelectBuilder() {
  let isAssigneeRead = false;
  let isLockedRead = false;
  const b = {
    from: () => b,
    where: () => b,
    innerJoin: () => {
      isAssigneeRead = true;
      return b;
    },
    for: (mode) => {
      forUpdateUsed = forUpdateUsed || mode === "update";
      isLockedRead = true;
      return b;
    },
    limit: () => {
      if (isAssigneeRead) return Promise.resolve(assigneeRow ? [assigneeRow] : []);
      if (isLockedRead) {
        if (selectError) return Promise.reject(selectError);
        return Promise.resolve(lockedClientRow ? [lockedClientRow] : []);
      }
      return Promise.resolve([]);
    },
  };
  return b;
}

const fakeTx = {
  select: () => makeSelectBuilder(),
  update: () => ({
    set: (payload) => {
      updateSetCapture = payload;
      return {
        where: () => {
          return { returning: () => (updateError ? Promise.reject(updateError) : Promise.resolve(updateReturning)) };
        },
      };
    },
  }),
};
fakeTxRef = fakeTx;

// RADAR-CORE-1B — non-transaction roster read used by listAssignableRadarMembers().
// db.select({...}).from(staffMembers).innerJoin(staffRoles,...).innerJoin(users,...).where(...)
// resolves to `rosterRows`. Any status / role the source does not filter in
// SQL is present here so the JS-side ACTIVE + ELIGIBLE_ASSIGNEE_ROLES filter
// is what the assertions actually exercise (mirrors isEligibleAssignee).
let rosterRows = [];
let rosterSelectUsed = false;
function makeRosterBuilder() {
  const b = {
    from: () => b,
    innerJoin: () => b,
    where: () => {
      rosterSelectUsed = true;
      return Promise.resolve(rosterRows);
    },
  };
  return b;
}

const fakeDb = {
  transaction: async (cb) => {
    transactionEntered = true;
    return cb(fakeTx);
  },
  select: () => makeRosterBuilder(),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { claimProspect, assignProspect, unassignProspect, listAssignableRadarMembers } = await import("./radar-assignment.ts");

function reset() {
  permissionCalls = [];
  denyPerms = new Set();
  evaluateAssignOk = true;
  evaluateCalls = [];
  internalOrgId = INTERNAL_ORG_ID;
  sessionUserId = SESSION_UUID;
  auditWrites = [];
  auditShouldThrow = null;
  revalidateCalls = [];
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
  assigneeRow = { status: "ACTIVE", roleName: "MANAGER" };
  updateReturning = [{ assignedUserId: "written" }];
  selectError = null;
  updateError = null;
  forUpdateUsed = false;
  updateSetCapture = null;
  transactionEntered = false;
  rosterRows = [];
  rosterSelectUsed = false;
}

// ============================ AUTH ============================

test("R1A-1. claimProspect calls requireStaffMember('RADAR_WORK') first; a denial rejects before any DB/audit/revalidate", async () => {
  reset();
  denyPerms = new Set(["RADAR_WORK"]);
  await assert.rejects(() => claimProspect(CLIENT_UUID), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_WORK"]);
  assert.equal(transactionEntered, false);
  assert.deepEqual(auditWrites, []);
  assert.deepEqual(revalidateCalls, []);
});

test("R1A-2. assignProspect calls requireStaffMember('RADAR_ASSIGN') first; a denial (forged EMPLOYEE) rejects before DB", async () => {
  reset();
  denyPerms = new Set(["RADAR_ASSIGN"]);
  await assert.rejects(() => assignProspect(CLIENT_UUID, ASSIGNEE_UUID), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_ASSIGN"]);
  assert.equal(transactionEntered, false);
  assert.deepEqual(auditWrites, []);
});

test("R1A-3. unassignProspect performs RADAR_WORK authorization before any DB access; denial blocks the read", async () => {
  reset();
  denyPerms = new Set(["RADAR_WORK"]);
  await assert.rejects(() => unassignProspect(CLIENT_UUID), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_WORK"]);
  assert.equal(transactionEntered, false);
});

// ============================ SIGNATURES ============================

test("R1A-4. arities: claim(1), assign(2), unassign(1)", () => {
  assert.equal(claimProspect.length, 1);
  assert.equal(assignProspect.length, 2);
  assert.equal(unassignProspect.length, 1);
});

// ============================ VALIDATION ============================

test("R1A-5. invalid client UUID -> INVALID_CLIENT (every action), no transaction", async () => {
  for (const bad of ["not-a-uuid", "", "'; DROP TABLE crm_clients; --", "  "]) {
    reset();
    assert.deepEqual(await claimProspect(bad), { error: "INVALID_CLIENT" });
    reset();
    assert.deepEqual(await assignProspect(bad, ASSIGNEE_UUID), { error: "INVALID_CLIENT" });
    reset();
    assert.deepEqual(await unassignProspect(bad), { error: "INVALID_CLIENT" });
    assert.equal(transactionEntered, false);
  }
});

test("R1A-6. assignProspect invalid assignee UUID -> INVALID_ASSIGNEE, no transaction", async () => {
  for (const bad of ["nope", "", "person@example.com"]) {
    reset();
    assert.deepEqual(await assignProspect(CLIENT_UUID, bad), { error: "INVALID_ASSIGNEE" });
    assert.equal(transactionEntered, false);
  }
});

test("R1A-7. locked prospect row absent -> PROSPECT_NOT_FOUND, no write, no audit", async () => {
  reset();
  lockedClientRow = undefined;
  assert.deepEqual(await claimProspect(CLIENT_UUID), { error: "PROSPECT_NOT_FOUND" });
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

// ============================ ASSIGNEE ELIGIBILITY ============================

test("R1A-8. ineligible assignee (missing / SUSPENDED / OFFBOARDING / OWNER / non-staff) -> ASSIGNEE_NOT_ELIGIBLE, no write, no audit", async () => {
  const cases = [
    undefined, // no staff_members row (non-staff / unknown / client user)
    { status: "SUSPENDED", roleName: "MANAGER" },
    { status: "OFFBOARDING", roleName: "EMPLOYEE" },
    { status: "ACTIVE", roleName: "OWNER" },
    { status: "ACTIVE", roleName: "SOMETHING_ELSE" },
  ];
  for (const row of cases) {
    reset();
    assigneeRow = row;
    assert.deepEqual(await assignProspect(CLIENT_UUID, ASSIGNEE_UUID), { error: "ASSIGNEE_NOT_ELIGIBLE" });
    assert.equal(updateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("R1A-9. claimProspect by an OWNER (self) -> ASSIGNEE_NOT_ELIGIBLE (OWNER is never an assignee)", async () => {
  reset();
  assigneeRow = { status: "ACTIVE", roleName: "OWNER" };
  assert.deepEqual(await claimProspect(CLIENT_UUID), { error: "ASSIGNEE_NOT_ELIGIBLE" });
  assert.equal(updateSetCapture, null);
});

// ============================ CLAIM ============================

test("R1A-10. claim an unassigned prospect -> success: FOR UPDATE used, sets ONLY assignedUserId=actor, crm.client_assigned audit (ids only, same tx), revalidate", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
  const result = await claimProspect(CLIENT_UUID);
  assert.equal(result, undefined);
  assert.equal(forUpdateUsed, true, "the prospect row must be locked with SELECT ... FOR UPDATE");
  assert.deepEqual(Object.keys(updateSetCapture), ["assignedUserId"], "only assigned_user_id is written");
  assert.equal(updateSetCapture.assignedUserId, SESSION_UUID);
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0].handedTx, true, "logAudit was handed the transaction executor");
  assert.deepEqual(auditWrites[0].input, {
    actorUserId: SESSION_UUID,
    action: "crm.client_assigned",
    targetType: "crm_client",
    targetId: CLIENT_UUID,
    metadata: { clientId: CLIENT_UUID, previousAssigneeUserId: null, newAssigneeUserId: SESSION_UUID },
  });
  assert.ok(!("organizationId" in auditWrites[0].input), "no organizationId — staff-global CRM audit");
  assert.deepEqual(revalidateCalls, ["/admin/crm/radar"]);
});

test("R1A-11. claim a prospect already assigned to someone -> ALREADY_ASSIGNED, no write, no audit, no revalidate", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: OTHER_STAFF_UUID };
  assert.deepEqual(await claimProspect(CLIENT_UUID), { error: "ALREADY_ASSIGNED" });
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
  assert.deepEqual(revalidateCalls, []);
});

// ============================ ASSIGN ============================

test("R1A-12. assign null -> B: crm.client_assigned, previous null / new B", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
  const result = await assignProspect(CLIENT_UUID, ASSIGNEE_UUID);
  assert.equal(result, undefined);
  assert.equal(updateSetCapture.assignedUserId, ASSIGNEE_UUID);
  assert.equal(auditWrites[0].input.action, "crm.client_assigned");
  assert.deepEqual(auditWrites[0].input.metadata, {
    clientId: CLIENT_UUID,
    previousAssigneeUserId: null,
    newAssigneeUserId: ASSIGNEE_UUID,
  });
  assert.deepEqual(revalidateCalls, ["/admin/crm/radar"]);
});

test("R1A-13. assign A -> B: crm.client_reassigned, previous A / new B (previous from the LOCKED row)", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: OTHER_STAFF_UUID };
  const result = await assignProspect(CLIENT_UUID, ASSIGNEE_UUID);
  assert.equal(result, undefined);
  assert.equal(updateSetCapture.assignedUserId, ASSIGNEE_UUID);
  assert.equal(auditWrites[0].input.action, "crm.client_reassigned");
  assert.deepEqual(auditWrites[0].input.metadata, {
    clientId: CLIENT_UUID,
    previousAssigneeUserId: OTHER_STAFF_UUID,
    newAssigneeUserId: ASSIGNEE_UUID,
  });
});

test("R1A-14. assign B -> B (same member) -> ASSIGNMENT_UNCHANGED, no write, no audit, no revalidate", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: ASSIGNEE_UUID };
  assert.deepEqual(await assignProspect(CLIENT_UUID, ASSIGNEE_UUID), { error: "ASSIGNMENT_UNCHANGED" });
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
  assert.deepEqual(revalidateCalls, []);
});

// ============================ UNASSIGN ============================

test("R1A-15. unassign OWN assignment with RADAR_WORK only -> success (no RADAR_ASSIGN escalation needed)", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: SESSION_UUID };
  const result = await unassignProspect(CLIENT_UUID);
  assert.equal(result, undefined);
  assert.deepEqual(permissionCalls, ["RADAR_WORK"]);
  assert.deepEqual(evaluateCalls, [], "no RADAR_ASSIGN escalation for one's own assignment");
  assert.equal(updateSetCapture.assignedUserId, null);
  assert.equal(auditWrites[0].input.action, "crm.client_unassigned");
  assert.deepEqual(auditWrites[0].input.metadata, {
    clientId: CLIENT_UUID,
    previousAssigneeUserId: SESSION_UUID,
    newAssigneeUserId: null,
  });
  assert.deepEqual(revalidateCalls, ["/admin/crm/radar"]);
});

test("R1A-16. unassign SOMEONE ELSE'S assignment WITH RADAR_ASSIGN -> success", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: OTHER_STAFF_UUID };
  evaluateAssignOk = true;
  const result = await unassignProspect(CLIENT_UUID);
  assert.equal(result, undefined);
  assert.deepEqual(evaluateCalls, [{ userId: SESSION_UUID, permission: "RADAR_ASSIGN" }]);
  assert.equal(updateSetCapture.assignedUserId, null);
  assert.equal(auditWrites[0].input.action, "crm.client_unassigned");
});

test("R1A-17. unassign SOMEONE ELSE'S assignment WITHOUT RADAR_ASSIGN -> NOT_ALLOWED_TO_ASSIGN, no write, no audit", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: OTHER_STAFF_UUID };
  evaluateAssignOk = false;
  assert.deepEqual(await unassignProspect(CLIENT_UUID), { error: "NOT_ALLOWED_TO_ASSIGN" });
  assert.deepEqual(evaluateCalls, [{ userId: SESSION_UUID, permission: "RADAR_ASSIGN" }]);
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
  assert.deepEqual(revalidateCalls, []);
});

test("R1A-18. unassign an already-unassigned prospect -> ASSIGNMENT_UNCHANGED, no write, no audit", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
  assert.deepEqual(await unassignProspect(CLIENT_UUID), { error: "ASSIGNMENT_UNCHANGED" });
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

// ============================ WRITE / ERRORS ============================

test("R1A-19. zero-row optimistic UPDATE -> ASSIGNMENT_CHANGED_RETRY, no audit, no revalidate", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
  updateReturning = [];
  assert.deepEqual(await claimProspect(CLIENT_UUID), { error: "ASSIGNMENT_CHANGED_RETRY" });
  assert.deepEqual(auditWrites, []);
  assert.deepEqual(revalidateCalls, []);
});

test("R1A-20. no internal workspace -> throws 'internal workspace is not configured' (propagates, never a code)", async () => {
  reset();
  internalOrgId = null;
  await assert.rejects(() => claimProspect(CLIENT_UUID), /internal workspace is not configured/);
  assert.deepEqual(revalidateCalls, []);
});

test("R1A-21. an infra error from the locked read propagates, never a code, never a revalidate", async () => {
  reset();
  selectError = new Error("connection terminated unexpectedly");
  await assert.rejects(() => claimProspect(CLIENT_UUID), /connection terminated unexpectedly/);
  assert.deepEqual(auditWrites, []);
  assert.deepEqual(revalidateCalls, []);
});

test("R1A-22. an infra error from the UPDATE propagates (rolls back), no audit, no revalidate", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
  updateError = new Error("deadlock detected");
  await assert.rejects(() => claimProspect(CLIENT_UUID), /deadlock detected/);
  assert.deepEqual(auditWrites, []);
  assert.deepEqual(revalidateCalls, []);
});

test("R1A-23. a logAudit failure inside the transaction propagates (assignment rolls back — no revalidate)", async () => {
  reset();
  lockedClientRow = { id: CLIENT_UUID, assignedUserId: null };
  auditShouldThrow = new Error("audit write failed");
  await assert.rejects(() => claimProspect(CLIENT_UUID), /audit write failed/);
  assert.equal(auditWrites.length, 1, "logAudit was attempted, inside the tx");
  assert.equal(auditWrites[0].handedTx, true);
  assert.deepEqual(revalidateCalls, [], "a rolled-back assignment never revalidates");
});

// ============================ RADAR-CORE-1B: listAssignableRadarMembers ============================

const ADMIN_UUID = "ad311111-0000-4000-8000-0000000000a1";
const MGR_UUID = "ma224444-0000-4000-8000-0000000000a2";
const EMP_UUID = "e3355555-0000-4000-8000-0000000000a3";
const OWNER_UUID = "0e766666-0000-4000-8000-0000000000a4";

test("R1B-1. listAssignableRadarMembers gates on requireStaffMember('RADAR_ASSIGN') FIRST — a denial rejects before any DB read", async () => {
  reset();
  denyPerms = new Set(["RADAR_ASSIGN"]);
  await assert.rejects(() => listAssignableRadarMembers(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_ASSIGN"]);
  assert.equal(rosterSelectUsed, false);
});

test("R1B-2. arity 0 (no caller-supplied workspace / filter)", () => {
  assert.equal(listAssignableRadarMembers.length, 0);
});

test("R1B-3. missing internal workspace -> throws a configuration error, never a partial list", async () => {
  reset();
  internalOrgId = null;
  await assert.rejects(() => listAssignableRadarMembers(), /internal workspace is not configured/);
});

test("R1B-4. ACTIVE ADMIN / MANAGER / EMPLOYEE are included; OWNER, SUSPENDED, OFFBOARDING and non-staff are excluded", async () => {
  reset();
  rosterRows = [
    { userId: ADMIN_UUID, status: "ACTIVE", roleName: "ADMIN", fullName: "Ada Admin", email: "ada@x.test" },
    { userId: MGR_UUID, status: "ACTIVE", roleName: "MANAGER", fullName: "Max Manager", email: "max@x.test" },
    { userId: EMP_UUID, status: "ACTIVE", roleName: "EMPLOYEE", fullName: "Eve Employee", email: "eve@x.test" },
    { userId: OWNER_UUID, status: "ACTIVE", roleName: "OWNER", fullName: "Olga Owner", email: "olga@x.test" },
    { userId: "s0000000-0000-4000-8000-0000000000b1", status: "SUSPENDED", roleName: "MANAGER", fullName: "Sam Suspended", email: "sam@x.test" },
    { userId: "0ff00000-0000-4000-8000-0000000000b2", status: "OFFBOARDING", roleName: "EMPLOYEE", fullName: "Ola Off", email: "ola@x.test" },
    { userId: "c1100000-0000-4000-8000-0000000000b3", status: "ACTIVE", roleName: "CLIENT", fullName: "Cyril Client", email: "cyril@x.test" },
  ];
  const out = await listAssignableRadarMembers();
  assert.deepEqual(
    out.map((m) => m.userId).sort(),
    [ADMIN_UUID, EMP_UUID, MGR_UUID].sort(),
  );
});

test("R1B-5. displayName = fullName when present, email when fullName is null; result carries ONLY userId + displayName", async () => {
  reset();
  rosterRows = [
    { userId: ADMIN_UUID, status: "ACTIVE", roleName: "ADMIN", fullName: "Ada Admin", email: "ada@x.test" },
    { userId: MGR_UUID, status: "ACTIVE", roleName: "MANAGER", fullName: null, email: "max@x.test" },
  ];
  const out = await listAssignableRadarMembers();
  const byId = Object.fromEntries(out.map((m) => [m.userId, m]));
  assert.equal(byId[ADMIN_UUID].displayName, "Ada Admin");
  assert.equal(byId[MGR_UUID].displayName, "max@x.test");
  for (const m of out) {
    assert.deepEqual(Object.keys(m).sort(), ["displayName", "userId"]);
  }
});

test("R1B-6. stable ordering — fullName first (alphabetical), rows with no fullName last, then email", async () => {
  reset();
  rosterRows = [
    { userId: "u1", status: "ACTIVE", roleName: "EMPLOYEE", fullName: null, email: "zeb@x.test" },
    { userId: "u2", status: "ACTIVE", roleName: "MANAGER", fullName: "Bruno", email: "b@x.test" },
    { userId: "u3", status: "ACTIVE", roleName: "ADMIN", fullName: "Alice", email: "a@x.test" },
    { userId: "u4", status: "ACTIVE", roleName: "EMPLOYEE", fullName: null, email: "amy@x.test" },
  ];
  const out = await listAssignableRadarMembers();
  assert.deepEqual(
    out.map((m) => m.displayName),
    ["Alice", "Bruno", "amy@x.test", "zeb@x.test"],
  );
});

test("R1B-7. source invariants: RADAR_ASSIGN gate before any db.select, ACTIVE + ELIGIBLE_ASSIGNEE_ROLES filter, server-resolved workspace, no caller args, no role/status leaked", () => {
  const src = readFileSync(fileURLToPath(new URL("./radar-assignment.ts", import.meta.url)), "utf8");
  const body = src.slice(src.indexOf("export async function listAssignableRadarMembers"));
  const gateIdx = body.indexOf('requireStaffMember("RADAR_ASSIGN")');
  const orgIdx = body.indexOf("getInternalOrganizationId(");
  const selectIdx = body.indexOf(".select(");
  assert.ok(gateIdx >= 0, "RADAR_ASSIGN gate present");
  assert.ok(gateIdx < orgIdx, "gate before workspace resolution");
  assert.ok(orgIdx >= 0 && orgIdx < selectIdx, "workspace resolved before the roster select");
  assert.ok(/if \(!internalOrgId\)\s*\{[\s\S]{0,120}throw new Error/.test(body), "throws when the internal workspace is missing");
  assert.ok(body.includes("ELIGIBLE_ASSIGNEE_ROLES.has(r.roleName)"), "reuses the shared eligible-role set (OWNER excluded)");
  assert.ok(body.includes('r.status === "ACTIVE"'), "ACTIVE-only filter");
  assert.ok(body.includes("workspaceOrgId, internalOrgId"), "scoped to the server-resolved internal workspace");
  assert.ok(/return rows[\s\S]*\.map\(\(r\) => \(\{ userId: r\.userId, displayName: r\.fullName \?\? r\.email \}\)\)/.test(body), "maps to exactly { userId, displayName }");
  assert.ok(
    !/export async function listAssignableRadarMembers\([^)]*\b(workspace|workspaceOrgId|organizationId|userId|role|status)\b/.test(src),
    "takes no caller-supplied workspace/user/role/status",
  );
});

// ============================ SOURCE INVARIANTS ============================

test("R1A-24. source invariants: Axis-C only, no legacy axis, no ownerName authority, no caller workspace/actor/status/role, gates in order", () => {
  const src = readFileSync(fileURLToPath(new URL("./radar-assignment.ts", import.meta.url)), "utf8");
  const importLines = src.split("\n").filter((l) => /^\s*import\s/.test(l));
  for (const forbidden of ["@/lib/dev-role", "requireStaffRole", "requireAdminRole", "auditDb", "memberships", "@/lib/actions/users"]) {
    assert.ok(!importLines.some((l) => l.includes(forbidden)), `radar-assignment.ts must not import/use ${forbidden}`);
  }
  // Axis-C gates present
  assert.ok(src.includes('requireStaffMember("RADAR_WORK")'), "claim/unassign gate");
  assert.ok(src.includes('requireStaffMember("RADAR_ASSIGN")'), "assign gate");
  // gate BEFORE any getInternalOrganizationId / db read in each wrapper
  for (const fn of ["claimProspect", "assignProspect", "unassignProspect"]) {
    const body = src.slice(src.indexOf(`export async function ${fn}`), src.indexOf(`export async function ${fn}`) + 600);
    const gateIdx = body.search(/await requireStaffMember\(/);
    const uuidIdx = body.search(/isValidUuid\(/);
    const sessionIdx = body.search(/await requireSession\(\)/);
    assert.ok(gateIdx >= 0 && gateIdx < uuidIdx, `${fn}: permission gate before UUID validation`);
    assert.ok(uuidIdx < sessionIdx, `${fn}: UUID validation before requireSession()`);
  }
  // only assigned_user_id written; ownerName never written
  assert.ok(src.includes(".set({ assignedUserId: target })"), "UPDATE writes exactly { assignedUserId }");
  assert.ok(!/\.set\([^)]*ownerName/.test(src), "never writes ownerName");
  assert.ok(!/\.set\([^)]*\b(stage|notes|organizationId|updatedAt)\b/.test(src), "never writes stage/notes/organizationId/updatedAt");
  // previousAssigneeUserId comes from the locked row (currentAssignee), never an advisory/caller value
  assert.ok(src.includes("previousAssigneeUserId: currentAssignee"), "audit previous from the FOR UPDATE-locked value");
  // no caller-supplied workspace / actor / status / role / previousAssignee in any exported signature
  assert.ok(
    !/export async function \w+\([^)]*\b(workspace|workspaceOrgId|organizationId|actorUserId|previousAssignee|ownerName|role|status|intent)\b/.test(src),
    "no exported action takes workspace/actor/status/role/previousAssignee/ownerName/intent",
  );
  // FOR UPDATE + one transaction + tx-aware audit
  assert.ok(src.includes('.for("update")'), "SELECT ... FOR UPDATE");
  assert.ok(src.includes("db.transaction("), "single transaction");
  assert.ok(/logAudit\(\s*\{[\s\S]*?\},\s*tx,?\s*\)/.test(src), "logAudit is handed the tx executor (same-transaction audit)");
  assert.ok(!/\blogCrmAudit\(/.test(src), "must NOT CALL the non-transaction-aware logCrmAudit (a doc reference to it is fine)");
  assert.ok(!/from ["']@\/lib\/audit["'][^\n]*logCrmAudit/.test(src), "must not import logCrmAudit");
});
