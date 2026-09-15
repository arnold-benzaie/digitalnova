// lib/actions/workforce.test.mjs — pure unit tests for the PUBLIC
// listWorkforceMembers() / addWorkforceMember() boundary only.
// lib/actions/workforce.ts exports exactly these two runtime-capable
// symbols by design (see RBAC-RUNTIME-R2A-API-SURFACE-HARDENING-1 and
// RBAC-RUNTIME-R2B-WORKFORCE-MUTATION-FOUNDATION-1) — there is no internal
// core/query/insert seam left to import, on purpose. Every test below
// drives the module entirely through its real imports, mocked at the
// module boundary:
//
//   @/lib/rbac/require-staff-member — mocked as a whole (a black box; its
//     own internals are already exhaustively covered by R1's own 24-test
//     suite, lib/rbac/require-staff-member.test.mjs — re-proving them here
//     would be redundant, not more rigorous) so these tests isolate
//     workforce.ts's OWN logic: workspace resolution, query/insert shape,
//     role validation, and response mapping.
//   @/lib/notifications — mocked so the workspace-resolution-failure path
//     is exercisable without a real DB.
//   @/lib/session — mocked (requireSession(), used by addWorkforceMember
//     to stamp the audit actor / invitedByUserId) so no real Clerk call is
//     needed.
//   @/db — mocked with a small table-aware fake (select/from/innerJoin/
//     where/orderBy/limit, plus transaction/insert/values/returning) whose
//     behavior is driven by mutable outer state, so every query/insert
//     shape and DB-failure path is exercisable without a real DB. Table
//     identity is checked against the REAL `@/db/schema` exports (schema
//     definitions only — no live connection, no `server-only` guard — so
//     importing them here is safe), never against column selections,
//     which differ per call site.
//
// The REAL query's OWNER-exclusion predicate, the REAL requireStaffMember
// authorization pipeline (OWNER/ADMIN allow, MANAGER/EMPLOYEE/no-membership
// deny), the REAL staff_members_user_workspace_unique race-safety net, and
// the REAL deterministic ORDER BY are — correctly — NOT provable by mocks
// of this depth; those are proven for real against a disposable Postgres
// by the companion lib/actions/workforce.integration.test.mjs.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { staffMembers, staffRoles, users, auditLog } from "@/db/schema";

// WORKFORCE ACCESS CONTROL — `role` is now mutable (was hardcoded "ADMIN")
// so setWorkforceMemberRadarAccess()'s actor-role-conditional ADMIN-target
// rule (OWNER may; ADMIN may not) is testable. Defaults to "ADMIN",
// preserving every pre-existing test's behavior unchanged — none of them
// depend on the specific returned role value.
let permissionMockState = { allow: true, role: "ADMIN" };
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      assert.equal(permission, "WORKFORCE_MANAGE", "workforce.ts must request exactly WORKFORCE_MANAGE");
      if (!permissionMockState.allow) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return permissionMockState.role;
    },
  },
});

let internalOrgIdMock = async () => "e35cbc31-9604-4324-adc6-f6f5c1ffc248";
mock.module("@/lib/notifications", {
  namedExports: { getInternalOrganizationId: async () => internalOrgIdMock() },
});

let sessionMock = { userId: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2" };
mock.module("@/lib/session", {
  namedExports: { requireSession: async () => sessionMock },
});

// ---- select()/from()/…/orderBy()|limit() results, keyed by which table
// .from() receives — mirrors the real distinct query shapes in
// workforce.ts (a 3-table join for listing, single-table lookups for the
// mutation's target-user/role resolution). ----
let listRowsOrError = { rows: [] };
let userLookupOrError = { rows: [] };
let roleLookupOrError = { rows: [{ id: "role-admin-uuid" }] };
let insertResultOrError = { row: { id: "staff-member-uuid", status: "ACTIVE" } };
let auditWrites = [];

// ---- R2C (changeWorkforceMemberRole) fake state ----
// The advisory 3-join lookup ends in .limit() (not .orderBy() like R2A's
// listing). Inside the transaction: SELECT ... FOR UPDATE on staff_members,
// then TWO staff_roles lookups in order (locked role name, then new role
// id), then UPDATE ... RETURNING.
let r2cAdvisory = { rows: [] };
let r2cLockedRow = { rows: [] };
let r2cTxStaffRolesQueue = []; // [lockedRoleNameResult, newRoleIdResult]
let r2cUpdateReturning = { rows: [{ status: "ACTIVE" }] };
let r2cUpdateSetCapture = null;
let r2cUpdateForUpdateUsed = false;
let r2cAuditFailure = null; // set to an Error to make the in-transaction audit write reject

function settle(box) {
  return "error" in box ? Promise.reject(box.error) : Promise.resolve(box.rows);
}

const fakeDb = {
  select: () => ({
    from: (table) => {
      if (table === staffMembers) {
        return {
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({
                orderBy: () =>
                  "error" in listRowsOrError ? Promise.reject(listRowsOrError.error) : Promise.resolve(listRowsOrError.rows),
                limit: () => settle(r2cAdvisory), // R2C advisory staff_members ⋈ staff_roles ⋈ users
              }),
            }),
          }),
        };
      }
      if (table === users) {
        return {
          where: () => ({
            limit: () => ("error" in userLookupOrError ? Promise.reject(userLookupOrError.error) : Promise.resolve(userLookupOrError.rows)),
          }),
        };
      }
      if (table === staffRoles) {
        return {
          where: () => ({
            limit: () => ("error" in roleLookupOrError ? Promise.reject(roleLookupOrError.error) : Promise.resolve(roleLookupOrError.rows)),
          }),
        };
      }
      throw new Error(`fake db: unexpected select().from(<unknown table>) — got ${String(table)}`);
    },
  }),
  transaction: async (callback) => {
    const tx = {
      select: () => ({
        from: (table) => {
          if (table === staffMembers) {
            return {
              where: () => ({
                for: (strength) => {
                  r2cUpdateForUpdateUsed = strength === "update";
                  return { limit: () => settle(r2cLockedRow) };
                },
              }),
            };
          }
          if (table === staffRoles) {
            return { where: () => ({ limit: () => settle(r2cTxStaffRolesQueue.shift() ?? { rows: [] }) }) };
          }
          throw new Error(`fake tx: unexpected select().from() — ${String(table)}`);
        },
      }),
      update: (table) => {
        if (table !== staffMembers) throw new Error(`fake tx: unexpected update() — ${String(table)}`);
        return {
          set: (values) => {
            r2cUpdateSetCapture = values;
            return { where: () => ({ returning: () => settle(r2cUpdateReturning) }) };
          },
        };
      },
      insert: (table) => ({
        values: (values) => {
          if (table === auditLog) {
            auditWrites.push(values);
            return r2cAuditFailure ? Promise.reject(r2cAuditFailure) : Promise.resolve();
          }
          if (table === staffMembers) {
            return {
              returning: () => {
                if ("error" in insertResultOrError) return Promise.reject(insertResultOrError.error);
                return Promise.resolve([insertResultOrError.row]);
              },
            };
          }
          throw new Error(`fake db: unexpected insert().values() into <unknown table> — got ${String(table)}`);
        },
      }),
    };
    return callback(tx);
  },
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const {
  listWorkforceMembers,
  addWorkforceMember,
  changeWorkforceMemberRole,
  suspendWorkforceMember,
  reactivateWorkforceMember,
  offboardWorkforceMember,
  setWorkforceMemberRadarAccess,
} = await import("./workforce.ts");

