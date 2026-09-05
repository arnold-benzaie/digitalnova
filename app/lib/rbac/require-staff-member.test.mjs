// requireStaffMember() / evaluateStaffPermission() tests — run with:
//   npx tsx --test --experimental-test-module-mocks lib/rbac/require-staff-member.test.mjs
//
// Same style as lib/dev-role.test.mjs: node:test + mock.module for every
// module the file under test imports that would otherwise touch a live
// DB/Next.js server-only boundary, all set up BEFORE the single dynamic
// import below (mock.module intercepts module resolution, so it must run
// before anything requires the real module). next/navigation's redirect()
// is left un-mocked — it always throws a NEXT_REDIRECT control-flow error
// by design, so it's asserted on via its digest instead of stubbed out,
// exactly like lib/dev-role.test.mjs. The bulk of the ALLOW/DENY
// permission matrix is exercised directly against evaluateStaffPermission()
// with a plain fake injected lookup — no Drizzle query-builder mocking
// needed, since that function accepts a single async lookup function
// rather than a raw db chain.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { redirect } from "next/navigation";
import { hasPermission } from "./permissions.ts";

const INTERNAL_ORG_ID = "e35cbc31-9604-4324-adc6-f6f5c1ffc248";
const USER_ID = "32371e8f-fc5e-4add-a7e4-9d4baf84252e";

// require-staff-member.ts imports @/db at module scope for its DEFAULT
// lookup (never exercised by the evaluateStaffPermission()/requireStaffMember()
// tests below, which all inject lookupMembership/getInternalOrgId directly),
// but @/db's real module throws synchronously at import time when
// DATABASE_URL isn't set. It also imports @/lib/session, whose real
// implementation transitively pulls in a `server-only`-guarded module that
// throws outside an actual Next.js server render. Both are mocked to
// harmless stand-ins so this suite needs neither a live Postgres
// connection nor a Next.js runtime — exactly the reason lib/dev-role.test.mjs
// mocks @/lib/session the same way before importing lib/dev-role.ts.
//
// isCurrentUserOwner() (PHASE OWNER-UI-1 / SECURITY-CLEANUP-1) takes no
// argument at all — unlike evaluateStaffPermission(), it cannot be given
// an injected lookupMembership/getInternalOrgId, so its own tests (below)
// exercise the REAL defaultLookupStaffMembership() against this fake
// `db`, which only needs to support that one query shape
// (select({roleName,status}).from(staffMembers).innerJoin(staffRoles,...)
// .where(...).limit(1)) — a flat chain is enough since no other query
// shape in this file reaches @/db through the zero-argument wrapper.
let membershipRowOrError = { row: undefined };
const fakeMembershipDb = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: () => {
            if ("error" in membershipRowOrError) return Promise.reject(membershipRowOrError.error);
            return Promise.resolve(membershipRowOrError.row ? [membershipRowOrError.row] : []);
          },
        }),
      }),
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeMembershipDb } });

/** @type {{ kind: "unauthenticated" } | { kind: "session"; userId: string }} */
let sessionMockState = { kind: "session", userId: USER_ID };
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (sessionMockState.kind === "unauthenticated") {
        redirect("/sign-in");
      }
      return { userId: sessionMockState.userId };
    },
  },
});

/** @type {() => Promise<string | null>} */
let internalOrgIdMock = async () => INTERNAL_ORG_ID;
mock.module("@/lib/notifications", {
  namedExports: {
    getInternalOrganizationId: async () => internalOrgIdMock(),
  },
});

const { evaluateStaffPermission, requireStaffMember, isCurrentUserOwner, canCurrentUserManageWorkforce } = await import("./require-staff-member.ts");

function fixedInternalOrg(id = INTERNAL_ORG_ID) {
  return async () => id;
}
function noInternalOrg() {
  return async () => null;
}
function membershipOf(roleName, status = "ACTIVE") {
  return async () => ({ roleName, status });
}
function noMembership() {
  return async () => undefined;
}
function throwingLookup(err = new Error("db unreachable")) {
  return async () => {
    throw err;
  };
}

// ---- isCurrentUserOwner()-only fixtures: it has no injectable params, so
// its real defaultLookupStaffMembership() must hit the fake `db` above
// instead. `internalOrgIdMock` (already set up for @/lib/notifications)
// covers the workspace-resolution half of the same real call chain. ----
function withMembershipRow(roleName, status = "ACTIVE") {
  membershipRowOrError = { row: { roleName, status } };
}
function withNoMembershipRow() {
  membershipRowOrError = { row: undefined };
}
function withMembershipLookupError(err = new Error("db unreachable")) {
  membershipRowOrError = { error: err };
}

