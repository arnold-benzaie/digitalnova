// PHASE OWNER-UI-2 — focused test for the /admin/owner protected route.
// It proves ONE thing: the page's authorization boundary exists, runs
// first, and asks for exactly "OWNER_MANAGE" — nothing else. The
// OWNER-vs-ADMIN/MANAGER/EMPLOYEE/suspended-OWNER semantics of that
// permission are already exhaustively proven by
// lib/rbac/require-staff-member.test.mjs and lib/rbac/permissions.test.mjs,
// so they are not re-litigated here.
//
// @/lib/rbac/require-staff-member is mocked at the module boundary (same
// technique lib/actions/workforce.test.mjs uses) so its real @/db import
// never loads — no live Postgres, no Next.js runtime needed. getLocale()
// is left real: it never throws outside a request scope (returns "fr").
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/owner/page.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let permissionCalls = [];
let denyMode = false;

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

const { default: OwnerControlPage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
}

test("OWNER-UI-2 page: authorized -> renders, and the guard was called exactly once with 'OWNER_MANAGE'", async () => {
  reset();
  const el = await OwnerControlPage();
  assert.deepEqual(permissionCalls, ["OWNER_MANAGE"]);
  assert.ok(el, "expected a React element when authorized");
});

test("OWNER-UI-2 page: a guard denial (NEXT_REDIRECT) propagates — no page content is produced", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => OwnerControlPage(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["OWNER_MANAGE"], "the guard still ran, with exactly OWNER_MANAGE, before any render");
});

test("OWNER-UI-2 page: authorization ignores caller-supplied input — a forged { searchParams } / { params } changes nothing", async () => {
  reset();
  const el = await OwnerControlPage({ searchParams: { isOwner: "true", role: "OWNER" }, params: { workspace: "other-org" } });
  assert.deepEqual(permissionCalls, ["OWNER_MANAGE"], "still exactly OWNER_MANAGE — no caller value influences the check");
  assert.ok(el);
});

test("OWNER-UI-2 page: the component declares no parameters (nothing to read isOwner / email / workspace / role from)", () => {
  assert.equal(OwnerControlPage.length, 0);
});