function withRows(rows) {
  listRowsOrError = { rows };
}
function withDbError(error) {
  listRowsOrError = { error };
}

function resetMutationState() {
  userLookupOrError = { rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "target@example.com" }] };
  roleLookupOrError = { rows: [{ id: "role-admin-uuid" }] };
  insertResultOrError = { row: { id: "staff-member-uuid", status: "ACTIVE" } };
  auditWrites = [];
  permissionMockState = { allow: true, role: "ADMIN" };
  internalOrgIdMock = async () => "e35cbc31-9604-4324-adc6-f6f5c1ffc248";
}

// -------------------------- listWorkforceMembers --------------------------

test("permission denial propagates unchanged — workforce.ts adds no logic of its own around requireStaffMember's redirect", async () => {
  permissionMockState = { allow: false };
  try {
    await assert.rejects(() => listWorkforceMembers(), /NEXT_REDIRECT/);
  } finally {
    permissionMockState = { allow: true };
  }
});

test("7. ADMIN row is returned correctly (userId/email/role/status/radarAccess preserved)", async () => {
  withRows([{ userId: "u-admin", email: "admin@example.com", role: "ADMIN", status: "ACTIVE", radarAccess: true }]);
  const rows = await listWorkforceMembers();
  assert.deepEqual(rows, [{ userId: "u-admin", email: "admin@example.com", role: "ADMIN", status: "ACTIVE", radarAccess: true }]);
});

test("8. MANAGER row is returned correctly", async () => {
  withRows([{ userId: "u-mgr", email: "mgr@example.com", role: "MANAGER", status: "ACTIVE", radarAccess: true }]);
  const rows = await listWorkforceMembers();
  assert.deepEqual(rows, [{ userId: "u-mgr", email: "mgr@example.com", role: "MANAGER", status: "ACTIVE", radarAccess: true }]);
});

test("9. EMPLOYEE row is returned correctly", async () => {
  withRows([{ userId: "u-emp", email: "emp@example.com", role: "EMPLOYEE", status: "ACTIVE", radarAccess: false }]);
  const rows = await listWorkforceMembers();
  assert.deepEqual(rows, [{ userId: "u-emp", email: "emp@example.com", role: "EMPLOYEE", status: "ACTIVE", radarAccess: false }]);
});

test("10. ACTIVE status preserved", async () => {
  withRows([{ userId: "u1", email: "a@example.com", role: "MANAGER", status: "ACTIVE", radarAccess: true }]);
  const [row] = await listWorkforceMembers();
  assert.equal(row.status, "ACTIVE");
});
test("11. SUSPENDED status preserved", async () => {
  withRows([{ userId: "u1", email: "a@example.com", role: "MANAGER", status: "SUSPENDED", radarAccess: true }]);
  const [row] = await listWorkforceMembers();
  assert.equal(row.status, "SUSPENDED");
});
test("12. OFFBOARDING status preserved", async () => {
  withRows([{ userId: "u1", email: "a@example.com", role: "EMPLOYEE", status: "OFFBOARDING", radarAccess: true }]);
  const [row] = await listWorkforceMembers();
  assert.equal(row.status, "OFFBOARDING");
});

test("12b. radarAccess true/false both pass through verbatim", async () => {
  withRows([
    { userId: "u1", email: "on@example.com", role: "MANAGER", status: "ACTIVE", radarAccess: true },
    { userId: "u2", email: "off@example.com", role: "EMPLOYEE", status: "ACTIVE", radarAccess: false },
  ]);
  const rows = await listWorkforceMembers();
  assert.equal(rows.find((r) => r.userId === "u1").radarAccess, true);
  assert.equal(rows.find((r) => r.userId === "u2").radarAccess, false);
});

test("13-16. response never exposes role_id / workspace_org_id / invited_by_user_id / OWNER flag / Clerk id, even if the row source carries them", async () => {
  withRows([
    {
      userId: "u1",
      email: "a@example.com",
      role: "ADMIN",
      status: "ACTIVE",
      radarAccess: true,
      role_id: "should-never-appear",
      workspace_org_id: "should-never-appear",
      invited_by_user_id: "should-never-appear",
      isOwner: true,
      ownerRoleUuid: "6a615714-4eb7-44f3-993b-f113292f0aa2",
      clerkUserId: "should-never-appear",
    },
  ]);
  const [row] = await listWorkforceMembers();
  assert.deepEqual(Object.keys(row).sort(), ["email", "radarAccess", "role", "status", "userId"]);
});

test("17-18. listWorkforceMembers accepts zero arguments — no parameter through which a workspace or identity could be supplied", () => {
  assert.equal(listWorkforceMembers.length, 0);
});

test("19. a DB query failure propagates (rejects) — never resolves to an empty list", async () => {
  withDbError(new Error("db unreachable"));
  try {
    await assert.rejects(() => listWorkforceMembers(), /db unreachable/);
  } finally {
    withRows([]);
  }
});

test("20. no internal workspace resolvable -> throws, never an empty list", async () => {
  internalOrgIdMock = async () => null;
  try {
    await assert.rejects(() => listWorkforceMembers(), /internal workspace is not configured/);
  } finally {
    internalOrgIdMock = async () => "e35cbc31-9604-4324-adc6-f6f5c1ffc248";
  }
});

test("empty workforce (zero rows) resolves to an empty array, not an error", async () => {
  withRows([]);
  const rows = await listWorkforceMembers();
  assert.deepEqual(rows, []);
});

// --------------------------- addWorkforceMember ---------------------------

test("R2B-1. authorized mutation succeeds and returns the new member", async () => {
  resetMutationState();
  const result = await addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ADMIN");
  // radarAccess: true — staff_members.radar_access's own column DEFAULT,
  // never set explicitly by the INSERT (see lib/actions/workforce.ts's
  // own comment at this exact return site).
  assert.deepEqual(result, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "target@example.com",
    role: "ADMIN",
    status: "ACTIVE",
    radarAccess: true,
  });
});

test("R2B-2. authorization denial propagates unchanged, before any DB write", async () => {
  resetMutationState();
  permissionMockState = { allow: false };
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ADMIN"), /NEXT_REDIRECT/);
  assert.deepEqual(auditWrites, [], "no audit write may occur when authorization is denied");
});

test("R2B-3. requests exactly WORKFORCE_MANAGE (asserted inside the @/lib/rbac/require-staff-member mock itself)", async () => {
  resetMutationState();
  await addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "MANAGER");
});

test("R2B-4. addWorkforceMember accepts no workspace/organization parameter — only (targetUserId, role)", () => {
  assert.equal(addWorkforceMember.length, 2);
});

test("R2B-5. the resolved internal workspace id, not any caller value, is what reaches the insert/audit write", async () => {
  resetMutationState();
  internalOrgIdMock = async () => "internal-org-from-server-only";
  await addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "EMPLOYEE");
  assert.equal(auditWrites[0].organizationId, "internal-org-from-server-only");
});

test("R2B-6. OWNER role is rejected before any DB write (positive allowlist, not a negative check)", async () => {
  resetMutationState();
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "OWNER"), /workforce role must be one of/);
  assert.deepEqual(auditWrites, [], "OWNER must never reach the insert/audit path");
});

test("R2B-7. unknown/malformed role is rejected before any DB write", async () => {
  resetMutationState();
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "SUPERADMIN"), /workforce role must be one of/);
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ""), /workforce role must be one of/);
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", null), /workforce role must be one of/);
  assert.deepEqual(auditWrites, []);
});