async function evaluate(roleName, permission, { status = "ACTIVE", getInternalOrgId = fixedInternalOrg(), lookupMembership } = {}) {
  return evaluateStaffPermission({
    userId: USER_ID,
    permission,
    getInternalOrgId,
    lookupMembership: lookupMembership ?? membershipOf(roleName, status),
  });
}

// ------------------------- 1-12: permission matrix -------------------------
test("1. OWNER + WORKFORCE_MANAGE -> ALLOW", async () => {
  const r = await evaluate("OWNER", "WORKFORCE_MANAGE");
  assert.deepEqual(r, { ok: true, role: "OWNER" });
});

test("2. OWNER + OWNER_MANAGE -> ALLOW", async () => {
  const r = await evaluate("OWNER", "OWNER_MANAGE");
  assert.deepEqual(r, { ok: true, role: "OWNER" });
});

test("3. ADMIN + WORKFORCE_MANAGE -> ALLOW", async () => {
  const r = await evaluate("ADMIN", "WORKFORCE_MANAGE");
  assert.deepEqual(r, { ok: true, role: "ADMIN" });
});

test("4. ADMIN + OWNER_MANAGE -> DENY", async () => {
  const r = await evaluate("ADMIN", "OWNER_MANAGE");
  assert.deepEqual(r, { ok: false, reason: "permission-denied" });
});

test("5. MANAGER + WORKFORCE_MANAGE -> DENY", async () => {
  assert.deepEqual(await evaluate("MANAGER", "WORKFORCE_MANAGE"), { ok: false, reason: "permission-denied" });
});
test("6. MANAGER + SYSTEM_ADMIN -> DENY", async () => {
  assert.deepEqual(await evaluate("MANAGER", "SYSTEM_ADMIN"), { ok: false, reason: "permission-denied" });
});
test("7. MANAGER + BILLING_MANAGE -> DENY", async () => {
  assert.deepEqual(await evaluate("MANAGER", "BILLING_MANAGE"), { ok: false, reason: "permission-denied" });
});
test("8. MANAGER + OWNER_MANAGE -> DENY", async () => {
  assert.deepEqual(await evaluate("MANAGER", "OWNER_MANAGE"), { ok: false, reason: "permission-denied" });
});

test("9. EMPLOYEE + WORKFORCE_MANAGE -> DENY", async () => {
  assert.deepEqual(await evaluate("EMPLOYEE", "WORKFORCE_MANAGE"), { ok: false, reason: "permission-denied" });
});
test("10. EMPLOYEE + SYSTEM_ADMIN -> DENY", async () => {
  assert.deepEqual(await evaluate("EMPLOYEE", "SYSTEM_ADMIN"), { ok: false, reason: "permission-denied" });
});
test("11. EMPLOYEE + BILLING_MANAGE -> DENY", async () => {
  assert.deepEqual(await evaluate("EMPLOYEE", "BILLING_MANAGE"), { ok: false, reason: "permission-denied" });
});
test("12. EMPLOYEE + OWNER_MANAGE -> DENY", async () => {
  assert.deepEqual(await evaluate("EMPLOYEE", "OWNER_MANAGE"), { ok: false, reason: "permission-denied" });
});

// ------------------------- 13-15: fail-closed edges -------------------------
test("13. no staff_members row -> DENY", async () => {
  const r = await evaluateStaffPermission({
    userId: USER_ID,
    permission: "WORKFORCE_MANAGE",
    getInternalOrgId: fixedInternalOrg(),
    lookupMembership: noMembership(),
  });
  assert.deepEqual(r, { ok: false, reason: "no-membership" });
});

test("14. inactive (SUSPENDED) staff_members row -> DENY", async () => {
  const r = await evaluate("ADMIN", "WORKFORCE_MANAGE", { status: "SUSPENDED" });
  assert.deepEqual(r, { ok: false, reason: "inactive-membership" });
});

test("14b. inactive (OFFBOARDING) staff_members row -> DENY", async () => {
  const r = await evaluate("OWNER", "WORKFORCE_MANAGE", { status: "OFFBOARDING" });
  assert.deepEqual(r, { ok: false, reason: "inactive-membership" });
});

