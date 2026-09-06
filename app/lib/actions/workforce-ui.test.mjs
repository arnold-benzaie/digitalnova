// lib/actions/workforce-ui.test.mjs — pure unit tests for the OWNER-UI-4A
// UI glue: listAssignableWorkforceUsers() (eligible-user discovery) and
// addWorkforceMemberFromForm() (FormData -> R2B addWorkforceMember() with
// stable typed error codes).
//
// Every dependency is mocked at the module boundary — same technique as
// lib/actions/workforce.test.mjs:
//   @/lib/rbac/require-staff-member — asserts the exact permission and can deny.
//   @/lib/actions/workforce         — addWorkforceMember() is a spy; its
//                                     resolve/throw behaviour is configurable
//                                     so every R2B domain error is exercised.
//   @/lib/notifications             — getInternalOrganizationId() (server-side
//                                     workspace resolution; the no-workspace
//                                     path).
//   @/db                            — a chain fake for the anti-join query;
//                                     its single .where() proves there is no
//                                     second (users.status) filter.
//   next/cache                      — revalidatePath() spy.
//   next/navigation                 — unstable_rethrow() (rethrows NEXT_REDIRECT).
//
// The REAL anti-join semantics (OWNER / ADMIN / MANAGER / EMPLOYEE excluded,
// fresh user included) are proven against a disposable Postgres by the
// companion lib/actions/workforce-ui.integration.test.mjs.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce-ui.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VALID_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INTERNAL_ORG_ID = "e35cbc31-9604-4324-adc6-f6f5c1ffc248";

let permissionAllow = true;
let permissionCalls = [];
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (!permissionAllow) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "ADMIN";
    },
  },
});

let addCalls = [];
/** @type {(userId: string, role: string) => Promise<unknown>} */
let addBehavior = async (userId, role) => ({ userId, email: "target@example.com", role, status: "ACTIVE" });

// PHASE RBAC-RUNTIME-R2D-B — the three R2D-A lifecycle functions as
// configurable spies. Each records { fn, args, userId }; lifecycleBehavior
// controls resolve/throw so every mapped + propagated error is exercised.
let lifecycleCalls = [];
/** @type {(fn: string, userId: string) => Promise<unknown>} */
let lifecycleBehavior = async (fn, userId) => ({ userId, email: "target@example.com", role: "MANAGER", status: "SUSPENDED" });
mock.module("@/lib/actions/workforce", {
  namedExports: {
    addWorkforceMember: async (...received) => {
      addCalls.push({ args: received, userId: received[0], role: received[1] });
      return addBehavior(received[0], received[1]);
    },
    suspendWorkforceMember: async (...received) => {
      lifecycleCalls.push({ fn: "suspend", args: received, userId: received[0] });
      return lifecycleBehavior("suspend", received[0]);
    },
    reactivateWorkforceMember: async (...received) => {
      lifecycleCalls.push({ fn: "reactivate", args: received, userId: received[0] });
      return lifecycleBehavior("reactivate", received[0]);
    },
    offboardWorkforceMember: async (...received) => {
      lifecycleCalls.push({ fn: "offboard", args: received, userId: received[0] });
      return lifecycleBehavior("offboard", received[0]);
    },
  },
});

let internalOrgId = INTERNAL_ORG_ID;
mock.module("@/lib/notifications", {
  namedExports: { getInternalOrganizationId: async () => internalOrgId },
});

let assignableRows = [];
let assignableQueryError = null;
let whereCallCount = 0;
const fakeDb = {
  select: () => ({
    from: () => ({
      leftJoin: () => ({
        where: () => {
          whereCallCount += 1;
          return {
            orderBy: () => ({
              limit: (n) =>
                assignableQueryError ? Promise.reject(assignableQueryError) : Promise.resolve(assignableRows.slice(0, n)),
            }),
          };
        },
      }),
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

let revalidateCalls = [];
mock.module("next/cache", { namedExports: { revalidatePath: (p) => revalidateCalls.push(p) } });

mock.module("next/navigation", {
  namedExports: {
    unstable_rethrow: (err) => {
      if (err && typeof err === "object" && typeof err.digest === "string" && err.digest.startsWith("NEXT_REDIRECT")) {
        throw err;
      }
    },
  },
});

const {
  listAssignableWorkforceUsers,
  addWorkforceMemberFromForm,
  suspendWorkforceMemberAction,
  reactivateWorkforceMemberAction,
  offboardWorkforceMemberAction,
} = await import("./workforce-ui.ts");

function reset() {
  permissionAllow = true;
  permissionCalls = [];
  addCalls = [];
  addBehavior = async (userId, role) => ({ userId, email: "target@example.com", role, status: "ACTIVE" });
  lifecycleCalls = [];
  lifecycleBehavior = async (fn, userId) => ({ userId, email: "target@example.com", role: "MANAGER", status: "SUSPENDED" });
  internalOrgId = INTERNAL_ORG_ID;
  assignableRows = [];
  assignableQueryError = null;
  whereCallCount = 0;
  revalidateCalls = [];
}

function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, v);
  return fd;
}

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, email: `u${String(i).padStart(3, "0")}@example.com` }));
}