test("R2B-8. every positively-allowlisted role (ADMIN/MANAGER/EMPLOYEE) is accepted", async () => {
  for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
    resetMutationState();
    const result = await addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role);
    assert.equal(result.role, role);
  }
});

test("R2B-9. duplicate membership (DB unique-violation) is translated into a deterministic domain error, never a silent no-op or a role change", async () => {
  resetMutationState();
  const pgError = new Error("duplicate key value violates unique constraint \"staff_members_user_workspace_unique\"");
  pgError.code = "23505";
  insertResultOrError = { error: pgError };
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ADMIN"), /already a workforce member/);
});

test("R2B-10. missing internal workspace fails closed before any target/role lookup", async () => {
  resetMutationState();
  internalOrgIdMock = async () => null;
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ADMIN"), /internal workspace is not configured/);
  assert.deepEqual(auditWrites, []);
});

test("R2B-11. a non-unique-violation DB failure during insert propagates (fails closed), never resolves to a false success", async () => {
  resetMutationState();
  insertResultOrError = { error: new Error("connection terminated unexpectedly") };
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ADMIN"), /connection terminated unexpectedly/);
});

test("R2B-12. an existing OWNER cannot be mutated through this action — the target-user lookup and insert never special-case or accept an OWNER role parameter", async () => {
  resetMutationState();
  // Simulate targeting a user who already holds the workspace's OWNER
  // staff_members row: the insert collides with
  // staff_members_user_workspace_unique exactly like any other duplicate
  // — there is no code path that reads or changes the existing row.
  const pgError = new Error("duplicate key value violates unique constraint \"staff_members_user_workspace_unique\"");
  pgError.code = "23505";
  insertResultOrError = { error: pgError };
  await assert.rejects(() => addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ADMIN"), /already a workforce member/);
});

test("R2B-13. malformed target identity (not a UUID) is rejected before any DB lookup", async () => {
  resetMutationState();
  await assert.rejects(() => addWorkforceMember("not-a-uuid", "ADMIN"), /target user id must be a valid UUID/);
  await assert.rejects(() => addWorkforceMember("", "ADMIN"), /target user id must be a valid UUID/);
  await assert.rejects(() => addWorkforceMember("'; DROP TABLE staff_members; --", "ADMIN"), /target user id must be a valid UUID/);
});

test("R2B-13b. target user must already exist — a well-formed but unknown UUID is rejected", async () => {
  resetMutationState();
  userLookupOrError = { rows: [] };
  await assert.rejects(() => addWorkforceMember("00000000-0000-4000-8000-000000000000", "ADMIN"), /target user not found/);
});

test("R2B-14. no unintended role-change side effect — the insert always creates a NEW row (INSERT, never UPDATE) with exactly the requested role", async () => {
  resetMutationState();
  const result = await addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "MANAGER");
  assert.equal(result.role, "MANAGER");
  assert.deepEqual(auditWrites[0], {
    actorUserId: sessionMock.userId,
    organizationId: "e35cbc31-9604-4324-adc6-f6f5c1ffc248",
    action: "workforce.member_added",
    targetType: "staff_member",
    targetId: "staff-member-uuid",
    metadata: { targetUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "MANAGER" },
  });
});

test("R2B-15. audit actor is the authenticated caller's session userId, never a caller-suppliable value", async () => {
  resetMutationState();
  sessionMock = { userId: "distinct-actor-uuid" };
  try {
    await addWorkforceMember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ADMIN");
    assert.equal(auditWrites[0].actorUserId, "distinct-actor-uuid");
  } finally {
    sessionMock = { userId: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2" };
  }
});

// ---------------------- changeWorkforceMemberRole (R2C) ----------------------
// MANAGER <-> EMPLOYEE only. ADMIN tier protected, OWNER protected, ACTIVE
// only, no self-role change, server-serialized SET-TO-ROLE (SELECT ... FOR
// UPDATE), audit in the same transaction, previousRole from the LOCKED row.
// The REAL row lock / serialization / rollback are proven against a
// disposable Postgres by lib/actions/workforce.integration.test.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const R2C_SESSION_UUID = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2"; // == default sessionMock.userId
const R2C_TARGET_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // != session
const R2C_INTERNAL_ORG = "e35cbc31-9604-4324-adc6-f6f5c1ffc248";

function r2cReset() {
  permissionMockState = { allow: true };
  internalOrgIdMock = async () => R2C_INTERNAL_ORG;
  sessionMock = { userId: R2C_SESSION_UUID };
  auditWrites = [];
  r2cAdvisory = { rows: [] };
  r2cLockedRow = { rows: [] };
  r2cTxStaffRolesQueue = [];
  r2cUpdateReturning = { rows: [{ status: "ACTIVE" }] };
  r2cUpdateSetCapture = null;
  r2cUpdateForUpdateUsed = false;
  r2cAuditFailure = null;
}

/** Wire advisory + locked + tx staff_roles queue for a call that should
 * reach (or nearly reach) the UPDATE. currentRole/lockedRole default equal. */
function r2cWire({ currentRole = "MANAGER", lockedRole = currentRole, status = "ACTIVE", newRole = "EMPLOYEE", radarAccess = true } = {}) {
  r2cAdvisory = { rows: [{ staffMemberId: "sm-1", currentRoleName: currentRole, status, email: "t@example.com", radarAccess }] };
  r2cLockedRow = { rows: [{ id: "sm-1", roleId: `role-${lockedRole}`, status }] };
  r2cTxStaffRolesQueue = [{ rows: [{ name: lockedRole }] }, { rows: [{ id: `role-${newRole}` }] }];
  r2cUpdateReturning = { rows: [{ status }] };
}

test("R2C-1. first op is requireStaffMember('WORKFORCE_MANAGE'); a denial rejects, no audit", async () => {
  r2cReset();
  permissionMockState = { allow: false };
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER"), /NEXT_REDIRECT/);
  assert.deepEqual(auditWrites, []);
  permissionMockState = { allow: true };
});

test("R2C-2. accepts exactly two runtime parameters — no workspace/org/actor arg", () => {
  assert.equal(changeWorkforceMemberRole.length, 2);
});

test("R2C-3. malformed / empty target UUID -> 'valid UUID', before any lookup, no audit", async () => {
  for (const bad of ["not-a-uuid", "", "'; DROP TABLE staff_members; --"]) {
    r2cReset();
    await assert.rejects(() => changeWorkforceMemberRole(bad, "MANAGER"), /target user id must be a valid UUID/);
    assert.deepEqual(auditWrites, []);
  }
});

test("R2C-4. self-target rejected before any membership lookup, no UPDATE, no audit", async () => {
  r2cReset();
  await assert.rejects(() => changeWorkforceMemberRole(R2C_SESSION_UUID, "MANAGER"), /cannot change their own role/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2C-5. newRole allowlist: ADMIN / OWNER / unknown / '' / null -> 'must be one of: MANAGER, EMPLOYEE', no audit", async () => {
  for (const bad of ["ADMIN", "OWNER", "SUPERADMIN", "manager", "", null]) {
    r2cReset();
    await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, bad), /workforce role must be one of: MANAGER, EMPLOYEE/);
    assert.deepEqual(auditWrites, []);
    assert.equal(r2cUpdateSetCapture, null);
  }
});

