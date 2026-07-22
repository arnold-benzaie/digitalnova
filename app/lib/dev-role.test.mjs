// Standalone role/permission guard tests — run with:
//   npx tsx --test lib/dev-role.test.mjs
// No test framework dependency added: tsx (already resolvable via npx, respects
// tsconfig paths) + Node's built-in node:test + mock.module. Mocks only
// @/lib/session (fabricated sessions instead of a live Clerk/DB connection);
// next/navigation's redirect() is the REAL implementation — it always throws
// a NEXT_REDIRECT control-flow error by design, so we let it throw and assert
// on the digest instead of stubbing it out.
//
// Scope note: this tests the MAIN app's 3-role model (admin/staff/client)
// only. The Audit app's role model (admin/supervisor/staff, no "client"
// login) lives in lib/gbp-audit/session.ts — its require*Role guards live
// in the same module as getAuditStaffSession (unlike dev-role.ts, which is
// a separate file from lib/session.ts), and getAuditStaffSession is wrapped
// in React's cache(), which doesn't reliably memoize/behave outside an
// actual render — both make the clean mock.module approach used below not
// straightforwardly portable there. Covered instead by live Playwright runs
// this session (e.g. confirming AuditStatusControl can't bypass the
// supervisor gate — see components/gbp-audit/audit-status-control.tsx).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let mockSession = null;
mock.module("@/lib/session", {
  namedExports: {
    getCurrentSession: async () => mockSession,
  },
});

const { getDevRole, requireStaffRole, requireAdminRole } = await import("./dev-role.ts");

function withSession(role) {
  mockSession = role
    ? { userId: "u1", clerkUserId: "c1", email: "t@test.com", fullName: "Test", organizationId: "o1", organizationName: "Org", role }
    : null;
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

test("getDevRole throws when no session (no membership)", async () => {
  withSession(null);
  await assert.rejects(() => getDevRole(), /Accès refusé/);
});

for (const role of ["staff", "admin"]) {
  test(`requireStaffRole allows role=${role}`, async () => {
    withSession(role);
    assert.equal(await requireStaffRole(), role);
  });
}

test("requireStaffRole redirects client to /dashboard", async () => {
  withSession("client");
  await assertRedirectsTo(requireStaffRole, "/dashboard");
});

test("requireAdminRole allows admin", async () => {
  withSession("admin");
  assert.equal(await requireAdminRole(), "admin");
});

test("requireAdminRole redirects staff to /admin", async () => {
  withSession("staff");
  await assertRedirectsTo(requireAdminRole, "/admin");
});

test("requireAdminRole redirects client to /dashboard (staff gate fires first)", async () => {
  withSession("client");
  await assertRedirectsTo(requireAdminRole, "/dashboard");
});
