// Standalone role/permission guard tests — run with:
//   npx tsx --test lib/dev-role.test.mjs
// No test framework dependency added: tsx (already resolvable via npx, respects
// tsconfig paths) + Node's built-in node:test + mock.module. Mocks only
// @/lib/session's requireSession() (fabricated sessions/redirects instead of
// a live Clerk/DB connection); next/navigation's redirect() is the REAL
// implementation — it always throws a NEXT_REDIRECT control-flow error by
// design, so we let it throw and assert on the digest instead of stubbing
// it out. The mock reproduces requireSession()'s own three outcomes
// (unauthenticated → /sign-in, authenticated with no membership →
// /access-pending, has a membership → return it) so getDevRole() and the
// require*Role() guards built on top of it are exercised exactly as they
// run in production, including the "never throw a raw error" behavior —
// see lib/session.ts's requireSession().
//
// Scope note: this tests the MAIN app's 3-role model (admin/staff/client)
// only. The Audit app's role model (admin/supervisor/staff, "agent" in the
// UI, no "client" login) lives in lib/gbp-audit/session.ts — its
// require*Role guards live in the same module as getAuditStaffSession
// (unlike dev-role.ts, which is a separate file from lib/session.ts), and
// getAuditStaffSession is wrapped in React's cache(), which doesn't
// reliably memoize/behave outside an actual render — both make the clean
// mock.module approach used below not straightforwardly portable there.
// Covered instead by e2e/access-pending.spec.ts (live Playwright + real DB).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { redirect } from "next/navigation";

/** @type {{ kind: "unauthenticated" } | { kind: "no-role" } | { kind: "session"; session: object }} */
let mockState = { kind: "unauthenticated" };

mock.module("@/lib/session", {
  namedExports: {
    // Mirrors the real requireSession() in lib/session.ts: redirect on the
    // two "no access" outcomes, otherwise return the resolved session.
    requireSession: async () => {
      if (mockState.kind === "unauthenticated") {
        redirect("/sign-in");
      }
      if (mockState.kind === "no-role") {
        redirect("/access-pending");
      }
      return mockState.session;
    },
  },
});

const { getDevRole, requireStaffRole, requireAdminRole } = await import("./dev-role.ts");

function withSession(role) {
  mockState = {
    kind: "session",
    session: { userId: "u1", clerkUserId: "c1", email: "t@test.com", fullName: "Test", organizationId: "o1", organizationName: "Org", role },
  };
}
function withNoRole() {
  mockState = { kind: "no-role" };
}
function withUnauthenticated() {
  mockState = { kind: "unauthenticated" };
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

test("utilisateur non connecté : getDevRole redirects to /sign-in, never throws", async () => {
  withUnauthenticated();
  await assertRedirectsTo(getDevRole, "/sign-in");
});

test("utilisateur connecté sans rôle : getDevRole redirects to /access-pending, never throws", async () => {
  withNoRole();
  await assertRedirectsTo(getDevRole, "/access-pending");
});

test("utilisateur connecté sans rôle : requireStaffRole redirects to /access-pending, never throws", async () => {
  withNoRole();
  await assertRedirectsTo(requireStaffRole, "/access-pending");
});

test("utilisateur connecté sans rôle : requireAdminRole redirects to /access-pending, never throws", async () => {
  withNoRole();
  await assertRedirectsTo(requireAdminRole, "/access-pending");
});

for (const role of ["staff", "admin"]) {
  test(`administrateur/staff : requireStaffRole allows role=${role}`, async () => {
    withSession(role);
    assert.equal(await requireStaffRole(), role);
  });
}

test("administrateur : requireAdminRole allows admin", async () => {
  withSession("admin");
  assert.equal(await requireAdminRole(), "admin");
});

test("staff (non-admin) : requireAdminRole redirects to /admin", async () => {
  withSession("staff");
  await assertRedirectsTo(requireAdminRole, "/admin");
});

test("client essayant d'accéder à une page staff : requireStaffRole redirects to /dashboard", async () => {
  withSession("client");
  await assertRedirectsTo(requireStaffRole, "/dashboard");
});

test("client essayant d'accéder à une page admin : requireAdminRole redirects to /dashboard, jamais l'accès", async () => {
  withSession("client");
  await assertRedirectsTo(requireAdminRole, "/dashboard");
});