test("R2C-6. no internal workspace -> 'internal workspace is not configured'", async () => {
  r2cReset();
  internalOrgIdMock = async () => null;
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER"), /internal workspace is not configured/);
  internalOrgIdMock = async () => R2C_INTERNAL_ORG;
});

test("R2C-7. no membership row -> MEMBER_NOT_FOUND, no audit", async () => {
  r2cReset();
  r2cAdvisory = { rows: [] };
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER"), /workforce member not found/);
  assert.deepEqual(auditWrites, []);
});

test("R2C-8. advisory current role OWNER -> OWNER_PROTECTED, no UPDATE, no audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "OWNER", newRole: "MANAGER" });
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER"), /workspace owner and cannot be modified here/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2C-9. advisory current role ADMIN -> ADMIN_TIER_PROTECTED, no UPDATE, no audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "ADMIN", newRole: "MANAGER" });
  await assert.rejects(
    () => changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER"),
    /changing an administrator's role requires owner privileges/,
  );
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2C-10. advisory status SUSPENDED / OFFBOARDING -> TARGET_NOT_MUTABLE, no UPDATE, no audit", async () => {
  for (const status of ["SUSPENDED", "OFFBOARDING"]) {
    r2cReset();
    r2cWire({ currentRole: "MANAGER", status, newRole: "EMPLOYEE" });
    await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE"), /not active and cannot be modified/);
    assert.equal(r2cUpdateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("R2C-11. advisory no-op (current role === newRole) -> ROLE_UNCHANGED, no UPDATE, no audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "MANAGER", newRole: "MANAGER" });
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER"), /already has this role/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2C-12. UNDER-LOCK no-op: advisory role stale (EMPLOYEE), locked role is already MANAGER -> ROLE_UNCHANGED, no UPDATE, no audit", async () => {
  r2cReset();
  // advisory says EMPLOYEE (so advisory passes for newRole MANAGER), but the
  // FOR UPDATE-locked row already reads MANAGER.
  r2cWire({ currentRole: "EMPLOYEE", lockedRole: "MANAGER", newRole: "MANAGER" });
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER"), /already has this role/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2C-13. UNDER-LOCK OWNER protection: advisory MANAGER but locked role OWNER -> OWNER_PROTECTED, no UPDATE, no audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "MANAGER", lockedRole: "OWNER", newRole: "EMPLOYEE" });
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE"), /workspace owner and cannot be modified here/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2C-14. MANAGER -> EMPLOYEE success: returns member, uses FOR UPDATE, sets ONLY roleId + updatedAt, one audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "MANAGER", newRole: "EMPLOYEE" });
  const result = await changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE");
  // radarAccess is untouched by a role change — verbatim from the advisory
  // row (r2cWire()'s default true).
  assert.deepEqual(result, { userId: R2C_TARGET_UUID, email: "t@example.com", role: "EMPLOYEE", status: "ACTIVE", radarAccess: true });
  assert.equal(r2cUpdateForUpdateUsed, true, "the target row must be locked with SELECT ... FOR UPDATE");
  assert.deepEqual(Object.keys(r2cUpdateSetCapture).sort(), ["roleId", "updatedAt"], "only role_id + updated_at may be written");
  assert.equal(r2cUpdateSetCapture.roleId, "role-EMPLOYEE");
  assert.ok(r2cUpdateSetCapture.updatedAt instanceof Date);
  assert.equal(auditWrites.length, 1);
  assert.deepEqual(auditWrites[0], {
    actorUserId: R2C_SESSION_UUID,
    organizationId: R2C_INTERNAL_ORG,
    action: "workforce.member_role_changed",
    targetType: "staff_member",
    targetId: "sm-1",
    metadata: { targetUserId: R2C_TARGET_UUID, previousRole: "MANAGER", newRole: "EMPLOYEE" },
  });
});

test("R2C-15. EMPLOYEE -> MANAGER success (symmetric)", async () => {
  r2cReset();
  r2cWire({ currentRole: "EMPLOYEE", newRole: "MANAGER" });
  const result = await changeWorkforceMemberRole(R2C_TARGET_UUID, "MANAGER");
  assert.equal(result.role, "MANAGER");
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0].metadata.previousRole, "EMPLOYEE");
  assert.equal(auditWrites[0].metadata.newRole, "MANAGER");
  assert.equal(r2cUpdateSetCapture.roleId, "role-MANAGER");
});

test("R2C-16. audit organization is the server-resolved internal workspace, not any caller value", async () => {
  r2cReset();
  internalOrgIdMock = async () => "internal-org-from-server-only";
  r2cWire({ currentRole: "MANAGER", newRole: "EMPLOYEE" });
  await changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE");
  assert.equal(auditWrites[0].organizationId, "internal-org-from-server-only");
  internalOrgIdMock = async () => R2C_INTERNAL_ORG;
});

test("R2C-17. audit actor is the authenticated session userId, never a caller value", async () => {
  r2cReset();
  sessionMock = { userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
  r2cWire({ currentRole: "MANAGER", newRole: "EMPLOYEE" });
  await changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE");
  assert.equal(auditWrites[0].actorUserId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  sessionMock = { userId: R2C_SESSION_UUID };
});

test("R2C-18. optimistic UPDATE affects 0 rows -> MEMBER_STATE_CHANGED, no audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "MANAGER", newRole: "EMPLOYEE" });
  r2cUpdateReturning = { rows: [] };
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE"), /workforce member state changed, please retry/);
  assert.deepEqual(auditWrites, []);
});

test("R2C-19. locked row vanished between advisory and lock -> MEMBER_STATE_CHANGED, no audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "MANAGER", newRole: "EMPLOYEE" });
  r2cLockedRow = { rows: [] };
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE"), /workforce member state changed, please retry/);
  assert.deepEqual(auditWrites, []);
});

test("R2C-20. an advisory-lookup DB failure propagates (rejects), never a false success", async () => {
  r2cReset();
  r2cAdvisory = { error: new Error("db unreachable") };
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE"), /db unreachable/);
});

test("R2C-21. an in-transaction UPDATE DB failure propagates (fails closed), no audit", async () => {
  r2cReset();
  r2cWire({ currentRole: "MANAGER", newRole: "EMPLOYEE" });
  r2cUpdateReturning = { error: new Error("connection terminated unexpectedly") };
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE"), /connection terminated unexpectedly/);
  assert.deepEqual(auditWrites, []);
});

test("R2C-22. audit failure inside the transaction propagates (rolls the change back)", async () => {
  r2cReset();
  r2cWire({ currentRole: "MANAGER", newRole: "EMPLOYEE" });
  r2cAuditFailure = new Error("audit write failed");
  await assert.rejects(() => changeWorkforceMemberRole(R2C_TARGET_UUID, "EMPLOYEE"), /audit write failed/);
  r2cAuditFailure = null;
});

test("R2C-23. source invariants: previousRole from the LOCKED row, no email authorization, no Axis A/B, exact runtime export surface", () => {
  const src = readFileSync(fileURLToPath(new URL("./workforce.ts", import.meta.url)), "utf8");
  const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l)).join("\n");
  assert.ok(!imports.includes("@/lib/dev-role"), "no legacy AppRole gate import");
  assert.ok(!imports.includes("@/lib/actions/users"), "no Axis A user-action import");
  assert.ok(!imports.includes("requireAdminRole"), "no requireAdminRole import (docstring mentions of its absence are fine)");
  assert.ok(!/\bmemberships\b/.test(imports) && !/\bauditDb\b/.test(imports), "no Axis A memberships / Axis B auditDb import");
  assert.ok(src.includes("previousRole: lockedRole.name"), "audit previousRole must be sourced from the FOR UPDATE-locked row");
  assert.ok(!/previousRole:\s*member\.currentRoleName/.test(src), "audit previousRole must NOT be the advisory value");
  const runtimeExports = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(runtimeExports, [
    "addWorkforceMember",
    "changeWorkforceMemberRole",
    "listWorkforceMembers",
    "offboardWorkforceMember",
    "reactivateWorkforceMember",
    "setWorkforceMemberRadarAccess",
    "suspendWorkforceMember",
  ]);
});