test("15. unknown/unrecognized stored role -> DENY", async () => {
  const r = await evaluate("SOMETHING_ELSE_NOT_A_REAL_ROLE", "WORKFORCE_MANAGE");
  assert.deepEqual(r, { ok: false, reason: "permission-denied" });
});

test("no internal workspace resolvable -> DENY (fails closed, never throws past this)", async () => {
  const r = await evaluateStaffPermission({
    userId: USER_ID,
    permission: "WORKFORCE_MANAGE",
    getInternalOrgId: noInternalOrg(),
    lookupMembership: membershipOf("OWNER"),
  });
  assert.deepEqual(r, { ok: false, reason: "no-internal-workspace" });
});

// ---------------------------- 17: DB failure ----------------------------
test("17. membership lookup failure propagates (rejects) — never resolves to ALLOW", async () => {
  await assert.rejects(
    () =>
      evaluateStaffPermission({
        userId: USER_ID,
        permission: "WORKFORCE_MANAGE",
        getInternalOrgId: fixedInternalOrg(),
        lookupMembership: throwingLookup(),
      }),
    /db unreachable/,
  );
});

test("17b. internal-workspace lookup failure propagates (rejects) — never resolves to ALLOW", async () => {
  await assert.rejects(
    () =>
      evaluateStaffPermission({
        userId: USER_ID,
        permission: "WORKFORCE_MANAGE",
        getInternalOrgId: async () => {
          throw new Error("org lookup unreachable");
        },
        lookupMembership: membershipOf("OWNER"),
      }),
    /org lookup unreachable/,
  );
});

// -------------------- 19: uses the existing hasPermission() --------------------
test("19. evaluateStaffPermission's ALLOW/DENY exactly tracks the existing hasPermission() for every role x permission it names", async () => {
  const roles = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"];
  const perms = ["OWNER_MANAGE", "SYSTEM_ADMIN", "WORKFORCE_MANAGE", "BILLING_MANAGE", "CRM_READ", "CRM_WRITE"];
  for (const role of roles) {
    for (const perm of perms) {
      const r = await evaluate(role, perm);
      assert.equal(r.ok, hasPermission(role, perm), `role=${role} permission=${perm}`);
    }
  }
});

// -------------------- 20: OWNER needs no second ADMIN row --------------------
test("20. OWNER receives every shared ADMIN permission from its single OWNER row, no second ADMIN membership involved", async () => {
  const adminOnlyPerms = ["SYSTEM_ADMIN", "WORKFORCE_MANAGE", "BILLING_MANAGE", "CRM_READ", "CRM_WRITE", "RADAR_WORK", "RADAR_QUEUE_VIEW", "ANALYTICS_TEAM_VIEW", "GBP_INTEGRATION_MANAGE"];
  // lookupMembership is called with a fixed fake returning exactly ONE row
  // (role: OWNER) regardless of which permission is asked about below —
  // there is no code path here that could consult a second row for ADMIN.
  let lookupCalls = 0;
  const singleOwnerRowOnly = async () => {
    lookupCalls += 1;
    return { roleName: "OWNER", status: "ACTIVE" };
  };
  for (const perm of adminOnlyPerms) {
    const r = await evaluateStaffPermission({
      userId: USER_ID,
      permission: perm,
      getInternalOrgId: fixedInternalOrg(),
      lookupMembership: singleOwnerRowOnly,
    });
    assert.deepEqual(r, { ok: true, role: "OWNER" });
  }
  assert.equal(lookupCalls, adminOnlyPerms.length, "exactly one lookup per check, always the same single OWNER row");
});

// ---------------- requireStaffMember() wrapper: redirect wiring ----------------
// 16, 18: unauthenticated caller denied via the EXISTING session contract;
// the wrapper accepts no userId argument at all (see the sibling
// require-staff-member.permission-type-check.ts for the compile-time proof
// that a second argument is a type error, not merely unused).
test("16. unauthenticated caller: requireStaffMember denies via requireSession()'s own existing redirect, never evaluates a permission", async () => {
  sessionMockState = { kind: "unauthenticated" };
  try {
    await requireStaffMember("WORKFORCE_MANAGE");
    assert.fail("expected a redirect, but requireStaffMember returned normally");
  } catch (err) {
    assert.match(err?.digest ?? "", /^NEXT_REDIRECT/);
    assert.ok(String(err.digest).includes("/sign-in"));
  } finally {
    sessionMockState = { kind: "session", userId: USER_ID };
  }
});