// ------------------------- listAssignableWorkforceUsers -------------------------

test("4A-L1. requireStaffMember('WORKFORCE_MANAGE') is the first operation — a denial rejects, no rows read", async () => {
  reset();
  permissionAllow = false;
  await assert.rejects(() => listAssignableWorkforceUsers(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"]);
});

test("4A-L2. takes zero arguments — no workspace/identity can be supplied", () => {
  assert.equal(listAssignableWorkforceUsers.length, 0);
});

test("4A-L3. no internal workspace resolvable -> throws, never an empty list", async () => {
  reset();
  internalOrgId = null;
  await assert.rejects(() => listAssignableWorkforceUsers(), /internal workspace is not configured/);
});

test("4A-L4. returns { id, email } only", async () => {
  reset();
  assignableRows = [{ id: "u1", email: "a@example.com" }];
  const result = await listAssignableWorkforceUsers();
  assert.deepEqual(result.users, [{ id: "u1", email: "a@example.com" }]);
  assert.deepEqual(Object.keys(result.users[0]).sort(), ["email", "id"]);
});

test("4A-L5. hasMore is false at exactly the 50-row cap", async () => {
  reset();
  assignableRows = rows(50);
  const result = await listAssignableWorkforceUsers();
  assert.equal(result.users.length, 50);
  assert.equal(result.hasMore, false);
});

test("4A-L6. hasMore is true when a 51st row exists, and only 50 are returned", async () => {
  reset();
  assignableRows = rows(51);
  const result = await listAssignableWorkforceUsers();
  assert.equal(result.users.length, 50);
  assert.equal(result.hasMore, true);
});

test("4A-L7. exactly one WHERE clause — no second users.status eligibility filter", async () => {
  reset();
  assignableRows = rows(3);
  await listAssignableWorkforceUsers();
  assert.equal(whereCallCount, 1, "the query must apply a single anti-join predicate, not an added status filter");
});

test("4A-L8. a DB query failure propagates (rejects), never resolves to an empty list", async () => {
  reset();
  assignableQueryError = new Error("db unreachable");
  await assert.rejects(() => listAssignableWorkforceUsers(), /db unreachable/);
});

// ------------------------- addWorkforceMemberFromForm -------------------------

test("4A-M1. accepts exactly one runtime parameter (FormData) — no workspace/actor/role args", () => {
  assert.equal(addWorkforceMemberFromForm.length, 1);
});

test("4A-M2. requireStaffMember('WORKFORCE_MANAGE') runs first — a denial rejects before parsing/mutation", async () => {
  reset();
  permissionAllow = false;
  await assert.rejects(() => addWorkforceMemberFromForm(form({ userId: "garbage", role: "OWNER" })), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"]);
  assert.deepEqual(addCalls, []);
  assert.deepEqual(revalidateCalls, []);
});

test("4A-M3. valid FormData calls addWorkforceMember(userId, role) exactly once, then revalidates, then returns undefined", async () => {
  reset();
  const result = await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "MANAGER" }));
  assert.equal(result, undefined);
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].userId, VALID_UUID);
  assert.equal(addCalls[0].role, "MANAGER");
  assert.equal(addCalls[0].args.length, 2, "R2B is called with exactly (userId, role) — no third workspace argument");
  assert.deepEqual(revalidateCalls, ["/admin/workforce"]);
});

test("4A-M4. every allowlisted role (ADMIN/MANAGER/EMPLOYEE) reaches R2B unchanged", async () => {
  for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
    reset();
    const result = await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role }));
    assert.equal(result, undefined);
    assert.equal(addCalls[0].role, role);
  }
});