// ---------------------- workforce lifecycle (R2D-A) ----------------------
// suspend / reactivate / offboard, MANAGER/EMPLOYEE only. OFFBOARDING is
// terminal. Server-serialized SET-TO-STATUS, previousStatus from the LOCKED
// row, one same-transaction audit. Reuses the R2C @/db fake verbatim (the
// advisory 3-join lookup, the FOR UPDATE lock, the tx staff_roles queue —
// here just one entry for the locked role name — and the tx update capture).
// The REAL row lock / serialization / rollback are proven against a
// disposable Postgres by lib/actions/workforce.integration.test.mjs.

const R2D_SESSION_UUID = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2"; // == default sessionMock.userId
const R2D_TARGET_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // != session

function r2dReset() {
  permissionMockState = { allow: true };
  internalOrgIdMock = async () => R2C_INTERNAL_ORG;
  sessionMock = { userId: R2D_SESSION_UUID };
  auditWrites = [];
  r2cAdvisory = { rows: [] };
  r2cLockedRow = { rows: [] };
  r2cTxStaffRolesQueue = [];
  r2cUpdateReturning = { rows: [{ status: "ACTIVE" }] };
  r2cUpdateSetCapture = null;
  r2cUpdateForUpdateUsed = false;
  r2cAuditFailure = null;
}

/** Wire advisory + locked-row + tx staff_roles queue + UPDATE RETURNING for
 * a lifecycle call. currentRole/lockedRole and currentStatus/lockedStatus
 * default equal; set them apart to exercise the under-lock re-checks. */
function r2dWire({ currentRole = "MANAGER", lockedRole = currentRole, currentStatus = "ACTIVE", lockedStatus = currentStatus, resultStatus, radarAccess = true } = {}) {
  r2cAdvisory = { rows: [{ staffMemberId: "sm-d1", currentRoleName: currentRole, currentStatus, email: "life@example.com", radarAccess }] };
  r2cLockedRow = { rows: [{ id: "sm-d1", roleId: `role-${lockedRole}`, status: lockedStatus }] };
  r2cTxStaffRolesQueue = [{ rows: [{ name: lockedRole }] }];
  r2cUpdateReturning = { rows: [{ status: resultStatus ?? lockedStatus }] };
}

const R2D_FNS = {
  suspend: { fn: () => suspendWorkforceMember, target: "SUSPENDED" },
  reactivate: { fn: () => reactivateWorkforceMember, target: "ACTIVE" },
  offboard: { fn: () => offboardWorkforceMember, target: "OFFBOARDING" },
};

test("R2D-1. each lifecycle function's first op is requireStaffMember('WORKFORCE_MANAGE'); a denial rejects, no audit, no lookup", async () => {
  for (const { fn } of Object.values(R2D_FNS)) {
    r2dReset();
    permissionMockState = { allow: false };
    await assert.rejects(() => fn()(R2D_TARGET_UUID), /NEXT_REDIRECT/);
    assert.deepEqual(auditWrites, []);
    assert.equal(r2cUpdateSetCapture, null);
    permissionMockState = { allow: true };
  }
});

test("R2D-2. each lifecycle function accepts exactly one runtime parameter", () => {
  assert.equal(suspendWorkforceMember.length, 1);
  assert.equal(reactivateWorkforceMember.length, 1);
  assert.equal(offboardWorkforceMember.length, 1);
});

test("R2D-3. malformed / empty / SQL-ish targetUserId -> 'valid UUID', before any lookup, no audit", async () => {
  for (const { fn } of Object.values(R2D_FNS)) {
    for (const bad of ["not-a-uuid", "", "'; DROP TABLE staff_members; --"]) {
      r2dReset();
      await assert.rejects(() => fn()(bad), /target user id must be a valid UUID/);
      assert.deepEqual(auditWrites, []);
      assert.equal(r2cUpdateSetCapture, null);
    }
  }
});

