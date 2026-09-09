// PHASE OWNER-UI (Slice 2) — focused test for the /admin/owner protected
// route. Proves: (1) the authorization boundary is the FIRST thing that
// runs and asks for exactly "OWNER_MANAGE"; (2) the ADMIN roster is read
// through the OWNER-gated wrapper (listAdminGovernanceRoster), never a
// direct DB call from the page; (3) a guard denial produces no page
// content; (4) caller-supplied input changes nothing.
//
// @/lib/rbac/require-staff-member and @/lib/actions/workforce-admin-ui are
// mocked at the module boundary so no live Postgres / Next runtime is
// needed. getLocale() is left real (returns "fr" outside a request).
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/owner/page.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let permissionCalls = [];
let denyMode = false;
let rosterCalls = 0;

mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "OWNER";
    },
  },
});

mock.module("@/lib/actions/workforce-admin-ui", {
  namedExports: {
    listAdminGovernanceRoster: async () => {
      rosterCalls += 1;
      return [
        { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fullName: "A", email: "a@ex.com", status: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", invitedByEmail: null },
      ];
    },
    demoteAdminAction: async () => undefined,
    suspendAdminAction: async () => undefined,
    reactivateAdminAction: async () => undefined,
    offboardAdminAction: async () => undefined,
  },
});

const { default: OwnerControlPage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
  rosterCalls = 0;
}

test("OWNER-UI page: authorized -> renders; guard called exactly once with 'OWNER_MANAGE'; roster read via the OWNER-gated wrapper", async () => {
  reset();
  const el = await OwnerControlPage();
  assert.deepEqual(permissionCalls, ["OWNER_MANAGE"]);
  assert.equal(rosterCalls, 1, "the page reads the ADMIN roster through listAdminGovernanceRoster()");
  assert.ok(el, "expected a React element when authorized");
});

test("OWNER-UI page: a guard denial (NEXT_REDIRECT) propagates — no roster read, no page content", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => OwnerControlPage(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["OWNER_MANAGE"], "the guard still ran, with exactly OWNER_MANAGE, before any read");
  assert.equal(rosterCalls, 0, "a denied caller never reaches the roster read");
});

test("OWNER-UI page: authorization ignores caller-supplied input — a forged { searchParams } / { params } changes nothing", async () => {
  reset();
  const el = await OwnerControlPage({ searchParams: { isOwner: "true", role: "OWNER" }, params: { workspace: "other-org" } });
  assert.deepEqual(permissionCalls, ["OWNER_MANAGE"], "still exactly OWNER_MANAGE — no caller value influences the check");
  assert.ok(el);
});

test("OWNER-UI page: the component declares no parameters (nothing to read isOwner / email / workspace / role from)", () => {
  assert.equal(OwnerControlPage.length, 0);
});