test("4A-M5. role 'OWNER' -> INVALID_ROLE before R2B, nothing written, nothing revalidated", async () => {
  reset();
  const result = await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "OWNER" }));
  assert.deepEqual(result, { error: "INVALID_ROLE" });
  assert.deepEqual(addCalls, []);
  assert.deepEqual(revalidateCalls, []);
});

test("4A-M6. unknown / empty / missing role -> INVALID_ROLE, no R2B call", async () => {
  for (const role of ["SUPERADMIN", "admin", "", undefined]) {
    reset();
    const result = await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role }));
    assert.deepEqual(result, { error: "INVALID_ROLE" });
    assert.deepEqual(addCalls, []);
  }
});

test("4A-M7. malformed / email-shaped / missing userId -> INVALID_USER, no R2B call", async () => {
  for (const userId of ["not-a-uuid", "person@example.com", "'; DROP TABLE staff_members; --", "", undefined]) {
    reset();
    const result = await addWorkforceMemberFromForm(form({ userId, role: "ADMIN" }));
    assert.deepEqual(result, { error: "INVALID_USER" });
    assert.deepEqual(addCalls, []);
  }
});

test("4A-M8. R2B duplicate domain error -> DUPLICATE, no revalidate", async () => {
  reset();
  addBehavior = async () => {
    throw new Error("target is already a workforce member of this workspace");
  };
  const result = await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" }));
  assert.deepEqual(result, { error: "DUPLICATE" });
  assert.deepEqual(revalidateCalls, []);
});

test("4A-M9. R2B 'target user not found' -> INVALID_USER", async () => {
  reset();
  addBehavior = async () => {
    throw new Error("target user not found");
  };
  assert.deepEqual(await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" })), { error: "INVALID_USER" });
});

test("4A-M10. R2B 'target user id must be a valid UUID' -> INVALID_USER", async () => {
  reset();
  addBehavior = async () => {
    throw new Error("target user id must be a valid UUID");
  };
  assert.deepEqual(await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" })), { error: "INVALID_USER" });
});

test("4A-M11. R2B 'workforce role must be one of' -> INVALID_ROLE", async () => {
  reset();
  addBehavior = async () => {
    throw new Error("workforce role must be one of: ADMIN, MANAGER, EMPLOYEE");
  };
  assert.deepEqual(await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" })), { error: "INVALID_ROLE" });
});

test("4A-M12. a NEXT_REDIRECT thrown from inside R2B propagates — never mapped to a business code", async () => {
  reset();
  addBehavior = async () => {
    const err = new Error("NEXT_REDIRECT");
    err.digest = "NEXT_REDIRECT;replace;/admin;307;";
    throw err;
  };
  await assert.rejects(() => addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" })), /NEXT_REDIRECT/);
  assert.deepEqual(revalidateCalls, []);
});

test("4A-M13. 'internal workspace is not configured' propagates (error boundary), not a friendly code", async () => {
  reset();
  addBehavior = async () => {
    throw new Error("internal workspace is not configured");
  };
  await assert.rejects(() => addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" })), /internal workspace is not configured/);
});

test("4A-M14. 'staff role not seeded: ADMIN' propagates", async () => {
  reset();
  addBehavior = async () => {
    throw new Error("staff role not seeded: ADMIN");
  };
  await assert.rejects(() => addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" })), /staff role not seeded/);
});

test("4A-M15. an arbitrary DB/connectivity error propagates (fails closed), never a false success", async () => {
  reset();
  addBehavior = async () => {
    throw new Error("connection terminated unexpectedly");
  };
  await assert.rejects(() => addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "ADMIN" })), /connection terminated unexpectedly/);
  assert.deepEqual(revalidateCalls, []);
});

test("4A-M16. revalidatePath('/admin/workforce') is called ONLY on success", async () => {
  reset();
  await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "EMPLOYEE" }));
  assert.deepEqual(revalidateCalls, ["/admin/workforce"]);

  reset();
  addBehavior = async () => {
    throw new Error("target is already a workforce member of this workspace");
  };
  await addWorkforceMemberFromForm(form({ userId: VALID_UUID, role: "EMPLOYEE" }));
  assert.deepEqual(revalidateCalls, [], "no revalidate on a mapped error");
});

