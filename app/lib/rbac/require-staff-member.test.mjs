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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { redirect } from "next/navigation";
import { hasPermission } from "./permissions.ts";

// PERF — ADMIN NAV VISIBILITY CONSOLIDATION structural proof source, same
// pattern lib/actions/radar-ai-quota-governance.test.mjs's own "delegation"
// tests already use in this codebase.
const SOURCE = readFileSync(fileURLToPath(new URL("./require-staff-member.ts", import.meta.url)), "utf8");

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

const {
  evaluateStaffPermission,
  requireStaffMember,
  isCurrentUserOwner,
  canCurrentUserManageWorkforce,
  canCurrentUserManageAiPolicy,
  getRadarCapabilities,
  canCurrentUserWorkRadar,
  evaluateRadarAccess,
  requireRadarAccess,
  isCurrentUserEmployeeTier,
} = await import("./require-staff-member.ts");

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
// covers the workspace-resolution half of the same real call chain. Also
// used by getRadarCapabilities()/canCurrentUserWorkRadar() below — their
// real defaultLookupRadarMembership() selects one extra column
// (radarAccess) from the SAME fake `db` (its mock chain ignores which
// columns are requested), so `radarAccess` defaults to `true` here to
// match staff_members.radar_access's own column DEFAULT and keep every
// pre-existing role-only test (which never mentions radar access)
// correct without changes — WORKFORCE ACCESS CONTROL tests below pass
// `false` explicitly. ----
function withMembershipRow(roleName, status = "ACTIVE", radarAccess = true) {
  membershipRowOrError = { row: { roleName, status, radarAccess } };
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

// WORKFORCE ACCESS CONTROL — RADAR_ACCESS fixtures, same shape as
// membershipOf()/evaluate() above, plus radarAccess.
function radarMembershipOf(roleName, status = "ACTIVE", radarAccess = true) {
  return async () => ({ roleName, status, radarAccess });
}
function noRadarMembership() {
  return async () => undefined;
}
async function evaluateRadar(
  roleName,
  permission,
  { status = "ACTIVE", radarAccess = true, getInternalOrgId = fixedInternalOrg(), lookupMembership } = {},
) {
  return evaluateRadarAccess({
    userId: USER_ID,
    permission,
    getInternalOrgId,
    lookupMembership: lookupMembership ?? radarMembershipOf(roleName, status, radarAccess),
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

// ------------- canCurrentUserManageAiPolicy(): RADAR INTELLIGENCE V2.1 Phase C visibility signal -------------
// Same non-redirecting, zero-argument shape as the signals above, but
// follows the "RADAR_AI_POLICY_MANAGE" permission (OWNER-only today) and
// returns evaluateStaffPermission().ok verbatim — no hardcoded role names.
// Never an authorization gate — /admin/owner/ai-providers keeps its own
// requireStaffMember("RADAR_AI_POLICY_MANAGE") server guard.

test("PHASE-C.1. OWNER -> canManageAiPolicy = true", async () => {
  withMembershipRow("OWNER");
  assert.equal(await canCurrentUserManageAiPolicy(), true);
});

test("PHASE-C.2. ADMIN -> canManageAiPolicy = false (unlike WORKFORCE_MANAGE, this permission is OWNER-exclusive)", async () => {
  withMembershipRow("ADMIN");
  assert.equal(await canCurrentUserManageAiPolicy(), false);
});

test("PHASE-C.3. MANAGER -> canManageAiPolicy = false", async () => {
  withMembershipRow("MANAGER");
  assert.equal(await canCurrentUserManageAiPolicy(), false);
});

test("PHASE-C.4. EMPLOYEE -> canManageAiPolicy = false", async () => {
  withMembershipRow("EMPLOYEE");
  assert.equal(await canCurrentUserManageAiPolicy(), false);
});

test("PHASE-C.5. missing staff_members membership -> canManageAiPolicy = false", async () => {
  withNoMembershipRow();
  assert.equal(await canCurrentUserManageAiPolicy(), false);
});

test("PHASE-C.6. inactive (SUSPENDED) OWNER row -> canManageAiPolicy = false", async () => {
  withMembershipRow("OWNER", "SUSPENDED");
  assert.equal(await canCurrentUserManageAiPolicy(), false);
});

test("PHASE-C.7. no internal workspace resolvable -> canManageAiPolicy = false, never true", async () => {
  withMembershipRow("OWNER");
  internalOrgIdMock = async () => null;
  try {
    assert.equal(await canCurrentUserManageAiPolicy(), false);
  } finally {
    internalOrgIdMock = async () => INTERNAL_ORG_ID;
  }
});

test("PHASE-C.8. determination is via RADAR_AI_POLICY_MANAGE against the real defaultLookupStaffMembership() — never email", async () => {
  membershipRowOrError = { row: { roleName: "OWNER", status: "ACTIVE" } };
  assert.equal("email" in membershipRowOrError.row, false, "the membership row consulted has no email field — the decision cannot be email-based");
  assert.equal(await canCurrentUserManageAiPolicy(), true);
});

test("PHASE-C.9. a DB/lookup failure propagates (rejects), never silently resolves to false or true", async () => {
  withMembershipLookupError();
  await assert.rejects(() => canCurrentUserManageAiPolicy(), /db unreachable/);
});

test("PHASE-C.10. no hardcoded role names — follows the permission catalogue verbatim for every role", async () => {
  for (const role of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"]) {
    withMembershipRow(role);
    assert.equal(await canCurrentUserManageAiPolicy(), hasPermission(role, "RADAR_AI_POLICY_MANAGE"), `${role} mismatch`);
  }
});

// ------------- getRadarCapabilities(): RADAR-CORE-1A/1B capability signal -------------
// Zero-argument, non-redirecting, session-derived. Returns
// { canClaimToSelf, canAssignOthers, canReleaseOwn }. canAssignOthers /
// canReleaseOwn come straight from evaluateStaffPermission().ok for
// RADAR_ASSIGN / RADAR_WORK; canClaimToSelf additionally excludes OWNER
// (the one role that holds RADAR_WORK but is never an eligible assignee
// target — mirrors radar-assignment.ts::isEligibleAssignee). NEVER an auth
// gate: lib/actions/radar-assignment.ts calls requireStaffMember(...) as
// its own first statement. Same fake-db / internalOrgIdMock fixtures as
// the two signals above.

const ALL_CAPS_FALSE = { canClaimToSelf: false, canAssignOthers: false, canReleaseOwn: false };

test("RADAR-CORE-1B.cap-1. getRadarCapabilities() takes zero arguments (reviewed API invariant)", () => {
  assert.equal(getRadarCapabilities.length, 0);
});

test("RADAR-CORE-1B.cap-2. ACTIVE MANAGER -> all three true", async () => {
  withMembershipRow("MANAGER");
  assert.deepEqual(await getRadarCapabilities(), {
    canClaimToSelf: true,
    canAssignOthers: true,
    canReleaseOwn: true,
  });
});

test("RADAR-CORE-1B.cap-3. ACTIVE ADMIN -> all three true", async () => {
  withMembershipRow("ADMIN");
  assert.deepEqual(await getRadarCapabilities(), {
    canClaimToSelf: true,
    canAssignOthers: true,
    canReleaseOwn: true,
  });
});

test("RADAR-CORE-1B.cap-4. ACTIVE OWNER -> canClaimToSelf FALSE, canAssignOthers/canReleaseOwn true (OWNER holds RADAR_WORK but is never an eligible assignee target)", async () => {
  withMembershipRow("OWNER");
  assert.deepEqual(await getRadarCapabilities(), {
    canClaimToSelf: false,
    canAssignOthers: true,
    canReleaseOwn: true,
  });
});

test("RADAR-CORE-1B.cap-5. ACTIVE EMPLOYEE -> canClaimToSelf/canReleaseOwn true, canAssignOthers FALSE", async () => {
  withMembershipRow("EMPLOYEE");
  const caps = await getRadarCapabilities();
  assert.deepEqual(caps, {
    canClaimToSelf: true,
    canAssignOthers: false,
    canReleaseOwn: true,
  });
  // Composition guarantee — mirrors the catalogue verbatim, no local allowlist.
  assert.equal(caps.canReleaseOwn, hasPermission("EMPLOYEE", "RADAR_WORK"));
  assert.equal(caps.canAssignOthers, hasPermission("EMPLOYEE", "RADAR_ASSIGN"));
});

test("RADAR-CORE-1B.cap-6. permission denial (no membership) -> all three false", async () => {
  withNoMembershipRow();
  assert.deepEqual(await getRadarCapabilities(), ALL_CAPS_FALSE);
});

test("RADAR-CORE-1B.cap-7. inactive (SUSPENDED) MANAGER -> all three false — an ACTIVE row is required", async () => {
  withMembershipRow("MANAGER", "SUSPENDED");
  assert.deepEqual(await getRadarCapabilities(), ALL_CAPS_FALSE);
});

test("RADAR-CORE-1B.cap-7b. OFFBOARDING EMPLOYEE -> all three false", async () => {
  withMembershipRow("EMPLOYEE", "OFFBOARDING");
  assert.deepEqual(await getRadarCapabilities(), ALL_CAPS_FALSE);
});

test("RADAR-CORE-1B.cap-7c. SUSPENDED OWNER -> all three false (canClaimToSelf never leaks true for an inactive OWNER)", async () => {
  withMembershipRow("OWNER", "SUSPENDED");
  assert.deepEqual(await getRadarCapabilities(), ALL_CAPS_FALSE);
});

test("RADAR-CORE-1B.cap-8. no internal workspace resolvable -> all three false, never true", async () => {
  withMembershipRow("ADMIN");
  internalOrgIdMock = async () => null;
  try {
    assert.deepEqual(await getRadarCapabilities(), ALL_CAPS_FALSE);
  } finally {
    internalOrgIdMock = async () => INTERNAL_ORG_ID;
  }
});

test("RADAR-CORE-1B.cap-9. a DB/lookup failure propagates (rejects), never silently resolves", async () => {
  withMembershipLookupError();
  await assert.rejects(() => getRadarCapabilities(), /db unreachable/);
});

test("RADAR-CORE-1B.cap-10. identity comes from requireSession() — an unauthenticated session redirects before any capability is computed", async () => {
  sessionMockState = { kind: "unauthenticated" };
  try {
    await assert.rejects(() => getRadarCapabilities(), (e) => typeof e?.digest === "string" && e.digest.startsWith("NEXT_REDIRECT"));
  } finally {
    sessionMockState = { kind: "session", userId: USER_ID };
  }
});

// ------------- WORKFORCE ACCESS CONTROL — evaluateRadarAccess() / requireRadarAccess() -------------
// RADAR_ACCESS: staff_members.radar_access, an individual override
// layered strictly ON TOP of the existing role-derived RADAR_WORK /
// RADAR_QUEUE_VIEW / RADAR_ASSIGN permissions. Effective access requires
// BOTH hasPermission(role, permission) AND radarAccess === true.
// lib/rbac/permissions.ts (PERMISSIONS/ROLE_PERMISSIONS/hasPermission) is
// never touched by any of this — proven by test #19 above continuing to
// pass unmodified, and by the mandated matrix below.

test("RA-1. role authorized (RADAR_WORK) + radar ON -> ALLOW", async () => {
  const result = await evaluateRadar("EMPLOYEE", "RADAR_WORK", { radarAccess: true });
  assert.deepEqual(result, { ok: true, role: "EMPLOYEE" });
});

test("RA-2. role authorized (RADAR_WORK) + radar OFF -> DENY (radar-access-revoked)", async () => {
  const result = await evaluateRadar("EMPLOYEE", "RADAR_WORK", { radarAccess: false });
  assert.deepEqual(result, { ok: false, reason: "radar-access-revoked" });
});

test("RA-3. role NOT authorized (CLIENT-shaped/unknown role never holds RADAR_ASSIGN, e.g. EMPLOYEE) + radar ON -> DENY (permission-denied)", async () => {
  const result = await evaluateRadar("EMPLOYEE", "RADAR_ASSIGN", { radarAccess: true });
  assert.deepEqual(result, { ok: false, reason: "permission-denied" });
});

test("RA-4. role NOT authorized + radar OFF -> DENY (permission-denied, not radar-access-revoked — the role check runs first)", async () => {
  const result = await evaluateRadar("EMPLOYEE", "RADAR_ASSIGN", { radarAccess: false });
  assert.deepEqual(result, { ok: false, reason: "permission-denied" });
});

test("RA-5. no staff_members row at all -> DENY (no-membership)", async () => {
  const result = await evaluateRadarAccess({ userId: USER_ID, permission: "RADAR_WORK", getInternalOrgId: fixedInternalOrg(), lookupMembership: noRadarMembership() });
  assert.deepEqual(result, { ok: false, reason: "no-membership" });
});

test("RA-6. every StaffRole x RADAR permission, radar ON, matches hasPermission() exactly — proves ROLE_PERMISSIONS/hasPermission() are untouched", async () => {
  const roles = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"];
  const radarPerms = ["RADAR_WORK", "RADAR_QUEUE_VIEW", "RADAR_ASSIGN"];
  for (const role of roles) {
    for (const perm of radarPerms) {
      const result = await evaluateRadar(role, perm, { radarAccess: true });
      assert.equal(result.ok, hasPermission(role, perm), `${role} x ${perm} mismatch`);
    }
  }
});

test("RA-7. every StaffRole x RADAR permission, radar OFF -> DENY unconditionally, even for a role the permission would otherwise grant", async () => {
  const roles = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"];
  const radarPerms = ["RADAR_WORK", "RADAR_QUEUE_VIEW", "RADAR_ASSIGN"];
  for (const role of roles) {
    for (const perm of radarPerms) {
      const result = await evaluateRadar(role, perm, { radarAccess: false });
      if (hasPermission(role, perm)) {
        assert.deepEqual(result, { ok: false, reason: "radar-access-revoked" }, `${role} x ${perm} should be revoked, not permission-denied`);
      } else {
        assert.deepEqual(result, { ok: false, reason: "permission-denied" }, `${role} x ${perm} should stay permission-denied`);
      }
    }
  }
});

test("RA-8. inactive (SUSPENDED) row -> DENY (inactive-membership), even with radarAccess true", async () => {
  const result = await evaluateRadar("EMPLOYEE", "RADAR_WORK", { status: "SUSPENDED", radarAccess: true });
  assert.deepEqual(result, { ok: false, reason: "inactive-membership" });
});

test("RA-9. no internal workspace resolvable -> DENY (no-internal-workspace)", async () => {
  const result = await evaluateRadar("EMPLOYEE", "RADAR_WORK", { getInternalOrgId: noInternalOrg() });
  assert.deepEqual(result, { ok: false, reason: "no-internal-workspace" });
});

test("RA-10. a non-RADAR permission passed to evaluateRadarAccess() fails closed (permission-denied), never falls back to a plain permission check", async () => {
  const result = await evaluateRadar("OWNER", "WORKFORCE_MANAGE", { radarAccess: true });
  assert.deepEqual(result, { ok: false, reason: "permission-denied" });
});

test("RA-11. a membership lookup failure propagates (rejects), never resolves to ALLOW", async () => {
  await assert.rejects(
    () => evaluateRadarAccess({ userId: USER_ID, permission: "RADAR_WORK", getInternalOrgId: fixedInternalOrg(), lookupMembership: async () => { throw new Error("db unreachable"); } }),
    /db unreachable/,
  );
});

test("RA-12. requireRadarAccess() redirects to /admin on any denial, including a revoked individual radar_access", async () => {
  withMembershipRow("EMPLOYEE", "ACTIVE", false);
  await assert.rejects(
    () => requireRadarAccess("RADAR_WORK"),
    (e) => typeof e?.digest === "string" && e.digest.startsWith("NEXT_REDIRECT") && e.digest.includes("/admin"),
  );
});

test("RA-13. requireRadarAccess() returns the role on success", async () => {
  withMembershipRow("MANAGER", "ACTIVE", true);
  assert.equal(await requireRadarAccess("RADAR_WORK"), "MANAGER");
});

test("RA-14. requireRadarAccess() has exactly one parameter (permission) — no way to pass an identity", () => {
  assert.equal(requireRadarAccess.length, 1);
});

test("RA-15. unauthenticated caller: requireRadarAccess denies via requireSession()'s own existing redirect, never evaluates radar access", async () => {
  sessionMockState = { kind: "unauthenticated" };
  try {
    await assert.rejects(() => requireRadarAccess("RADAR_WORK"), (e) => typeof e?.digest === "string" && e.digest.startsWith("NEXT_REDIRECT"));
  } finally {
    sessionMockState = { kind: "session", userId: USER_ID };
  }
});

// ------------- WORKFORCE ACCESS CONTROL — canCurrentUserWorkRadar() now radar-access-aware -------------

test("RA-16. canCurrentUserWorkRadar(): ACTIVE EMPLOYEE with radar ON -> true", async () => {
  withMembershipRow("EMPLOYEE", "ACTIVE", true);
  assert.equal(await canCurrentUserWorkRadar(), true);
});

test("RA-17. canCurrentUserWorkRadar(): ACTIVE EMPLOYEE with radar OFF -> false — the nav entry must not be shown for a revoked individual access even though the role still grants RADAR_WORK", async () => {
  withMembershipRow("EMPLOYEE", "ACTIVE", false);
  assert.equal(await canCurrentUserWorkRadar(), false);
});

test("RA-18. canCurrentUserWorkRadar(): no membership -> false", async () => {
  withNoMembershipRow();
  assert.equal(await canCurrentUserWorkRadar(), false);
});

// ------------- WORKFORCE ACCESS CONTROL — getRadarCapabilities() now radar-access-aware -------------

test("RA-19. getRadarCapabilities(): ACTIVE MANAGER with radar OFF -> all three false, even though the role alone would grant all three", async () => {
  withMembershipRow("MANAGER", "ACTIVE", false);
  assert.deepEqual(await getRadarCapabilities(), ALL_CAPS_FALSE);
});

// ------------- WORKFORCE — FINALIZE EMPLOYEE EXPERIENCE — isCurrentUserEmployeeTier() -------------
// Non-redirecting — decides only whether the sidebar OMITS the
// "Utilisateurs" nav item. Same composition-only testing philosophy as
// isCurrentUserOwner() above: the role matrix itself (CRM_READ granted to
// every tier) is already proven by tests 1-20; these tests prove this
// function's own composition (real session -> real
// evaluateStaffPermission("CRM_READ") -> ok && role === "EMPLOYEE").

test("EMP-TIER-1. real EMPLOYEE membership -> true", async () => {
  withMembershipRow("EMPLOYEE");
  assert.equal(await isCurrentUserEmployeeTier(), true);
});

test("EMP-TIER-2. OWNER -> false", async () => {
  withMembershipRow("OWNER");
  assert.equal(await isCurrentUserEmployeeTier(), false);
});

test("EMP-TIER-3. ADMIN -> false", async () => {
  withMembershipRow("ADMIN");
  assert.equal(await isCurrentUserEmployeeTier(), false);
});

test("EMP-TIER-4. MANAGER -> false", async () => {
  withMembershipRow("MANAGER");
  assert.equal(await isCurrentUserEmployeeTier(), false);
});

test("EMP-TIER-5. missing staff_members membership -> false, never true (legacy Axis-A-only account keeps seeing the nav item)", async () => {
  withNoMembershipRow();
  assert.equal(await isCurrentUserEmployeeTier(), false);
});

test("EMP-TIER-6. inactive (SUSPENDED) EMPLOYEE membership -> false", async () => {
  withMembershipRow("EMPLOYEE", "SUSPENDED");
  assert.equal(await isCurrentUserEmployeeTier(), false);
});

test("EMP-TIER-7. no internal workspace resolvable -> false, never true", async () => {
  withMembershipRow("EMPLOYEE"); // present but must never be reached — no-workspace denies first
  internalOrgIdMock = async () => null;
  try {
    assert.equal(await isCurrentUserEmployeeTier(), false);
  } finally {
    internalOrgIdMock = async () => INTERNAL_ORG_ID;
  }
});

test("EMP-TIER-8. has exactly zero parameters — reviewed API invariant, same as isCurrentUserOwner()", () => {
  assert.equal(isCurrentUserEmployeeTier.length, 0);
});

test("RA-20. getRadarCapabilities(): ACTIVE MANAGER with radar ON -> unchanged from the role-only matrix already proven above", async () => {
  withMembershipRow("MANAGER", "ACTIVE", true);
  assert.deepEqual(await getRadarCapabilities(), { canClaimToSelf: true, canAssignOthers: true, canReleaseOwn: true });
});

// ============================================================================
// PERF — ADMIN NAV VISIBILITY CONSOLIDATION (app/admin/layout.tsx's 5 probes)
// ============================================================================
//
// Structural proof (source-text inspection, same pattern
// lib/actions/radar-ai-quota-governance.test.mjs's own "delegation" tests
// already use in this codebase) that the five nav-visibility probes below
// share ONE per-request data fetch instead of each independently calling
// evaluateStaffPermission()/evaluateRadarAccess() (which each internally
// default to their own getInternalOrganizationId() + staff_members read).
//
// NOTE on why this is structural, not a live DB-call-count test: the shared
// fetch is wrapped in React's cache() (the same per-request memoization
// primitive lib/session.ts::resolveAccessState() and
// lib/dev-org.ts::getOrCreateDevOrganization() already rely on elsewhere in
// this exact codebase). cache() only dedupes within an actual Next.js
// Server Component render/request — outside that context (a bare Node
// script, or this test file) it has no request boundary to scope a cache
// to and does not dedupe at all, so a call-count assertion here would
// measure the WRONG thing (it would report "not deduped" even though the
// real Next.js render correctly dedupes) and could not reliably prove the
// optimization either way. This is exactly why neither resolveAccessState()
// nor getOrCreateDevOrganization() has a dedup-count test anywhere in this
// codebase today — the same limitation applies here, not a gap specific to
// this change. Source-text inspection is therefore the reliable way to
// prove the consolidation actually happened.

function functionBody(name) {
  const re = new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`, "m");
  const match = SOURCE.match(re);
  assert.ok(match, `could not locate function body for ${name}`);
  return match[1];
}

const NAV_PROBE_NAMES = [
  "isCurrentUserOwner",
  "canCurrentUserManageWorkforce",
  "canCurrentUserManageAiPolicy",
  "canCurrentUserWorkRadar",
  "isCurrentUserEmployeeTier",
];

test("PERF: resolveCallerNavState is wrapped in React's cache() -- the shared per-request memoization primitive", () => {
  assert.match(SOURCE, /import\s*\{\s*cache\s*\}\s*from\s*"react"/);
  assert.match(SOURCE, /const resolveCallerNavState = cache\(async/);
});

for (const name of NAV_PROBE_NAMES) {
  test(`PERF: ${name}() calls resolveCallerNavState() -- never evaluateStaffPermission()/evaluateRadarAccess() directly`, () => {
    const body = functionBody(name);
    assert.match(body, /resolveCallerNavState\(session\.userId\)/, `${name} must call the shared resolver`);
    assert.equal(/evaluateStaffPermission\(/.test(body), false, `${name} must not call evaluateStaffPermission() directly`);
    assert.equal(/evaluateRadarAccess\(/.test(body), false, `${name} must not call evaluateRadarAccess() directly`);
    assert.equal(/getInternalOrganizationId\(/.test(body), false, `${name} must not call getInternalOrganizationId() directly`);
  });
}

test("PERF: getInternalOrganizationId() is called from exactly one place for the nav-visibility path -- inside resolveCallerNavState() only", () => {
  const resolverBody = SOURCE.slice(SOURCE.indexOf("const resolveCallerNavState = cache(async"), SOURCE.indexOf("});", SOURCE.indexOf("const resolveCallerNavState = cache(async")));
  assert.match(resolverBody, /getInternalOrganizationId\(\)/);
  // The staff row fetched by resolveCallerNavState() is the RADAR-shaped
  // superset (role, status, radarAccess) -- a single query serves both the
  // plain-permission probes and the radar_access-aware probe, never two.
  assert.match(resolverBody, /defaultLookupRadarMembership\(/);
});

test("PERF: evaluateStaffPermission()/evaluateRadarAccess()/requireStaffMember()/requireRadarAccess() are completely untouched by the consolidation -- resolveCallerNavState is never referenced by any of them", () => {
  for (const gate of ["evaluateStaffPermission", "evaluateRadarAccess", "requireStaffMember", "requireRadarAccess"]) {
    const re = new RegExp(`export async function ${gate}\\([\\s\\S]*?\\n\\}`, "m");
    const match = SOURCE.match(re);
    assert.ok(match, `could not locate ${gate}`);
    assert.equal(/resolveCallerNavState/.test(match[0]), false, `${gate} must never reference resolveCallerNavState -- the real authorization gates keep their own independent, unmemoized fetch`);
  }
});

// ---------------- functional parity: the five decisions together, mirroring app/admin/layout.tsx's own Promise.all([...5 probes]) ----------------

async function allFiveNavProbes() {
  const [isOwner, canManageWorkforce, canManageAiPolicy, canWorkRadar, isEmployeeTier] = await Promise.all([
    isCurrentUserOwner(),
    canCurrentUserManageWorkforce(),
    canCurrentUserManageAiPolicy(),
    canCurrentUserWorkRadar(),
    isCurrentUserEmployeeTier(),
  ]);
  return { isOwner, canManageWorkforce, canManageAiPolicy, canWorkRadar, isEmployeeTier };
}

test("PERF-PARITY-1. OWNER: all five probes agree -- isOwner true, canManageWorkforce/canManageAiPolicy/canWorkRadar true, isEmployeeTier false", async () => {
  withMembershipRow("OWNER", "ACTIVE", true);
  assert.deepEqual(await allFiveNavProbes(), { isOwner: true, canManageWorkforce: true, canManageAiPolicy: true, canWorkRadar: true, isEmployeeTier: false });
});

test("PERF-PARITY-2. ADMIN: isOwner false, canManageWorkforce true, canManageAiPolicy false (OWNER-exclusive), canWorkRadar true, isEmployeeTier false", async () => {
  withMembershipRow("ADMIN", "ACTIVE", true);
  assert.deepEqual(await allFiveNavProbes(), { isOwner: false, canManageWorkforce: true, canManageAiPolicy: false, canWorkRadar: true, isEmployeeTier: false });
});

test("PERF-PARITY-3. MANAGER: isOwner false, canManageWorkforce false, canManageAiPolicy false, canWorkRadar true, isEmployeeTier false", async () => {
  withMembershipRow("MANAGER", "ACTIVE", true);
  assert.deepEqual(await allFiveNavProbes(), { isOwner: false, canManageWorkforce: false, canManageAiPolicy: false, canWorkRadar: true, isEmployeeTier: false });
});

test("PERF-PARITY-4. EMPLOYEE: isOwner false, canManageWorkforce false, canManageAiPolicy false, canWorkRadar true, isEmployeeTier true", async () => {
  withMembershipRow("EMPLOYEE", "ACTIVE", true);
  assert.deepEqual(await allFiveNavProbes(), { isOwner: false, canManageWorkforce: false, canManageAiPolicy: false, canWorkRadar: true, isEmployeeTier: true });
});

test("PERF-PARITY-5. EMPLOYEE with radar_access=false: canWorkRadar false, every other probe unaffected by that individual override", async () => {
  withMembershipRow("EMPLOYEE", "ACTIVE", false);
  assert.deepEqual(await allFiveNavProbes(), { isOwner: false, canManageWorkforce: false, canManageAiPolicy: false, canWorkRadar: false, isEmployeeTier: true });
});

test("PERF-PARITY-6. no internal workspace resolvable (workspace isolation: no workspace, no fallback role) -- all five false", async () => {
  withMembershipRow("OWNER", "ACTIVE", true); // present but must never be reached
  internalOrgIdMock = async () => null;
  try {
    assert.deepEqual(await allFiveNavProbes(), { isOwner: false, canManageWorkforce: false, canManageAiPolicy: false, canWorkRadar: false, isEmployeeTier: false });
  } finally {
    internalOrgIdMock = async () => INTERNAL_ORG_ID;
  }
});

test("PERF-PARITY-7. no staff_members membership at all -- all five false, nav stays exactly as a legacy Axis-A-only account sees it today", async () => {
  withNoMembershipRow();
  assert.deepEqual(await allFiveNavProbes(), { isOwner: false, canManageWorkforce: false, canManageAiPolicy: false, canWorkRadar: false, isEmployeeTier: false });
});

test("PERF-PARITY-8. SUSPENDED OWNER -- inactive membership denies every probe, including isOwner (a suspended OWNER never sees Owner Control)", async () => {
  withMembershipRow("OWNER", "SUSPENDED", true);
  assert.deepEqual(await allFiveNavProbes(), { isOwner: false, canManageWorkforce: false, canManageAiPolicy: false, canWorkRadar: false, isEmployeeTier: false });
});
