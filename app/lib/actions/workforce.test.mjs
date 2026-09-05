// lib/actions/workforce.test.mjs — pure unit tests for the PUBLIC
// listWorkforceMembers() boundary only. lib/actions/workforce.ts exports
// exactly one runtime-capable symbol (listWorkforceMembers) by design (see
// RBAC-RUNTIME-R2A-API-SURFACE-HARDENING-1) — there is no internal
// core/query seam left to import, on purpose. Every test below drives the
// module entirely through its real imports, mocked at the module boundary:
//
//   @/lib/rbac/require-staff-member — mocked as a whole (a black box; its
//     own internals are already exhaustively covered by R1's own 24-test
//     suite, lib/rbac/require-staff-member.test.mjs — re-proving them here
//     would be redundant, not more rigorous) so these tests isolate
//     workforce.ts's OWN logic: workspace resolution, query shape, and
//     response mapping.
//   @/lib/notifications — mocked so the workspace-resolution-failure path
//     is exercisable without a real DB.
//   @/db — mocked with a minimal chainable fake (select/from/innerJoin/
//     where/orderBy) whose final `.orderBy()` call resolves/rejects
//     according to mutable outer state, so the query-shape/DB-failure
//     paths are exercisable without a real DB.
//
// The REAL query's OWNER-exclusion predicate, the REAL requireStaffMember
// authorization pipeline (OWNER/ADMIN allow, MANAGER/EMPLOYEE/no-membership
// deny), and the REAL deterministic ORDER BY are — correctly — NOT provable
// by mocks of this depth; those are proven for real against a disposable
// Postgres by the companion lib/actions/workforce.integration.test.mjs.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

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

let dbRowsOrError = { rows: [] };
const fakeDbChain = {
  select: () => fakeDbChain,
  from: () => fakeDbChain,
  innerJoin: () => fakeDbChain,
  where: () => fakeDbChain,
  orderBy: () => ("error" in dbRowsOrError ? Promise.reject(dbRowsOrError.error) : Promise.resolve(dbRowsOrError.rows)),
};
mock.module("@/db", { namedExports: { db: fakeDbChain } });

const { listWorkforceMembers } = await import("./workforce.ts");

function withRows(rows) {
  dbRowsOrError = { rows };
}
function withDbError(error) {
  dbRowsOrError = { error };
}

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

// -------------------- 13-16: no sensitive-field leakage --------------------
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

// ------------------------ 17-18: no caller-supplied workspace ------------------------
test("17-18. listWorkforceMembers accepts zero arguments — no parameter through which a workspace or identity could be supplied", () => {
  assert.equal(listWorkforceMembers.length, 0);
});

// ---------------------------- 19: DB failure --------------------------------
test("19. a DB query failure propagates (rejects) — never resolves to an empty list", async () => {
  withDbError(new Error("db unreachable"));
  try {
    await assert.rejects(() => listWorkforceMembers(), /db unreachable/);
  } finally {
    withRows([]);
  }
});

// ------------------------ 20: workspace resolver failure --------------------
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