test("4A-M17. imports only Axis-C + identity-discovery modules — no @/lib/audit, no legacy AppRole gate, no Axis B", () => {
  const src = readFileSync(fileURLToPath(new URL("./workforce-ui.ts", import.meta.url)), "utf8");
  const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l));
  for (const needle of ["@/lib/audit", "@/lib/dev-role", "@/lib/actions/users", "auditDb", "memberships"]) {
    assert.ok(!imports.some((l) => l.includes(needle)), `workforce-ui.ts must not import ${needle}`);
  }
  const schemaImport = imports.find((l) => l.includes("@/db/schema")) ?? "";
  assert.match(schemaImport, /\{\s*staffMembers,\s*users\s*\}/, "the @/db/schema import must be limited to { staffMembers, users }");
});

// ==================== PHASE RBAC-RUNTIME-R2D-B ====================
// suspend / reactivate / offboard wrappers over the authoritative R2D-A
// backend. Each: WORKFORCE_MANAGE first, UUID guard, exactly one R2D-A
// call with one arg, 8 mapped domain codes, infra/redirect propagation,
// revalidate on success only. The Add Member tests above are untouched.

const R2DB_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const R2DB_WRAPPERS = [
  { name: "suspend", action: () => suspendWorkforceMemberAction, fn: "suspend" },
  { name: "reactivate", action: () => reactivateWorkforceMemberAction, fn: "reactivate" },
  { name: "offboard", action: () => offboardWorkforceMemberAction, fn: "offboard" },
];

const R2DB_ERROR_MAP = [
  ["target user id must be a valid UUID", "INVALID_TARGET"],
  ["workforce members cannot change their own lifecycle status", "SELF_LIFECYCLE_NOT_ALLOWED"],
  ["workforce member not found", "MEMBER_NOT_FOUND"],
  ["target is the workspace owner and cannot be modified here", "OWNER_PROTECTED"],
  ["an administrator's lifecycle requires owner privileges", "ADMIN_TIER_PROTECTED"],
  ["workforce member already has this status", "STATUS_UNCHANGED"],
  ["this lifecycle transition is not allowed", "INVALID_STATUS_TRANSITION"],
  ["workforce member state changed, please retry", "MEMBER_STATE_CHANGED"],
];

test("R2DB-W1. each lifecycle wrapper takes exactly one runtime parameter", () => {
  assert.equal(suspendWorkforceMemberAction.length, 1);
  assert.equal(reactivateWorkforceMemberAction.length, 1);
  assert.equal(offboardWorkforceMemberAction.length, 1);
});

test("R2DB-W2. requireStaffMember('WORKFORCE_MANAGE') is first — a denial rejects before any R2D-A call or revalidate", async () => {
  for (const { action } of R2DB_WRAPPERS) {
    reset();
    permissionAllow = false;
    await assert.rejects(() => action()(R2DB_UUID), /NEXT_REDIRECT/);
    assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"]);
    assert.deepEqual(lifecycleCalls, []);
    assert.deepEqual(revalidateCalls, []);
  }
});

test("R2DB-W3. malformed / empty / SQL-ish / email-shaped targetUserId -> INVALID_TARGET, no R2D-A call, no revalidate", async () => {
  for (const { action } of R2DB_WRAPPERS) {
    for (const bad of ["not-a-uuid", "", "'; DROP TABLE staff_members; --", "person@example.com", undefined]) {
      reset();
      const result = await action()(bad);
      assert.deepEqual(result, { error: "INVALID_TARGET" });
      assert.deepEqual(lifecycleCalls, []);
      assert.deepEqual(revalidateCalls, []);
    }
  }
});

test("R2DB-W4. suspend wrapper calls ONLY suspendWorkforceMember(id) once, then revalidates /admin/workforce, returns undefined", async () => {
  reset();
  const result = await suspendWorkforceMemberAction(R2DB_UUID);
  assert.equal(result, undefined);
  assert.equal(lifecycleCalls.length, 1);
  assert.equal(lifecycleCalls[0].fn, "suspend");
  assert.equal(lifecycleCalls[0].userId, R2DB_UUID);
  assert.equal(lifecycleCalls[0].args.length, 1, "R2D-A is called with exactly (targetUserId) — no second arg");
  assert.deepEqual(revalidateCalls, ["/admin/workforce"]);
});

