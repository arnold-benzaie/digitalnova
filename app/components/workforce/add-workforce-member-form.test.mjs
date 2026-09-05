// components/workforce/add-workforce-member-form.test.mjs — OWNER-UI-4A
// "add workforce member" dialog.
//
// This repo has no act()-capable React harness (see
// components/app-sidebar-nav.test.mjs). So:
//   - static markup (options, labels, disabled empty-state, cap hint, the
//     absence of OWNER / of any workspace input) is asserted via
//     renderToStaticMarkup — the same approach as
//     lib/quote-verification.test.mjs;
//   - the post-submit branching (success closes + refreshes; DUPLICATE
//     shows inline AND refreshes but stays open; other codes show inline
//     only) and the error-code -> localized-copy mapping are asserted
//     directly against the exported pure helpers applyWorkforceAddResult()
//     / workforceAddErrorMessage().
//
// Run with: npx tsx --test --experimental-test-module-mocks components/workforce/add-workforce-member-form.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ refresh: () => {} }),
    unstable_rethrow: () => {},
  },
});
mock.module("@/lib/actions/workforce-ui", {
  namedExports: {
    // Never invoked by a static render; present only so the value import resolves.
    addWorkforceMemberFromForm: async () => undefined,
  },
});

const { AddWorkforceMemberForm, WORKFORCE_ROLE_OPTIONS, workforceAddErrorMessage, applyWorkforceAddResult } = await import(
  "./add-workforce-member-form.tsx"
);
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.workforce;
const tEn = dictionaries.en.workforce;

const USERS = [
  { id: "11111111-1111-4111-8111-111111111111", email: "alice@example.com" },
  { id: "22222222-2222-4222-8222-222222222222", email: "bob@example.com" },
];

// React escapes ' " & < > in text nodes — undo that so assertions can use
// the plain dictionary strings (several FR strings contain an apostrophe).
const decodeEntities = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function html(props) {
  return decodeEntities(renderToStaticMarkup(React.createElement(AddWorkforceMemberForm, { hasMore: false, locale: "fr", ...props })));
}

// -------------------------------- static markup --------------------------------

test("4A-F1. role options are exactly ADMIN / MANAGER / EMPLOYEE — OWNER never appears", () => {
  assert.deepEqual([...WORKFORCE_ROLE_OPTIONS], ["ADMIN", "MANAGER", "EMPLOYEE"]);
  const out = html({ assignableUsers: USERS });
  assert.ok(out.includes('value="ADMIN"') && out.includes('value="MANAGER"') && out.includes('value="EMPLOYEE"'));
  assert.ok(out.includes(tFr.roleAdmin) && out.includes(tFr.roleManager) && out.includes(tFr.roleEmployee));
  assert.ok(!out.includes("OWNER"), "no OWNER option / string anywhere in the dialog");
});

test("4A-F2. user options use users.id as the value and users.email as the label, plus a disabled placeholder", () => {
  const out = html({ assignableUsers: USERS });
  assert.ok(out.includes('value="11111111-1111-4111-8111-111111111111"'));
  assert.ok(out.includes("alice@example.com") && out.includes("bob@example.com"));
  assert.ok(out.includes(tFr.selectUserPlaceholder));
  assert.ok(out.includes('<option value="" disabled=""'), "empty placeholder option is disabled");
  assert.ok(!/name="userId"[^>]*type="text"/.test(out) && !out.includes('type="text"'), "no free-text userId input");
});

test("4A-F3. the form carries only userId + role fields — no workspace / org / actor input", () => {
  const out = html({ assignableUsers: USERS });
  assert.ok(out.includes('name="userId"') && out.includes('name="role"'));
  for (const forbidden of ['name="workspace"', 'name="workspaceOrgId"', 'name="org"', 'name="organizationId"', 'name="actor"', 'name="role_id"']) {
    assert.ok(!out.includes(forbidden), `must not render ${forbidden}`);
  }
});

test("4A-F4. no error alert is rendered on the initial (un-submitted) dialog", () => {
  assert.ok(!html({ assignableUsers: USERS }).includes('role="alert"'));
});