test("requireStaffMember redirects to /admin when the resolved caller has no staff_members membership at all", async () => {
  internalOrgIdMock = async () => null; // evaluateStaffPermission's very first check denies before any staff_members lookup
  try {
    await requireStaffMember("WORKFORCE_MANAGE");
    assert.fail("expected a redirect, but requireStaffMember returned normally");
  } catch (err) {
    assert.match(err?.digest ?? "", /^NEXT_REDIRECT/);
    assert.ok(String(err.digest).includes("/admin"));
  } finally {
    internalOrgIdMock = async () => INTERNAL_ORG_ID;
  }
});

test("requireStaffMember has exactly one parameter (permission) — no way to pass an identity", () => {
  assert.equal(requireStaffMember.length, 1);
});

// ------------------- isCurrentUserOwner(): OWNER-UI-1 visibility signal -------------------
// Non-redirecting — every assertion below checks a plain boolean, never a
// thrown NEXT_REDIRECT, distinguishing it from requireStaffMember() above.
//
// isCurrentUserOwner() takes NO argument (hardened in SECURITY-CLEANUP-1 —
// see the compile-time @ts-expect-error proof in
// require-staff-member.permission-type-check.ts for why that isn't
// re-asserted here via a brittle `.length` check): every call below is
// `isCurrentUserOwner()`, and the scenario is driven entirely by the
// module-level `internalOrgIdMock` (@/lib/notifications) and the fake
// `db` (`withMembershipRow`/`withNoMembershipRow`/`withMembershipLookupError`
// above) that its real, un-overridable defaultLookupStaffMembership()
// actually queries — the OWNER/ADMIN/MANAGER/EMPLOYEE role matrix itself
// is already exhaustively proven against evaluateStaffPermission()
// directly in tests 1-20 above; these tests exist to prove
// isCurrentUserOwner()'s own composition (real session -> real
// evaluateStaffPermission("OWNER_MANAGE") -> ok && role === "OWNER"), not
// to re-litigate that matrix a second time.

test("OWNER-UI-1.1. real OWNER membership -> isOwner = true", async () => {
  withMembershipRow("OWNER");
  const isOwner = await isCurrentUserOwner();
  assert.equal(isOwner, true);
});

test("OWNER-UI-1.2. ADMIN -> isOwner = false", async () => {
  withMembershipRow("ADMIN");
  const isOwner = await isCurrentUserOwner();
  assert.equal(isOwner, false);
});

test("OWNER-UI-1.3. MANAGER -> isOwner = false", async () => {
  withMembershipRow("MANAGER");
  const isOwner = await isCurrentUserOwner();
  assert.equal(isOwner, false);
});

test("OWNER-UI-1.4. EMPLOYEE -> isOwner = false", async () => {
  withMembershipRow("EMPLOYEE");
  const isOwner = await isCurrentUserOwner();
  assert.equal(isOwner, false);
});

test("OWNER-UI-1.5. missing staff_members membership -> isOwner = false, never true", async () => {
  withNoMembershipRow();
  const isOwner = await isCurrentUserOwner();
  assert.equal(isOwner, false);
});

test("OWNER-UI-1.5b. no internal workspace resolvable -> isOwner = false, never true", async () => {
  withMembershipRow("OWNER"); // present but must never be reached — no-workspace denies first
  internalOrgIdMock = async () => null;
  try {
    const isOwner = await isCurrentUserOwner();
    assert.equal(isOwner, false);
  } finally {
    internalOrgIdMock = async () => INTERNAL_ORG_ID;
  }
});

test("OWNER-UI-1.5c. inactive (SUSPENDED) OWNER row -> isOwner = false — an OWNER row alone is not enough, it must also be ACTIVE", async () => {
  withMembershipRow("OWNER", "SUSPENDED");
  const isOwner = await isCurrentUserOwner();
  assert.equal(isOwner, false);
});

test("OWNER-UI-1.6. determination is based on OWNER_MANAGE via the real defaultLookupStaffMembership() — never email — proven by a fake `db` row that carries only roleName/status, no email field at all", async () => {
  membershipRowOrError = { row: { roleName: "OWNER", status: "ACTIVE" } };
  assert.equal("email" in membershipRowOrError.row, false, "the membership row consulted has no email field — the decision cannot be email-based");
  const isOwner = await isCurrentUserOwner();
  assert.equal(isOwner, true);
});

test("OWNER-UI-1.7. a DB/lookup failure propagates (rejects), never silently resolves to false or true", async () => {
  withMembershipLookupError();
  await assert.rejects(() => isCurrentUserOwner(), /db unreachable/);
});

