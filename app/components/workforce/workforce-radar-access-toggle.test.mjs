// components/workforce/workforce-radar-access-toggle.test.mjs — WORKFORCE
// ACCESS CONTROL: per-row RADAR ON/OFF toggle on /admin/workforce.
//
// Same conventions as workforce-role-select.test.mjs (this repo has no
// act()-capable React harness):
//   - visible markup asserted via renderToStaticMarkup;
//   - the code -> localized-copy mapping asserted directly against the
//     exported pure helper workforceRadarAccessErrorMessage().
//
// Run with: npx tsx --test --experimental-test-module-mocks components/workforce/workforce-radar-access-toggle.test.mjs
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
    setWorkforceMemberRadarAccessAction: async () => undefined,
  },
});
mock.module("@/components/gbp-audit/ui/use-confirm-dialog", {
  namedExports: { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
});

const { WorkforceRadarAccessToggle, workforceRadarAccessErrorMessage } = await import("./workforce-radar-access-toggle.tsx");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.workforce;
const tEn = dictionaries.en.workforce;

const OTHER_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROW_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function html(props) {
  return renderToStaticMarkup(
    React.createElement(WorkforceRadarAccessToggle, {
      userId: ROW_USER,
      email: "member@example.com",
      role: "MANAGER",
      status: "ACTIVE",
      radarAccess: true,
      currentUserId: OTHER_USER,
      viewerRole: "ADMIN",
      locale: "fr",
      ...props,
    }),
  );
}

// -------------------------------- visibility --------------------------------

test("RT-C1. ACTIVE MANAGER (non-self), viewer ADMIN -> an interactive switch, not plain text", () => {
  const out = html({ role: "MANAGER", viewerRole: "ADMIN" });
  assert.ok(out.includes('role="switch"'), "renders an interactive switch");
});

test("RT-C2. ACTIVE EMPLOYEE (non-self), viewer ADMIN -> an interactive switch", () => {
  const out = html({ role: "EMPLOYEE", viewerRole: "ADMIN" });
  assert.ok(out.includes('role="switch"'));
});

test("RT-C3. ADMIN target + viewer ADMIN -> plain read-only text, never a switch (only OWNER may change an ADMIN's radar access)", () => {
  const out = html({ role: "ADMIN", viewerRole: "ADMIN", radarAccess: true });
  assert.ok(!out.includes('role="switch"'), "no switch for an ADMIN target when the viewer is ADMIN");
  assert.ok(out.includes(tFr.radarAccessOn), "the real value is still shown, read-only");
});

test("RT-C4. ADMIN target + viewer OWNER -> an interactive switch (OWNER may change an ADMIN's radar access)", () => {
  const out = html({ role: "ADMIN", viewerRole: "OWNER", radarAccess: true });
  assert.ok(out.includes('role="switch"'), "OWNER viewer gets an interactive switch even for an ADMIN target");
});

test("RT-C5. self row (userId === currentUserId) -> plain read-only text, never a switch", () => {
  const out = html({ role: "MANAGER", userId: ROW_USER, currentUserId: ROW_USER, radarAccess: true });
  assert.ok(!out.includes('role="switch"'));
  assert.ok(out.includes(tFr.radarAccessOn));
});

test("RT-C6. SUSPENDED row -> plain read-only text, never a switch (the server refuses a radar-access change on a non-ACTIVE member)", () => {
  const out = html({ role: "MANAGER", status: "SUSPENDED", radarAccess: false });
  assert.ok(!out.includes('role="switch"'));
  assert.ok(out.includes(tFr.radarAccessOff));
});

test("RT-C7. OFFBOARDING row -> plain read-only text, never a switch", () => {
  const out = html({ role: "EMPLOYEE", status: "OFFBOARDING", radarAccess: true });
  assert.ok(!out.includes('role="switch"'));
});

test("RT-C8. radarAccess true renders the ON label; false renders the OFF label", () => {
  assert.ok(html({ radarAccess: true }).includes(tFr.radarAccessOn));
  assert.ok(html({ radarAccess: false }).includes(tFr.radarAccessOff));
});

test("RT-C9. no <form>, no named form field, no workspace/org/actor/intent leaked into markup", () => {
  const out = html({ role: "MANAGER" });
  assert.ok(!out.includes("<form"), "no <form> element");
  assert.ok(!out.includes('name="'), "no named form field anywhere");
  for (const forbidden of ["workspace", "organizationId", "organization", "actor", "staffMemberId", "intent"]) {
    assert.ok(!out.includes(forbidden), `must not render "${forbidden}"`);
  }
});

test("RT-C10. no raw UUID (row userId or currentUserId) appears in the visible markup", () => {
  const out = html({ role: "MANAGER" });
  assert.ok(!out.includes(ROW_USER) && !out.includes(OTHER_USER), "no internal id is rendered");
});

test("RT-C11. FR labels", () => {
  assert.ok(html({ radarAccess: true, locale: "fr" }).includes(tFr.radarAccessOn));
});

test("RT-C12. EN labels", () => {
  const out = html({ radarAccess: false, locale: "en" });
  assert.ok(out.includes(tEn.radarAccessOff));
  assert.ok(!out.includes(tFr.radarAccessOff), "no FR label leaks into the EN render");
});

test("RT-C13. idle render shows no changing/error copy", () => {
  const out = html({ role: "MANAGER" });
  assert.ok(!out.includes(tFr.radarAccessChanging));
  assert.ok(!out.includes('role="alert"'));
});

// ---------------------------- pure helper ----------------------------

const ALL_CODES = [
  "INVALID_TARGET",
  "INVALID_VALUE",
  "SELF_RADAR_ACCESS_NOT_ALLOWED",
  "MEMBER_NOT_FOUND",
  "OWNER_PROTECTED",
  "ADMIN_TIER_PROTECTED",
  "RADAR_ACCESS_UNCHANGED",
  "MEMBER_NOT_ACTIVE",
];

test("RT-H1. workforceRadarAccessErrorMessage maps every code to localized copy (FR + EN); null / unknown -> null", () => {
  const expectFr = {
    INVALID_TARGET: tFr.errorInvalidTarget,
    INVALID_VALUE: tFr.errorInvalidValue,
    SELF_RADAR_ACCESS_NOT_ALLOWED: tFr.errorSelfRadarAccess,
    MEMBER_NOT_FOUND: tFr.errorMemberNotFound,
    OWNER_PROTECTED: tFr.errorOwnerProtected,
    ADMIN_TIER_PROTECTED: tFr.errorAdminTierProtected,
    RADAR_ACCESS_UNCHANGED: tFr.errorRadarAccessUnchanged,
    MEMBER_NOT_ACTIVE: tFr.errorRadarAccessNotActive,
  };
  for (const code of ALL_CODES) {
    assert.equal(workforceRadarAccessErrorMessage(code, tFr), expectFr[code]);
    assert.equal(typeof workforceRadarAccessErrorMessage(code, tEn), "string");
    assert.notEqual(workforceRadarAccessErrorMessage(code, tEn), "");
  }
  assert.equal(workforceRadarAccessErrorMessage(null, tFr), null);
  assert.equal(workforceRadarAccessErrorMessage("SOME_UNKNOWN_CODE", tFr), null);
});
