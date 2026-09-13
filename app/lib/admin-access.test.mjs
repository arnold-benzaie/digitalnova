// PHASE 2A.0 — unit tests for the transitional /admin backstop
// requireInternalStaff() (lib/admin-access.ts). Run with:
//   npx tsx --test --experimental-test-module-mocks lib/admin-access.test.mjs
//
// Same approach as lib/dev-role.test.mjs: mock ONLY @/lib/session's
// requireSession() (fabricated sessions/redirects instead of a live
// Clerk/DB connection); next/navigation's redirect() is the REAL
// implementation — it always throws a NEXT_REDIRECT control-flow error by
// design, so we let it throw and assert on the digest.
//
// The mock reproduces requireSession()'s real four non-active redirects
// verbatim (see lib/session.ts): unauthenticated -> /sign-in, pending ->
// /access-pending?ctx=pending, refused -> /access-refused, suspended ->
// /access-suspended — so requireInternalStaff(), which delegates all four
// to requireSession(), is exercised exactly as it runs in production.
//
// SESSION AUTHORITY UNIFICATION — `legacyAppRoleForWorkforce` is ALSO
// mocked (a byte-identical copy of lib/session.ts's own implementation,
// documented as such — see lib/dev-role.test.mjs's identical comment):
// mock.module() replaces the ENTIRE "@/lib/session" module, so
// admin-access.ts's import of this function must be satisfied here too.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { redirect } from "next/navigation";

/** @type {{ kind: "unauthenticated" | "pending" | "refused" | "suspended" } | { kind: "active"; role: string } | { kind: "workforce"; staffRole: string }} */
let mockState = { kind: "unauthenticated" };

mock.module("@/lib/session", {
  namedExports: {
    // Mirrors the real requireSession() in lib/session.ts exactly.
    requireSession: async () => {
      if (mockState.kind === "unauthenticated") redirect("/sign-in");
      if (mockState.kind === "pending") redirect("/access-pending?ctx=pending");
      if (mockState.kind === "refused") redirect("/access-refused");
      if (mockState.kind === "suspended") redirect("/access-suspended");
      if (mockState.kind === "workforce") {
        return {
          context: "WORKFORCE",
          userId: "u1",
          clerkUserId: "c1",
          email: "t@test.com",
          fullName: "Test",
          firstName: "Test",
          organizationId: "internal-org",
          organizationName: "PUBLIC-MAP",
          staffRole: mockState.staffRole,
          previousLastLoginAt: null,
        };
      }
      return {
        context: "CLIENT",
        userId: "u1",
        clerkUserId: "c1",
        email: "t@test.com",
        fullName: "Test",
        firstName: "Test",
        organizationId: "o1",
        organizationName: "Org",
        role: mockState.role,
        previousLastLoginAt: null,
      };
    },
    legacyAppRoleForWorkforce: (session) => (session.staffRole === "OWNER" || session.staffRole === "ADMIN" ? "admin" : "agent"),
  },
});

const { requireInternalStaff } = await import("./admin-access.ts");

function withActiveRole(role) {
  mockState = { kind: "active", role };
}
function withWorkforceRole(staffRole) {
  mockState = { kind: "workforce", staffRole };
}
function withState(kind) {
  mockState = { kind };
}

async function assertRedirectsTo(fn, expectedUrl) {
  try {
    await fn();
    assert.fail(`expected a redirect to ${expectedUrl}, but the function returned normally`);
  } catch (err) {
    const digest = err?.digest ?? "";
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    assert.ok(digest.includes(expectedUrl), `expected redirect to ${expectedUrl}, got digest: ${digest}`);
  }
}

// ---- active non-client roles: allowed, role returned unchanged ----------
for (const role of ["admin", "staff", "agent", "supervisor"]) {
  test(`requireInternalStaff allows active role=${role} and returns it`, async () => {
    withActiveRole(role);
    assert.equal(await requireInternalStaff(), role);
  });
}

// ---- client: fails closed at the /admin boundary -----------------------
test("requireInternalStaff redirects an active client to /dashboard, never allows /admin", async () => {
  withActiveRole("client");
  await assertRedirectsTo(requireInternalStaff, "/dashboard");
});

// ---- non-active states: preserve requireSession()'s exact redirects ----
test("requireInternalStaff : unauthenticated -> /sign-in", async () => {
  withState("unauthenticated");
  await assertRedirectsTo(requireInternalStaff, "/sign-in");
});

test("requireInternalStaff : pending -> /access-pending", async () => {
  withState("pending");
  await assertRedirectsTo(requireInternalStaff, "/access-pending");
});

test("requireInternalStaff : refused -> /access-refused", async () => {
  withState("refused");
  await assertRedirectsTo(requireInternalStaff, "/access-refused");
});

test("requireInternalStaff : suspended -> /access-suspended", async () => {
  withState("suspended");
  await assertRedirectsTo(requireInternalStaff, "/access-suspended");
});

// =====================================================================
// SESSION AUTHORITY UNIFICATION — a WORKFORCE (Axis-C) session, with NO
// Axis-A membership row at all, must pass this segment-boundary gate
// unconditionally. This is the EXACT gap this mission closes.
// =====================================================================

for (const staffRole of ["EMPLOYEE", "MANAGER", "ADMIN", "OWNER"]) {
  test(`requireInternalStaff admits a WORKFORCE session (staffRole=${staffRole}) with NO Axis-A membership at all`, async () => {
    withWorkforceRole(staffRole);
    const role = await requireInternalStaff();
    assert.notEqual(role, "client", "must never be treated as client-excluded");
    assert.ok(typeof role === "string" && role.length > 0);
  });
}

test("requireInternalStaff never redirects a WORKFORCE session to /dashboard (the client-only destination)", async () => {
  withWorkforceRole("EMPLOYEE");
  // A real redirect would throw NEXT_REDIRECT — asserting the call
  // resolves normally is itself the proof no redirect fired.
  await assert.doesNotReject(() => requireInternalStaff());
});

test("no permission fusion: a WORKFORCE session's returned compatibility role is never the literal Axis-C staffRole string", async () => {
  withWorkforceRole("MANAGER");
  const role = await requireInternalStaff();
  assert.notEqual(role, "MANAGER");
  assert.ok(["admin", "staff", "agent", "supervisor"].includes(role));
});
