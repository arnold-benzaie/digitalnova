// components/workforce/workforce-lifecycle-actions.test.mjs — PHASE
// RBAC-RUNTIME-R2D-B per-row ordinary-workforce lifecycle controls.
//
// This repo has no act()-capable React harness (see
// components/app-sidebar-nav.test.mjs). So:
//   - visible markup (which verbs render for each role/status, self-row +
//     ADMIN + OFFBOARDING hiding, absence of any form field / raw UUID,
//     FR/EN labels, idle vs pending labels) is asserted via
//     renderToStaticMarkup — the same approach as
//     add-workforce-member-form.test.mjs / lib/quote-verification.test.mjs;
//   - the code -> localized-copy mapping and the post-result branching are
//     asserted directly against the exported pure helpers
//     workforceLifecycleErrorMessage() / applyWorkforceLifecycleResult().
//
// NOT wired into package.json's `test` list in this mission — run with:
//   npx tsx --test --experimental-test-module-mocks components/workforce/workforce-lifecycle-actions.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});
mock.module("@/lib/actions/workforce-ui", {
  namedExports: {
    // Never invoked by a static render; present so the value imports resolve.
    suspendWorkforceMemberAction: async () => undefined,
    reactivateWorkforceMemberAction: async () => undefined,
    offboardWorkforceMemberAction: async () => undefined,
  },
});
mock.module("@/components/gbp-audit/ui/use-confirm-dialog", {
  namedExports: { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
});

const { WorkforceLifecycleActions, workforceLifecycleErrorMessage, applyWorkforceLifecycleResult } = await import(
  "./workforce-lifecycle-actions.tsx"
);
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.workforce;
const tEn = dictionaries.en.workforce;

const OTHER_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROW_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const decodeEntities = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function html(props) {
  return decodeEntities(
    renderToStaticMarkup(
      React.createElement(WorkforceLifecycleActions, {
        userId: ROW_USER,
        email: "member@example.com",
        role: "MANAGER",
        status: "ACTIVE",
        locale: "fr",
        currentUserId: OTHER_USER,
        ...props,
      }),
    ),
  );
}

// -------------------------------- visible controls --------------------------------

test("R2DB-C1. ACTIVE MANAGER (non-self) -> Suspend + Offboard, no Reactivate", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(out.includes(tFr.actionSuspend) && out.includes(tFr.actionOffboard));
  assert.ok(!out.includes(tFr.actionReactivate));
});

test("R2DB-C2. ACTIVE EMPLOYEE (non-self) -> Suspend + Offboard", () => {
  const out = html({ role: "EMPLOYEE", status: "ACTIVE" });
  assert.ok(out.includes(tFr.actionSuspend) && out.includes(tFr.actionOffboard));
  assert.ok(!out.includes(tFr.actionReactivate));
});

test("R2DB-C3. SUSPENDED MANAGER (non-self) -> Reactivate + Offboard, no Suspend", () => {
  const out = html({ role: "MANAGER", status: "SUSPENDED" });
  assert.ok(out.includes(tFr.actionReactivate) && out.includes(tFr.actionOffboard));
  assert.ok(!out.includes(tFr.actionSuspend));
});

test("R2DB-C4. SUSPENDED EMPLOYEE (non-self) -> Reactivate + Offboard", () => {
  const out = html({ role: "EMPLOYEE", status: "SUSPENDED" });
  assert.ok(out.includes(tFr.actionReactivate) && out.includes(tFr.actionOffboard));
  assert.ok(!out.includes(tFr.actionSuspend));
});

test("R2DB-C5. OFFBOARDING MANAGER -> no lifecycle control at all", () => {
  const out = html({ role: "MANAGER", status: "OFFBOARDING" });
  assert.equal(out, "");
});

test("R2DB-C6. OFFBOARDING EMPLOYEE -> no lifecycle control at all", () => {
  const out = html({ role: "EMPLOYEE", status: "OFFBOARDING" });
  assert.equal(out, "");
});

test("R2DB-C7. ADMIN + ACTIVE -> no lifecycle control (owner-tier lifecycle is future R2D-C)", () => {
  assert.equal(html({ role: "ADMIN", status: "ACTIVE" }), "");
});

test("R2DB-C8. ADMIN + SUSPENDED -> no lifecycle control", () => {
  assert.equal(html({ role: "ADMIN", status: "SUSPENDED" }), "");
});

test("R2DB-C9. self row (userId === currentUserId) -> no lifecycle control", () => {
  assert.equal(html({ role: "MANAGER", status: "ACTIVE", userId: ROW_USER, currentUserId: ROW_USER }), "");
});

test("R2DB-C10. no form and no form fields — buttons only, never a workspace/org/actor/status/intent input", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(!out.includes("<form"), "no <form> element");
  assert.ok(!out.includes('name="'), "no named form field anywhere");
  for (const forbidden of ["workspace", "organizationId", "organization", "actor", "staffMemberId", "expectedStatus", "intent"]) {
    assert.ok(!out.includes(forbidden), `must not render "${forbidden}"`);
  }
});