test("R2D-4. self-target rejected before any membership lookup, no UPDATE, no audit", async () => {
  for (const { fn } of Object.values(R2D_FNS)) {
    r2dReset();
    await assert.rejects(() => fn()(R2D_SESSION_UUID), /workforce members cannot change their own lifecycle status/);
    assert.equal(r2cUpdateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("R2D-5. no internal workspace -> 'internal workspace is not configured'", async () => {
  for (const { fn } of Object.values(R2D_FNS)) {
    r2dReset();
    internalOrgIdMock = async () => null;
    await assert.rejects(() => fn()(R2D_TARGET_UUID), /internal workspace is not configured/);
    internalOrgIdMock = async () => R2C_INTERNAL_ORG;
  }
});

test("R2D-6. no membership row -> MEMBER_NOT_FOUND, no audit", async () => {
  for (const { fn } of Object.values(R2D_FNS)) {
    r2dReset();
    r2cAdvisory = { rows: [] };
    await assert.rejects(() => fn()(R2D_TARGET_UUID), /workforce member not found/);
    assert.deepEqual(auditWrites, []);
  }
});

test("R2D-7. advisory current role OWNER -> OWNER_PROTECTED, no UPDATE, no audit", async () => {
  for (const { fn, target } of Object.values(R2D_FNS)) {
    r2dReset();
    r2dWire({ currentRole: "OWNER", currentStatus: target === "ACTIVE" ? "SUSPENDED" : "ACTIVE" });
    await assert.rejects(() => fn()(R2D_TARGET_UUID), /target is the workspace owner and cannot be modified here/);
    assert.equal(r2cUpdateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("R2D-8. advisory current role ADMIN -> ADMIN_TIER_PROTECTED (lifecycle message), no UPDATE, no audit", async () => {
  for (const { fn, target } of Object.values(R2D_FNS)) {
    r2dReset();
    r2dWire({ currentRole: "ADMIN", currentStatus: target === "ACTIVE" ? "SUSPENDED" : "ACTIVE" });
    await assert.rejects(() => fn()(R2D_TARGET_UUID), /an administrator's lifecycle requires owner privileges/);
    assert.equal(r2cUpdateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("R2D-9. UNDER-LOCK OWNER protection: advisory MANAGER but locked role OWNER -> OWNER_PROTECTED, no UPDATE, no audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", lockedRole: "OWNER", currentStatus: "ACTIVE" });
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /target is the workspace owner and cannot be modified here/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2D-10. UNDER-LOCK ADMIN protection: advisory MANAGER but locked role ADMIN -> ADMIN_TIER_PROTECTED, no UPDATE, no audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", lockedRole: "ADMIN", currentStatus: "ACTIVE" });
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /an administrator's lifecycle requires owner privileges/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2D-11. ACTIVE -> SUSPENDED success: FOR UPDATE used, sets ONLY status + updatedAt, one truthful audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE", resultStatus: "SUSPENDED" });
  const result = await suspendWorkforceMember(R2D_TARGET_UUID);
  // radarAccess is untouched by a lifecycle status change — verbatim from
  // the advisory row (r2dWire()'s default true).
  assert.deepEqual(result, { userId: R2D_TARGET_UUID, email: "life@example.com", role: "MANAGER", status: "SUSPENDED", radarAccess: true });
  assert.equal(r2cUpdateForUpdateUsed, true, "the target row must be locked with SELECT ... FOR UPDATE");
  assert.deepEqual(Object.keys(r2cUpdateSetCapture).sort(), ["status", "updatedAt"], "only status + updated_at may be written");
  assert.equal(r2cUpdateSetCapture.status, "SUSPENDED");
  assert.ok(r2cUpdateSetCapture.updatedAt instanceof Date);
  assert.equal(auditWrites.length, 1);
  assert.deepEqual(auditWrites[0], {
    actorUserId: R2D_SESSION_UUID,
    organizationId: R2C_INTERNAL_ORG,
    action: "workforce.member_status_changed",
    targetType: "staff_member",
    targetId: "sm-d1",
    metadata: { targetUserId: R2D_TARGET_UUID, previousStatus: "ACTIVE", newStatus: "SUSPENDED" },
  });
});

test("R2D-12. SUSPENDED -> ACTIVE success (reactivate)", async () => {
  r2dReset();
  r2dWire({ currentRole: "EMPLOYEE", currentStatus: "SUSPENDED", resultStatus: "ACTIVE" });
  const result = await reactivateWorkforceMember(R2D_TARGET_UUID);
  assert.deepEqual(result, { userId: R2D_TARGET_UUID, email: "life@example.com", role: "EMPLOYEE", status: "ACTIVE", radarAccess: true });
  assert.equal(r2cUpdateSetCapture.status, "ACTIVE");
  assert.equal(auditWrites.length, 1);
  assert.deepEqual(auditWrites[0].metadata, { targetUserId: R2D_TARGET_UUID, previousStatus: "SUSPENDED", newStatus: "ACTIVE" });
});

test("R2D-13. ACTIVE -> OFFBOARDING and SUSPENDED -> OFFBOARDING succeed", async () => {
  for (const from of ["ACTIVE", "SUSPENDED"]) {
    r2dReset();
    r2dWire({ currentRole: "MANAGER", currentStatus: from, resultStatus: "OFFBOARDING" });
    const result = await offboardWorkforceMember(R2D_TARGET_UUID);
    assert.equal(result.status, "OFFBOARDING");
    assert.equal(r2cUpdateSetCapture.status, "OFFBOARDING");
    assert.equal(auditWrites.length, 1);
    assert.deepEqual(auditWrites[0].metadata, { targetUserId: R2D_TARGET_UUID, previousStatus: from, newStatus: "OFFBOARDING" });
  }
});

test("R2D-14. no-op: suspend a SUSPENDED / reactivate an ACTIVE / offboard an OFFBOARDING -> STATUS_UNCHANGED, no UPDATE, no audit", async () => {
  const cases = [
    [() => suspendWorkforceMember, "SUSPENDED"],
    [() => reactivateWorkforceMember, "ACTIVE"],
    [() => offboardWorkforceMember, "OFFBOARDING"],
  ];
  for (const [fn, status] of cases) {
    r2dReset();
    r2dWire({ currentRole: "MANAGER", currentStatus: status });
    await assert.rejects(() => fn()(R2D_TARGET_UUID), /workforce member already has this status/);
    assert.equal(r2cUpdateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("R2D-15. INVALID_STATUS_TRANSITION: an OFFBOARDING member cannot be suspended directly (must be reactivated first — WORKFORCE REACTIVATION PHASE 1)", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "OFFBOARDING" });
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /this lifecycle transition is not allowed/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("WR-1. WORKFORCE REACTIVATION PHASE 1: reactivateWorkforceMember() now accepts OFFBOARDING -> ACTIVE (no longer terminal)", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "OFFBOARDING", resultStatus: "ACTIVE" });
  const result = await reactivateWorkforceMember(R2D_TARGET_UUID);
  assert.equal(result.status, "ACTIVE");
  assert.deepEqual(r2cUpdateSetCapture, { status: "ACTIVE", updatedAt: r2cUpdateSetCapture.updatedAt });
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0].action, "workforce.member_status_changed");
  assert.deepEqual(auditWrites[0].metadata, { targetUserId: R2D_TARGET_UUID, previousStatus: "OFFBOARDING", newStatus: "ACTIVE" });
});

test("WR-2. reactivating from OFFBOARDING preserves role and radarAccess verbatim (never a re-add)", async () => {
  r2dReset();
  r2dWire({ currentRole: "EMPLOYEE", currentStatus: "OFFBOARDING", resultStatus: "ACTIVE", radarAccess: true });
  const result = await reactivateWorkforceMember(R2D_TARGET_UUID);
  assert.deepEqual(result, { userId: R2D_TARGET_UUID, email: "life@example.com", role: "EMPLOYEE", status: "ACTIVE", radarAccess: true });
});

test("WR-3. OWNER caller can reactivate an OFFBOARDING EMPLOYEE and an OFFBOARDING MANAGER", async () => {
  for (const role of ["EMPLOYEE", "MANAGER"]) {
    r2dReset();
    permissionMockState = { allow: true, role: "OWNER" };
    r2dWire({ currentRole: role, currentStatus: "OFFBOARDING", resultStatus: "ACTIVE" });
    const result = await reactivateWorkforceMember(R2D_TARGET_UUID);
    assert.equal(result.status, "ACTIVE");
    assert.equal(result.role, role);
  }
});

test("WR-4. ADMIN caller can reactivate an OFFBOARDING EMPLOYEE and an OFFBOARDING MANAGER", async () => {
  for (const role of ["EMPLOYEE", "MANAGER"]) {
    r2dReset();
    permissionMockState = { allow: true, role: "ADMIN" };
    r2dWire({ currentRole: role, currentStatus: "OFFBOARDING", resultStatus: "ACTIVE" });
    const result = await reactivateWorkforceMember(R2D_TARGET_UUID);
    assert.equal(result.status, "ACTIVE");
    assert.equal(result.role, role);
  }
});

test("WR-5. ADMIN caller cannot reactivate an OFFBOARDING ADMIN (ordinary R2D-A tier protection unchanged)", async () => {
  r2dReset();
  permissionMockState = { allow: true, role: "ADMIN" };
  r2dWire({ currentRole: "ADMIN", currentStatus: "OFFBOARDING" });
  await assert.rejects(() => reactivateWorkforceMember(R2D_TARGET_UUID), /an administrator's lifecycle requires owner privileges/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("WR-6. nobody can reactivate an OFFBOARDING OWNER (unreachable, unconditionally)", async () => {
  r2dReset();
  permissionMockState = { allow: true, role: "OWNER" };
  r2dWire({ currentRole: "OWNER", currentStatus: "OFFBOARDING" });
  await assert.rejects(() => reactivateWorkforceMember(R2D_TARGET_UUID), /target is the workspace owner and cannot be modified here/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("WR-7. self-reactivation from OFFBOARDING is still refused", async () => {
  r2dReset();
  r2dWire({ currentRole: "EMPLOYEE", currentStatus: "OFFBOARDING" });
  await assert.rejects(() => reactivateWorkforceMember(R2D_SESSION_UUID), /workforce members cannot change their own lifecycle status/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2D-16. UNDER-LOCK no-op: advisory status stale (ACTIVE), locked status already SUSPENDED -> STATUS_UNCHANGED, no UPDATE, no audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE", lockedStatus: "SUSPENDED" });
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /workforce member already has this status/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2D-17. UNDER-LOCK invalid transition: advisory ACTIVE, locked status OFFBOARDING -> INVALID_STATUS_TRANSITION, no UPDATE, no audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE", lockedStatus: "OFFBOARDING" });
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /this lifecycle transition is not allowed/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("R2D-18. locked row vanished between advisory and lock -> MEMBER_STATE_CHANGED, no audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE" });
  r2cLockedRow = { rows: [] };
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /workforce member state changed, please retry/);
  assert.deepEqual(auditWrites, []);
});

test("R2D-19. optimistic UPDATE affects 0 rows -> MEMBER_STATE_CHANGED, no audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE" });
  r2cUpdateReturning = { rows: [] };
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /workforce member state changed, please retry/);
  assert.deepEqual(auditWrites, []);
});

test("R2D-20. advisory-lookup DB failure propagates, never a false success", async () => {
  r2dReset();
  r2cAdvisory = { error: new Error("db unreachable") };
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /db unreachable/);
});

test("R2D-21. in-transaction UPDATE DB failure propagates (fails closed), no audit", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE" });
  r2cUpdateReturning = { error: new Error("connection terminated unexpectedly") };
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /connection terminated unexpectedly/);
  assert.deepEqual(auditWrites, []);
});

test("R2D-22. audit failure inside the transaction propagates (rolls the change back)", async () => {
  r2dReset();
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE" });
  r2cAuditFailure = new Error("audit write failed");
  await assert.rejects(() => suspendWorkforceMember(R2D_TARGET_UUID), /audit write failed/);
  r2cAuditFailure = null;
});

test("R2D-23. audit organization is the server-resolved internal workspace, not any caller value; actor is the session userId", async () => {
  r2dReset();
  internalOrgIdMock = async () => "internal-org-from-server-only";
  sessionMock = { userId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
  r2dWire({ currentRole: "MANAGER", currentStatus: "ACTIVE", resultStatus: "SUSPENDED" });
  await suspendWorkforceMember(R2D_TARGET_UUID);
  assert.equal(auditWrites[0].organizationId, "internal-org-from-server-only");
  assert.equal(auditWrites[0].actorUserId, "ffffffff-ffff-4fff-8fff-ffffffffffff");
  internalOrgIdMock = async () => R2C_INTERNAL_ORG;
  sessionMock = { userId: R2D_SESSION_UUID };
});

test("R2D-24. source invariants: previousStatus from locked.status, only status+updatedAt in the R2D UPDATE, no Axis A/B, exactly seven runtime exports", () => {
  const src = readFileSync(fileURLToPath(new URL("./workforce.ts", import.meta.url)), "utf8");
  assert.ok(src.includes("previousStatus: locked.status"), "audit previousStatus must be the FOR UPDATE-locked status");
  assert.ok(!/previousStatus:\s*member\.currentStatus/.test(src), "audit previousStatus must NOT be the advisory value");
  // The R2D update helper's SET clause: status + updatedAt only.
  assert.ok(src.includes(".set({ status: params.targetStatus, updatedAt: new Date() })"), "R2D UPDATE writes exactly status + updated_at");
  const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l)).join("\n");
  assert.ok(!imports.includes("@/lib/dev-role") && !imports.includes("@/lib/actions/users"), "no Axis A imports");
  assert.ok(!/\bmemberships\b/.test(imports) && !/\bauditDb\b/.test(imports), "no Axis A memberships / Axis B auditDb import");
  const runtimeExports = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(runtimeExports, [
    "addWorkforceMember",
    "changeWorkforceMemberRole",
    "listWorkforceMembers",
    "offboardWorkforceMember",
    "reactivateWorkforceMember",
    "setWorkforceMemberRadarAccess",
    "suspendWorkforceMember",
  ]);
});

// ---------------------- setWorkforceMemberRadarAccess (WORKFORCE ACCESS CONTROL) ----------------------
// Individual RADAR access override, independent of role: OWNER/ADMIN may
// grant/revoke a MANAGER or EMPLOYEE's RADAR access WITHOUT changing their
// staff role. DELIBERATELY DIFFERENT target-tier rule from R2C: OWNER may
// still change an ADMIN's radar access; ADMIN may not (only OWNER may).
// OWNER itself is never a valid target either way. ACTIVE only, no self-
// change, server-serialized SET-TO-VALUE (SELECT ... FOR UPDATE), audit in
// the same transaction. Reuses the R2C @/db fake verbatim — the advisory
// 3-join lookup, the FOR UPDATE lock, the tx staff_roles queue (here just
// one entry for the locked role name — no "new role id" lookup, since this
// writes a boolean, never role_id), and the tx update capture. The REAL
// row lock / serialization / rollback are proven against a disposable
// Postgres by lib/actions/workforce.integration.test.mjs.

const RAC_SESSION_UUID = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2"; // == default sessionMock.userId
const RAC_TARGET_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // != session
const RAC_INTERNAL_ORG = "e35cbc31-9604-4324-adc6-f6f5c1ffc248";

function racReset(actorRole = "ADMIN") {
  permissionMockState = { allow: true, role: actorRole };
  internalOrgIdMock = async () => RAC_INTERNAL_ORG;
  sessionMock = { userId: RAC_SESSION_UUID };
  auditWrites = [];
  r2cAdvisory = { rows: [] };
  r2cLockedRow = { rows: [] };
  r2cTxStaffRolesQueue = [];
  r2cUpdateReturning = { rows: [{ status: "ACTIVE" }] };
  r2cUpdateSetCapture = null;
  r2cUpdateForUpdateUsed = false;
  r2cAuditFailure = null;
}

/** Wire advisory + locked + tx staff_roles queue for a radar-access call.
 * Only ONE staff_roles lookup happens in the tx (locked role name) — unlike
 * r2cWire()'s two (this action never resolves a "new role id"). */
function racWire({ currentRole = "MANAGER", lockedRole = currentRole, status = "ACTIVE", radarAccess = true, lockedRadarAccess = radarAccess } = {}) {
  r2cAdvisory = { rows: [{ staffMemberId: "sm-ra1", currentRoleName: currentRole, status, email: "ra@example.com", radarAccess }] };
  r2cLockedRow = { rows: [{ id: "sm-ra1", roleId: `role-${lockedRole}`, status, radarAccess: lockedRadarAccess }] };
  r2cTxStaffRolesQueue = [{ rows: [{ name: lockedRole }] }];
  r2cUpdateReturning = { rows: [{ status }] };
}

test("RAC-1. first op is requireStaffMember('WORKFORCE_MANAGE'); a denial rejects, no audit", async () => {
  racReset();
  permissionMockState.allow = false;
  await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false), /NEXT_REDIRECT/);
  assert.deepEqual(auditWrites, []);
});

test("RAC-2. accepts exactly two runtime parameters (targetUserId, enabled) — no workspace/org/actor arg", () => {
  assert.equal(setWorkforceMemberRadarAccess.length, 2);
});

test("RAC-3. malformed / empty target UUID -> 'valid UUID', before any lookup, no audit", async () => {
  for (const bad of ["not-a-uuid", "", "'; DROP TABLE staff_members; --"]) {
    racReset();
    await assert.rejects(() => setWorkforceMemberRadarAccess(bad, false), /target user id must be a valid UUID/);
    assert.deepEqual(auditWrites, []);
  }
});

test("RAC-4. non-boolean enabled value -> 'must be a boolean', before any lookup, no audit", async () => {
  for (const bad of ["true", 1, 0, null, undefined, "false", {}]) {
    racReset();
    await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, bad), /radar access value must be a boolean/);
    assert.deepEqual(auditWrites, []);
  }
});

