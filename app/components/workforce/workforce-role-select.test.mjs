// components/workforce/workforce-role-select.test.mjs — WORKFORCE ACCESS
// CONTROL UI: per-row MANAGER <-> EMPLOYEE role-change control on
// /admin/workforce, replacing the previous plain-text role cell.
//
// Same conventions as workforce-lifecycle-actions.test.mjs (this repo has
// no act()-capable React harness):
//   - visible markup asserted via renderToStaticMarkup;
//   - the code -> localized-copy mapping asserted directly against the
//     exported pure helper workforceRoleChangeErrorMessage().
//
// Run with: npx tsx --test --experimental-test-module-mocks components/workforce/workforce-role-select.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});
mock.module("@/lib/actions/workforce-ui", {
  namedExports: {
    // Never invoked by a static render; present so the value import resolves.
    changeWorkforceMemberRoleAction: async () => undefined,
  },
});

const { WorkforceRoleSelect, workforceRoleChangeErrorMessage } = await import("./workforce-role-select.tsx");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.workforce;
const tEn = dictionaries.en.workforce;

const OTHER_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROW_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function html(props) {
  return renderToStaticMarkup(
    React.createElement(WorkforceRoleSelect, {
      userId: ROW_USER,
      role: "MANAGER",
      status: "ACTIVE",
      locale: "fr",
      currentUserId: OTHER_USER,
      ...props,
    }),
  );
}

// -------------------------------- visibility --------------------------------

test("R2C-C1. ACTIVE MANAGER (non-self) -> a <select> with MANAGER + EMPLOYEE options", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(out.includes("<select"), "renders a select control");
  assert.ok(out.includes(tFr.roleManager) && out.includes(tFr.roleEmployee));
  assert.ok(!out.includes(tFr.roleAdmin), "ADMIN is never an offered option");
});

test("R2C-C2. ACTIVE EMPLOYEE (non-self) -> a <select> with MANAGER + EMPLOYEE options", () => {
  const out = html({ role: "EMPLOYEE", status: "ACTIVE" });
  assert.ok(out.includes("<select"));
  assert.ok(out.includes(tFr.roleManager) && out.includes(tFr.roleEmployee));
});

test("R2C-C3. ADMIN row -> plain read-only text, never a <select> (ADMIN/OWNER tier is a separate OWNER_MANAGE capability)", () => {
  const out = html({ role: "ADMIN", status: "ACTIVE" });
  assert.ok(!out.includes("<select"), "no select for an ADMIN row");
  assert.ok(out.includes(tFr.roleAdmin), "the real ADMIN label is still shown, read-only");
});

test("R2C-C4. self row (userId === currentUserId) -> plain read-only text, never a <select>", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE", userId: ROW_USER, currentUserId: ROW_USER });
  assert.ok(!out.includes("<select"));
  assert.ok(out.includes(tFr.roleManager));
});

test("R2C-C5. SUSPENDED row -> plain read-only text, never a <select> (the server refuses a role change on a non-ACTIVE member)", () => {
  const out = html({ role: "MANAGER", status: "SUSPENDED" });
  assert.ok(!out.includes("<select"));
  assert.ok(out.includes(tFr.roleManager));
});

test("R2C-C6. OFFBOARDING row -> plain read-only text, never a <select>", () => {
  const out = html({ role: "EMPLOYEE", status: "OFFBOARDING" });
  assert.ok(!out.includes("<select"));
  assert.ok(out.includes(tFr.roleEmployee));
});

test("R2C-C7. no <form>, no named form field, no workspace/org/actor/intent leaked into markup", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(!out.includes("<form"), "no <form> element");
  assert.ok(!out.includes('name="'), "no named form field anywhere");
  for (const forbidden of ["workspace", "organizationId", "organization", "actor", "staffMemberId", "intent"]) {
    assert.ok(!out.includes(forbidden), `must not render "${forbidden}"`);
  }
});

test("R2C-C8. no raw UUID (row userId or currentUserId) appears in the visible markup", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(!out.includes(ROW_USER) && !out.includes(OTHER_USER), "no internal id is rendered");
});

test("R2C-C9. FR labels", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE", locale: "fr" });
  assert.ok(out.includes(tFr.roleManager) && out.includes(tFr.roleEmployee));
});

test("R2C-C10. EN labels", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE", locale: "en" });
  assert.ok(out.includes(tEn.roleManager) && out.includes(tEn.roleEmployee));
  // roleManager is spelled identically in both dictionaries ("Manager") —
  // roleEmployee ("Employé" vs "Employee") is the one that actually
  // distinguishes an FR leak from a genuine EN render.
  assert.ok(!out.includes(tFr.roleEmployee), "no FR label leaks into the EN render");
});

test("R2C-C11. idle render shows no pending/error copy", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(!out.includes(tFr.changingRole));
  assert.ok(!out.includes('role="alert"'));
});

// ---------------------------- pure helper ----------------------------

const ALL_CODES = [
  "INVALID_TARGET",
  "INVALID_ROLE",
  "SELF_ROLE_CHANGE_NOT_ALLOWED",
  "MEMBER_NOT_FOUND",
  "OWNER_PROTECTED",
  "ADMIN_TIER_PROTECTED",
  "ROLE_UNCHANGED",
  "MEMBER_NOT_ACTIVE",
];

test("R2C-H1. workforceRoleChangeErrorMessage maps every code to localized copy (FR + EN); null / unknown -> null", () => {
  const expectFr = {
    INVALID_TARGET: tFr.errorInvalidTarget,
    INVALID_ROLE: tFr.errorInvalidRole,
    SELF_ROLE_CHANGE_NOT_ALLOWED: tFr.errorSelfRoleChange,
    MEMBER_NOT_FOUND: tFr.errorMemberNotFound,
    OWNER_PROTECTED: tFr.errorOwnerProtected,
    ADMIN_TIER_PROTECTED: tFr.errorAdminTierProtected,
    ROLE_UNCHANGED: tFr.errorRoleUnchanged,
    MEMBER_NOT_ACTIVE: tFr.errorMemberNotActive,
  };
  for (const code of ALL_CODES) {
    assert.equal(workforceRoleChangeErrorMessage(code, tFr), expectFr[code]);
    assert.equal(typeof workforceRoleChangeErrorMessage(code, tEn), "string");
    assert.notEqual(workforceRoleChangeErrorMessage(code, tEn), "");
  }
  assert.equal(workforceRoleChangeErrorMessage(null, tFr), null);
  assert.equal(workforceRoleChangeErrorMessage("SOME_UNKNOWN_CODE", tFr), null);
});