test("R2DB-C11. no raw UUID (row userId or currentUserId) appears in the visible markup", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(!out.includes(ROW_USER) && !out.includes(OTHER_USER), "no internal id is rendered");
});

test("R2DB-C12. FR labels", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE", locale: "fr" });
  assert.ok(out.includes(tFr.actionSuspend) && out.includes(tFr.actionOffboard));
});

test("R2DB-C13. EN labels", () => {
  const out = html({ role: "MANAGER", status: "SUSPENDED", locale: "en" });
  assert.ok(out.includes(tEn.actionReactivate) && out.includes(tEn.actionOffboard));
  assert.ok(!out.includes(tFr.actionReactivate), "no FR label leaks into the EN render");
});

test("R2DB-C14. idle render shows action labels, not the pending labels", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(!out.includes(tFr.suspending) && !out.includes(tFr.offboarding) && !out.includes(tFr.reactivating));
});

test("R2DB-C15. real <button type=\"button\"> controls; the disabled attribute is absent on the idle render", () => {
  const out = html({ role: "MANAGER", status: "ACTIVE" });
  assert.ok(out.includes('type="button"'));
  assert.ok(!out.includes('disabled=""'), "idle render must not set the disabled attribute (the 'disabled:' class token is not the attribute)");
});

test("R2DB-C16. no role=\"alert\" on the initial (un-acted) render", () => {
  assert.ok(!html({ role: "MANAGER", status: "ACTIVE" }).includes('role="alert"'));
});

// ---------------------------- pure helpers ----------------------------

const ALL_CODES = [
  "INVALID_TARGET",
  "SELF_LIFECYCLE_NOT_ALLOWED",
  "MEMBER_NOT_FOUND",
  "OWNER_PROTECTED",
  "ADMIN_TIER_PROTECTED",
  "STATUS_UNCHANGED",
  "INVALID_STATUS_TRANSITION",
  "MEMBER_STATE_CHANGED",
];

test("R2DB-H1. workforceLifecycleErrorMessage maps every code to localized copy (FR + EN); null / unknown -> null", () => {
  const expectFr = {
    INVALID_TARGET: tFr.errorInvalidTarget,
    SELF_LIFECYCLE_NOT_ALLOWED: tFr.errorSelfLifecycle,
    MEMBER_NOT_FOUND: tFr.errorMemberNotFound,
    OWNER_PROTECTED: tFr.errorOwnerProtected,
    ADMIN_TIER_PROTECTED: tFr.errorAdminTierProtected,
    STATUS_UNCHANGED: tFr.errorStatusUnchanged,
    INVALID_STATUS_TRANSITION: tFr.errorInvalidTransition,
    MEMBER_STATE_CHANGED: tFr.errorStateChanged,
  };
  for (const code of ALL_CODES) {
    assert.equal(workforceLifecycleErrorMessage(code, tFr), expectFr[code]);
    assert.equal(typeof workforceLifecycleErrorMessage(code, tEn), "string");
    assert.notEqual(workforceLifecycleErrorMessage(code, tEn), "");
  }
  assert.equal(workforceLifecycleErrorMessage(null, tFr), null);
  assert.equal(workforceLifecycleErrorMessage("SOMETHING_ELSE", tFr), null);
});

function spies() {
  const calls = { setError: [], refresh: 0 };
  return {
    calls,
    actions: {
      setError: (e) => calls.setError.push(e),
      refresh: () => (calls.refresh += 1),
    },
  };
}

test("R2DB-H2. success (undefined) -> clears error, refreshes exactly once", () => {
  const s = spies();
  applyWorkforceLifecycleResult(undefined, s.actions);
  assert.deepEqual(s.calls.setError, [null]);
  assert.equal(s.calls.refresh, 1);
});

test("R2DB-H3. each stale-state code -> shows inline error AND refreshes exactly once", () => {
  for (const code of ["MEMBER_NOT_FOUND", "OWNER_PROTECTED", "ADMIN_TIER_PROTECTED", "STATUS_UNCHANGED", "INVALID_STATUS_TRANSITION", "MEMBER_STATE_CHANGED"]) {
    const s = spies();
    applyWorkforceLifecycleResult({ error: code }, s.actions);
    assert.deepEqual(s.calls.setError, [code]);
    assert.equal(s.calls.refresh, 1, `${code} must refresh the stale row`);
  }
});

test("R2DB-H4. INVALID_TARGET -> inline error only, no refresh", () => {
  const s = spies();
  applyWorkforceLifecycleResult({ error: "INVALID_TARGET" }, s.actions);
  assert.deepEqual(s.calls.setError, ["INVALID_TARGET"]);
  assert.equal(s.calls.refresh, 0);
});

test("R2DB-H5. SELF_LIFECYCLE_NOT_ALLOWED -> inline error only, no refresh (defensive; self row is not rendered)", () => {
  const s = spies();
  applyWorkforceLifecycleResult({ error: "SELF_LIFECYCLE_NOT_ALLOWED" }, s.actions);
  assert.deepEqual(s.calls.setError, ["SELF_LIFECYCLE_NOT_ALLOWED"]);
  assert.equal(s.calls.refresh, 0);
});