test("4A-F5. accessibility wiring: labelled dialog, label/for on both selects, submit shows the non-pending label", () => {
  const out = html({ assignableUsers: USERS });
  assert.ok(out.includes('aria-labelledby="add-workforce-member-title"'));
  assert.ok(out.includes('id="add-workforce-member-title"'));
  assert.ok(out.includes('for="workforce-user"') && out.includes('id="workforce-user"'));
  assert.ok(out.includes('for="workforce-role"') && out.includes('id="workforce-role"'));
  assert.ok(out.includes(tFr.submitButton) && !out.includes(tFr.submitting), "idle render shows submit label, not the pending label");
  assert.ok(out.includes(tFr.addMemberTitle) && out.includes(tFr.addMemberDescription));
});

test("4A-F6. hasMore=true renders the 'first 50 shown' hint; hasMore=false does not", () => {
  assert.ok(html({ assignableUsers: USERS, hasMore: true }).includes(tFr.eligibleUsersLimited));
  assert.ok(!html({ assignableUsers: USERS, hasMore: false }).includes(tFr.eligibleUsersLimited));
});

test("4A-F7. no eligible users -> trigger button is disabled and the localized explanation is shown; no user options", () => {
  const out = html({ assignableUsers: [] });
  assert.match(out, /<button[^>]*\bdisabled=""[^>]*>[^<]*Ajouter un membre/);
  assert.ok(out.includes(tFr.errorNoEligibleUsers));
  assert.ok(!out.includes("@example.com"), "no user <option> rows when the list is empty");
});

test("4A-F8. trigger button is NOT disabled when eligible users exist", () => {
  const out = html({ assignableUsers: USERS });
  assert.doesNotMatch(out, /<button[^>]*\bdisabled=""[^>]*>[^<]*Ajouter un membre/);
});

test("4A-F9. EN locale renders the English dialog copy and role labels", () => {
  const out = html({ assignableUsers: USERS, locale: "en" });
  assert.ok(out.includes(tEn.addMemberButton) && out.includes(tEn.addMemberTitle));
  assert.ok(out.includes(tEn.roleAdmin) && out.includes(tEn.roleManager) && out.includes(tEn.roleEmployee));
  assert.ok(!out.includes("OWNER"));
});

// ---------------------------- pure branching helpers ----------------------------

test("4A-H1. workforceAddErrorMessage maps every code to localized copy, and null -> null", () => {
  assert.equal(workforceAddErrorMessage("DUPLICATE", tFr), tFr.errorDuplicate);
  assert.equal(workforceAddErrorMessage("INVALID_USER", tFr), tFr.errorInvalidUser);
  assert.equal(workforceAddErrorMessage("INVALID_ROLE", tFr), tFr.errorInvalidRole);
  assert.equal(workforceAddErrorMessage("GENERIC", tFr), tFr.errorGeneric);
  assert.equal(workforceAddErrorMessage(null, tFr), null);
});

function spies() {
  const calls = { setError: [], close: 0, refresh: 0 };
  return {
    calls,
    actions: {
      setError: (e) => calls.setError.push(e),
      close: () => (calls.close += 1),
      refresh: () => (calls.refresh += 1),
    },
  };
}

test("4A-H2. success (undefined) -> clears error, closes the dialog, refreshes", () => {
  const s = spies();
  applyWorkforceAddResult(undefined, s.actions);
  assert.deepEqual(s.calls.setError, [null]);
  assert.equal(s.calls.close, 1);
  assert.equal(s.calls.refresh, 1);
});

test("4A-H3. DUPLICATE -> shows inline error AND refreshes, but does NOT close the dialog", () => {
  const s = spies();
  applyWorkforceAddResult({ error: "DUPLICATE" }, s.actions);
  assert.deepEqual(s.calls.setError, ["DUPLICATE"]);
  assert.equal(s.calls.refresh, 1, "stale picker is refreshed after a concurrent add");
  assert.equal(s.calls.close, 0, "dialog stays open on duplicate");
});

test("4A-H4. INVALID_USER / INVALID_ROLE -> inline error only, no close, no refresh", () => {
  for (const code of ["INVALID_USER", "INVALID_ROLE"]) {
    const s = spies();
    applyWorkforceAddResult({ error: code }, s.actions);
    assert.deepEqual(s.calls.setError, [code]);
    assert.equal(s.calls.close, 0);
    assert.equal(s.calls.refresh, 0);
  }
});