test("RAC-5. self-target rejected before any membership lookup, no UPDATE, no audit", async () => {
  racReset();
  await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_SESSION_UUID, false), /cannot change their own radar access/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("RAC-6. no internal workspace -> 'internal workspace is not configured'", async () => {
  racReset();
  internalOrgIdMock = async () => null;
  await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false), /internal workspace is not configured/);
});

test("RAC-7. no membership row -> MEMBER_NOT_FOUND, no audit", async () => {
  racReset();
  r2cAdvisory = { rows: [] };
  await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false), /workforce member not found/);
  assert.deepEqual(auditWrites, []);
});

test("RAC-8. OWNER target is ALWAYS rejected — even when the actor is themselves OWNER", async () => {
  for (const actorRole of ["OWNER", "ADMIN"]) {
    racReset(actorRole);
    racWire({ currentRole: "OWNER" });
    await assert.rejects(
      () => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false),
      /workspace owner and cannot be modified here/,
      `actor ${actorRole} must still be rejected against an OWNER target`,
    );
    assert.equal(r2cUpdateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("RAC-9. ADMIN target + ADMIN actor -> ADMIN_TIER_PROTECTED, no UPDATE, no audit (DIFFERENT from R2C: here OWNER alone may proceed)", async () => {
  racReset("ADMIN");
  racWire({ currentRole: "ADMIN" });
  await assert.rejects(
    () => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false),
    /changing an administrator's radar access requires owner privileges/,
  );
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("RAC-10. ADMIN target + OWNER actor -> SUCCEEDS — the key behavior that differs from changeWorkforceMemberRole()'s unconditional ADMIN rejection", async () => {
  racReset("OWNER");
  racWire({ currentRole: "ADMIN", radarAccess: true });
  const result = await setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false);
  assert.equal(result.radarAccess, false);
  assert.equal(auditWrites.length, 1);
  assert.deepEqual(Object.keys(r2cUpdateSetCapture).sort(), ["radarAccess", "updatedAt"]);
  assert.equal(r2cUpdateSetCapture.radarAccess, false);
});

test("RAC-11. advisory status SUSPENDED / OFFBOARDING -> not active, no UPDATE, no audit", async () => {
  for (const status of ["SUSPENDED", "OFFBOARDING"]) {
    racReset();
    racWire({ currentRole: "MANAGER", status });
    await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false), /not active and cannot be modified/);
    assert.equal(r2cUpdateSetCapture, null);
    assert.deepEqual(auditWrites, []);
  }
});

test("RAC-12. advisory no-op (radarAccess already matches requested value) -> unchanged, no UPDATE, no audit", async () => {
  racReset();
  racWire({ currentRole: "MANAGER", radarAccess: true });
  await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, true), /already has this radar access value/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("RAC-13. UNDER-LOCK no-op: advisory radarAccess stale (true), locked value already false -> unchanged, no UPDATE, no audit", async () => {
  racReset();
  racWire({ currentRole: "MANAGER", radarAccess: true, lockedRadarAccess: false });
  await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false), /already has this radar access value/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("RAC-14. UNDER-LOCK OWNER protection: advisory MANAGER but locked role OWNER -> OWNER_PROTECTED, no UPDATE, no audit", async () => {
  racReset();
  racWire({ currentRole: "MANAGER", lockedRole: "OWNER" });
  await assert.rejects(() => setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false), /workspace owner and cannot be modified here/);
  assert.equal(r2cUpdateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("RAC-15. MANAGER target, true -> false success: uses FOR UPDATE, sets ONLY radarAccess + updatedAt, one audit with previousValue/newValue", async () => {
  racReset("ADMIN");
  racWire({ currentRole: "MANAGER", radarAccess: true });
  const result = await setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false);
  assert.deepEqual(result, { userId: RAC_TARGET_UUID, email: "ra@example.com", role: "MANAGER", status: "ACTIVE", radarAccess: false });
  assert.equal(r2cUpdateForUpdateUsed, true, "the target row must be locked with SELECT ... FOR UPDATE");
  assert.deepEqual(Object.keys(r2cUpdateSetCapture).sort(), ["radarAccess", "updatedAt"], "only radar_access + updated_at may be written");
  assert.equal(r2cUpdateSetCapture.radarAccess, false);
  assert.ok(r2cUpdateSetCapture.updatedAt instanceof Date);
  assert.equal(auditWrites.length, 1);
  assert.deepEqual(auditWrites[0], {
    actorUserId: RAC_SESSION_UUID,
    organizationId: RAC_INTERNAL_ORG,
    action: "workforce.radar_access_changed",
    targetType: "staff_member",
    targetId: "sm-ra1",
    metadata: { targetUserId: RAC_TARGET_UUID, previousValue: true, newValue: false },
  });
});

test("RAC-16. EMPLOYEE target, false -> true success (symmetric)", async () => {
  racReset("ADMIN");
  racWire({ currentRole: "EMPLOYEE", radarAccess: false });
  const result = await setWorkforceMemberRadarAccess(RAC_TARGET_UUID, true);
  assert.equal(result.radarAccess, true);
  assert.equal(auditWrites.length, 1);
  assert.deepEqual(auditWrites[0].metadata, { targetUserId: RAC_TARGET_UUID, previousValue: false, newValue: true });
  assert.equal(r2cUpdateSetCapture.radarAccess, true);
});

test("RAC-17. role is NEVER part of the UPDATE — roleId is absent from the write regardless of target role", async () => {
  racReset("OWNER");
  racWire({ currentRole: "ADMIN", radarAccess: true });
  await setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false);
  assert.ok(!("roleId" in r2cUpdateSetCapture), "roleId must never be written by a radar-access change");
  assert.ok(!("status" in r2cUpdateSetCapture), "status must never be written by a radar-access change");
});

test("RAC-18. audit organization is the server-resolved internal workspace, not any caller value", async () => {
  racReset("ADMIN");
  racWire({ currentRole: "MANAGER", radarAccess: true });
  await setWorkforceMemberRadarAccess(RAC_TARGET_UUID, false);
  assert.equal(auditWrites[0].organizationId, RAC_INTERNAL_ORG);
});

test("RAC-19. source invariants: previousValue from the LOCKED row, no email authorization, no Axis A/B imports", () => {
  const src = readFileSync(fileURLToPath(new URL("./workforce.ts", import.meta.url)), "utf8");
  assert.ok(src.includes("previousValue: locked.radarAccess"), "audit previousValue must be sourced from the FOR UPDATE-locked row");
  assert.ok(!/previousValue:\s*member\.radarAccess/.test(src), "audit previousValue must NOT be the advisory value");
  const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l)).join("\n");
  assert.ok(!imports.includes("@/lib/dev-role"), "no legacy AppRole gate import");
  assert.ok(!imports.includes("@/lib/actions/users"), "no Axis A user-action import");
  assert.ok(!/\bmemberships\b/.test(imports) && !/\bauditDb\b/.test(imports), "no Axis A memberships / Axis B auditDb import");
});