// ------------- canCurrentUserManageWorkforce(): OWNER-UI-3B visibility signal -------------
// Same non-redirecting, zero-argument shape as isCurrentUserOwner(), but
// follows the "WORKFORCE_MANAGE" permission (OWNER + ADMIN today) and
// returns evaluateStaffPermission().ok verbatim — no hardcoded role names.
// Driven by the same module-level `internalOrgIdMock` + fake `db`
// (`withMembershipRow`/`withNoMembershipRow`/`withMembershipLookupError`).
// Never an authorization gate — /admin/workforce keeps its own
// requireStaffMember("WORKFORCE_MANAGE") server guard (OWNER-UI-3A).

test("OWNER-UI-3B.1. OWNER -> canManageWorkforce = true", async () => {
  withMembershipRow("OWNER");
  assert.equal(await canCurrentUserManageWorkforce(), true);
});

test("OWNER-UI-3B.2. ADMIN -> canManageWorkforce = true", async () => {
  withMembershipRow("ADMIN");
  assert.equal(await canCurrentUserManageWorkforce(), true);
});

test("OWNER-UI-3B.3. MANAGER -> canManageWorkforce = false", async () => {
  withMembershipRow("MANAGER");
  assert.equal(await canCurrentUserManageWorkforce(), false);
});

test("OWNER-UI-3B.4. EMPLOYEE -> canManageWorkforce = false", async () => {
  withMembershipRow("EMPLOYEE");
  assert.equal(await canCurrentUserManageWorkforce(), false);
});

test("OWNER-UI-3B.5. missing staff_members membership -> canManageWorkforce = false", async () => {
  withNoMembershipRow();
  assert.equal(await canCurrentUserManageWorkforce(), false);
});

test("OWNER-UI-3B.6. inactive (SUSPENDED) ADMIN row -> canManageWorkforce = false — an ADMIN row alone is not enough, it must also be ACTIVE", async () => {
  withMembershipRow("ADMIN", "SUSPENDED");
  assert.equal(await canCurrentUserManageWorkforce(), false);
});

test("OWNER-UI-3B.7. permission-denied (unknown stored role) -> canManageWorkforce = false", async () => {
  withMembershipRow("SOMETHING_ELSE_NOT_A_REAL_ROLE");
  assert.equal(await canCurrentUserManageWorkforce(), false);
});

test("OWNER-UI-3B.7b. no internal workspace resolvable -> canManageWorkforce = false, never true", async () => {
  withMembershipRow("ADMIN"); // present but must never be reached — no-workspace denies first
  internalOrgIdMock = async () => null;
  try {
    assert.equal(await canCurrentUserManageWorkforce(), false);
  } finally {
    internalOrgIdMock = async () => INTERNAL_ORG_ID;
  }
});

test("OWNER-UI-3B.8. determination is via WORKFORCE_MANAGE against the real defaultLookupStaffMembership() — never email — proven by a fake `db` row carrying only roleName/status, no email field", async () => {
  membershipRowOrError = { row: { roleName: "ADMIN", status: "ACTIVE" } };
  assert.equal("email" in membershipRowOrError.row, false, "the membership row consulted has no email field — the decision cannot be email-based");
  assert.equal(await canCurrentUserManageWorkforce(), true);
});

test("OWNER-UI-3B.9. a DB/lookup failure propagates (rejects), never silently resolves to false or true", async () => {
  withMembershipLookupError();
  await assert.rejects(() => canCurrentUserManageWorkforce(), /db unreachable/);
});

test("OWNER-UI-3B.10. no hardcoded role names — it returns evaluateStaffPermission().ok verbatim, so it would follow a future WORKFORCE_MANAGE policy change automatically (MANAGER row still denied today because the permission catalogue denies it)", async () => {
  // This is the composition guarantee: the signal never re-implements the
  // OWNER/ADMIN allowlist. With a MANAGER row it is false purely because
  // hasPermission("MANAGER","WORKFORCE_MANAGE") is false in the catalogue,
  // not because this function names "MANAGER".
  withMembershipRow("MANAGER");
  assert.equal(await canCurrentUserManageWorkforce(), hasPermission("MANAGER", "WORKFORCE_MANAGE"));
  withMembershipRow("ADMIN");
  assert.equal(await canCurrentUserManageWorkforce(), hasPermission("ADMIN", "WORKFORCE_MANAGE"));
});
