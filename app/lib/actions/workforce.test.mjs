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

let permissionMockState = { allow: true };
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      assert.equal(permission, "WORKFORCE_MANAGE", "workforce.ts must request exactly WORKFORCE_MANAGE");
      if (!permissionMockState.allow) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "ADMIN";
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

const { listWorkforceMembers, addWorkforceMember, changeWorkforceMemberRole } = await import("./workforce.ts");

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
  permissionMockState = { allow: true };
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

test("7. ADMIN row is returned correctly (userId/email/role/status preserved)", async () => {
  withRows([{ userId: "u-admin", email: "admin@example.com", role: "ADMIN", status: "ACTIVE" }]);
  const rows = await listWorkforceMembers();
  assert.deepEqual(rows, [{ userId: "u-admin", email: "admin@example.com", role: "ADMIN", status: "ACTIVE" }]);
});

test("8. MANAGER row is returned correctly", async () => {
  withRows([{ userId: "u-mgr", email: "mgr@example.com", role: "MANAGER", status: "ACTIVE" }]);
  const rows = await listWorkforceMembers();
  assert.deepEqual(rows, [{ userId: "u-mgr", email: "mgr@example.com", role: "MANAGER", status: "ACTIVE" }]);
});

test("9. EMPLOYEE row is returned correctly", async () => {
  withRows([{ userId: "u-emp", email: "emp@example.com", role: "EMPLOYEE", status: "ACTIVE" }]);
  const rows = await listWorkforceMembers();
  assert.deepEqual(rows, [{ userId: "u-emp", email: "emp@example.com", role: "EMPLOYEE", status: "ACTIVE" }]);
});

test("10. ACTIVE status preserved", async () => {
  withRows([{ userId: "u1", email: "a@example.com", role: "MANAGER", status: "ACTIVE" }]);
  const [row] = await listWorkforceMembers();
  assert.equal(row.status, "ACTIVE");
});
test("11. SUSPENDED status preserved", async () => {
  withRows([{ userId: "u1", email: "a@example.com", role: "MANAGER", status: "SUSPENDED" }]);
  const [row] = await listWorkforceMembers();
  assert.equal(row.status, "SUSPENDED");
});
test("12. OFFBOARDING status preserved", async () => {
  withRows([{ userId: "u1", email: "a@example.com", role: "EMPLOYEE", status: "OFFBOARDING" }]);
  const [row] = await listWorkforceMembers();
  assert.equal(row.status, "OFFBOARDING");
});

test("13-16. response never exposes role_id / workspace_org_id / invited_by_user_id / OWNER flag / Clerk id, even if the row source carries them", async () => {
  withRows([
    {
      userId: "u1",
      email: "a@example.com",
      role: "ADMIN",
      status: "ACTIVE",
      role_id: "should-never-appear",
      workspace_org_id: "should-never-appear",
      invited_by_user_id: "should-never-appear",
      isOwner: true,
      ownerRoleUuid: "6a615714-4eb7-44f3-993b-f113292f0aa2",
      clerkUserId: "should-never-appear",
    },
  ]);
  const [row] = await listWorkforceMembers();
  assert.deepEqual(Object.keys(row).sort(), ["email", "role", "status", "userId"]);
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
  assert.deepEqual(result, { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "target@example.com", role: "ADMIN", status: "ACTIVE" });
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
function r2cWire({ currentRole = "MANAGER", lockedRole = currentRole, status = "ACTIVE", newRole = "EMPLOYEE" } = {}) {
  r2cAdvisory = { rows: [{ staffMemberId: "sm-1", currentRoleName: currentRole, status, email: "t@example.com" }] };
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
  assert.deepEqual(result, { userId: R2C_TARGET_UUID, email: "t@example.com", role: "EMPLOYEE", status: "ACTIVE" });
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

test("R2C-23. source invariants: previousRole from the LOCKED row, no email authorization, no Axis A/B, exactly 3 runtime exports", () => {
  const src = readFileSync(fileURLToPath(new URL("./workforce.ts", import.meta.url)), "utf8");
  const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l)).join("\n");
  assert.ok(!imports.includes("@/lib/dev-role"), "no legacy AppRole gate import");
  assert.ok(!imports.includes("@/lib/actions/users"), "no Axis A user-action import");
  assert.ok(!imports.includes("requireAdminRole"), "no requireAdminRole import (docstring mentions of its absence are fine)");
  assert.ok(!/\bmemberships\b/.test(imports) && !/\bauditDb\b/.test(imports), "no Axis A memberships / Axis B auditDb import");
  assert.ok(src.includes("previousRole: lockedRole.name"), "audit previousRole must be sourced from the FOR UPDATE-locked row");
  assert.ok(!/previousRole:\s*member\.currentRoleName/.test(src), "audit previousRole must NOT be the advisory value");
  const runtimeExports = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(runtimeExports, ["addWorkforceMember", "changeWorkforceMemberRole", "listWorkforceMembers"]);
});