test("R2DB-W5. reactivate wrapper calls ONLY reactivateWorkforceMember(id) once, then revalidates, returns undefined", async () => {
  reset();
  const result = await reactivateWorkforceMemberAction(R2DB_UUID);
  assert.equal(result, undefined);
  assert.equal(lifecycleCalls.length, 1);
  assert.equal(lifecycleCalls[0].fn, "reactivate");
  assert.equal(lifecycleCalls[0].args.length, 1);
  assert.deepEqual(revalidateCalls, ["/admin/workforce"]);
});

test("R2DB-W6. offboard wrapper calls ONLY offboardWorkforceMember(id) once, then revalidates, returns undefined", async () => {
  reset();
  const result = await offboardWorkforceMemberAction(R2DB_UUID);
  assert.equal(result, undefined);
  assert.equal(lifecycleCalls.length, 1);
  assert.equal(lifecycleCalls[0].fn, "offboard");
  assert.equal(lifecycleCalls[0].args.length, 1);
  assert.deepEqual(revalidateCalls, ["/admin/workforce"]);
});

test("R2DB-W7. every R2D-A domain message maps to its stable code, for every wrapper, with NO revalidate", async () => {
  for (const { action } of R2DB_WRAPPERS) {
    for (const [message, code] of R2DB_ERROR_MAP) {
      reset();
      lifecycleBehavior = async () => {
        throw new Error(message);
      };
      const result = await action()(R2DB_UUID);
      assert.deepEqual(result, { error: code }, `"${message}" must map to ${code}`);
      assert.deepEqual(revalidateCalls, [], "a mapped error must not revalidate");
    }
  }
});

test("R2DB-W8. infra/config errors propagate untouched (route error boundary), never a code, never a revalidate", async () => {
  for (const message of ["internal workspace is not configured", "staff role not seeded", "connection terminated unexpectedly"]) {
    reset();
    lifecycleBehavior = async () => {
      throw new Error(message);
    };
    await assert.rejects(() => suspendWorkforceMemberAction(R2DB_UUID), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(revalidateCalls, []);
  }
});

test("R2DB-W9. a NEXT_REDIRECT thrown from inside R2D-A propagates — never mapped, never revalidated", async () => {
  reset();
  lifecycleBehavior = async () => {
    const err = new Error("NEXT_REDIRECT");
    err.digest = "NEXT_REDIRECT;replace;/admin;307;";
    throw err;
  };
  await assert.rejects(() => offboardWorkforceMemberAction(R2DB_UUID), /NEXT_REDIRECT/);
  assert.deepEqual(revalidateCalls, []);
});

test("R2DB-W10. source invariants: no Axis A/B imports; the @/lib/actions/workforce import carries the three R2D-A fns; no wrapper takes workspace/org/actor/status/intent", () => {
  const src = readFileSync(fileURLToPath(new URL("./workforce-ui.ts", import.meta.url)), "utf8");
  const importLines = src.split("\n").filter((l) => /^\s*import\s/.test(l));
  for (const needle of ["@/lib/audit", "@/lib/dev-role", "@/lib/actions/users", "auditDb", "memberships"]) {
    assert.ok(!importLines.some((l) => l.includes(needle)), `workforce-ui.ts must not import ${needle}`);
  }
  const workforceImport = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*"@\/lib\/actions\/workforce"/);
  assert.ok(workforceImport, "workforce-ui.ts must import from @/lib/actions/workforce");
  for (const fn of ["addWorkforceMember", "suspendWorkforceMember", "reactivateWorkforceMember", "offboardWorkforceMember"]) {
    assert.ok(workforceImport[1].includes(fn), `the @/lib/actions/workforce import must include ${fn}`);
  }
  const wrapperSig = /export async function (?:suspend|reactivate|offboard)WorkforceMemberAction\(([^)]*)\)/g;
  let m;
  let matched = 0;
  while ((m = wrapperSig.exec(src))) {
    matched += 1;
    assert.match(m[1].trim(), /^targetUserId: string$/, "each wrapper signature is exactly (targetUserId: string)");
  }
  assert.equal(matched, 3, "all three lifecycle wrappers found");
  assert.ok(
    !/WorkforceMemberAction\([^)]*\b(workspace|organization|organizationId|actor|actorUserId|expectedStatus|intent)\b/.test(src),
    "no wrapper takes a workspace/org/actor/status/intent argument",
  );
});
