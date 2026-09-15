// components/workforce/add-workforce-member-form.test.mjs — OWNER-UI-4A
// "add workforce member" dialog, extended by WORKFORCE INVITATION V1 with a
// second, clearly separated "invite by email" tab.
//
// This repo has no act()-capable React harness (see
// components/app-sidebar-nav.test.mjs). So:
//   - static markup for EACH tab (options, labels, disabled empty-state,
//     cap hint, the absence of OWNER / of any workspace input) is asserted
//     via renderToStaticMarkup, deterministically selecting the tab via the
//     `initialTab` prop (a real tab click cannot be simulated here — see
//     that prop's own doc comment on the component);
//   - the post-submit branching for BOTH tabs (success closes + refreshes;
//     a "stale, refresh but keep open" code; other codes show inline only)
//     and both error-code -> localized-copy mappings are asserted directly
//     against the exported pure helpers.
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
    inviteWorkforceMemberFromForm: async () => undefined,
  },
});

const {
  AddWorkforceMemberForm,
  WORKFORCE_ROLE_OPTIONS,
  workforceAddErrorMessage,
  applyWorkforceAddResult,
  workforceInviteErrorMessage,
  applyWorkforceInviteResult,
} = await import("./add-workforce-member-form.tsx");
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

// -------------------------------- shared chrome --------------------------------

test("4A-F0. trigger button is never disabled — invite-by-email always works, regardless of eligible-user count", () => {
  assert.doesNotMatch(html({ assignableUsers: [] }), /<button[^>]*\bdisabled=""[^>]*>[^<]*Ajouter un membre/);
  assert.doesNotMatch(html({ assignableUsers: USERS }), /<button[^>]*\bdisabled=""[^>]*>[^<]*Ajouter un membre/);
});

test("4A-F0b. both tabs are always rendered as separate, clearly labelled tab buttons", () => {
  const out = html({ assignableUsers: USERS });
  assert.ok(out.includes('role="tab"'));
  assert.ok(out.includes(tFr.tabInviteEmail) && out.includes(tFr.tabExistingUser));
});

test("4A-F0c. the two tabs never mix fields — the active tab's <form> carries exactly its own fields", () => {
  const invite = html({ assignableUsers: USERS, initialTab: "invite" });
  assert.ok(invite.includes('name="email"') && !invite.includes('name="userId"'), "invite tab has no userId select");
  const existing = html({ assignableUsers: USERS, initialTab: "existing" });
  assert.ok(existing.includes('name="userId"') && !existing.includes('name="email"'), "existing tab has no email input");
});

// -------------------------------- invite-by-email tab --------------------------------

test("4A-I1. invite tab: email input + role select, no free-text userId, no workspace/org/actor field", () => {
  const out = html({ assignableUsers: USERS, initialTab: "invite" });
  assert.ok(out.includes('name="email"') && out.includes('type="email"'));
  assert.ok(out.includes('name="role"'));
  assert.ok(out.includes('value="ADMIN"') && out.includes('value="MANAGER"') && out.includes('value="EMPLOYEE"'));
  assert.ok(!out.includes("OWNER"), "no OWNER option / string anywhere in the dialog");
  for (const forbidden of ['name="workspace"', 'name="workspaceOrgId"', 'name="org"', 'name="organizationId"', 'name="actor"', 'name="userId"']) {
    assert.ok(!out.includes(forbidden), `must not render ${forbidden}`);
  }
});

test("4A-I2. invite tab: no error alert on the initial (un-submitted) render", () => {
  assert.ok(!html({ assignableUsers: USERS, initialTab: "invite" }).includes('role="alert"'));
});

test("4A-I3. invite tab: submit shows the non-pending label; description copy renders", () => {
  const out = html({ assignableUsers: USERS, initialTab: "invite" });
  assert.ok(out.includes(tFr.inviteSubmitButton) && !out.includes(tFr.inviteSubmitting));
  assert.ok(out.includes(tFr.inviteDescription));
});

test("4A-I4. invite tab renders regardless of assignableUsers being empty", () => {
  const out = html({ assignableUsers: [], initialTab: "invite" });
  assert.ok(out.includes('name="email"'));
  assert.ok(!out.includes(tFr.errorNoEligibleUsers), "the existing-user empty-state message belongs to the other tab only");
});

test("4A-I5. EN locale renders the English invite-tab copy", () => {
  const out = html({ assignableUsers: USERS, locale: "en", initialTab: "invite" });
  assert.ok(out.includes(tEn.tabInviteEmail) && out.includes(tEn.inviteSubmitButton) && out.includes(tEn.inviteDescription));
  assert.ok(!out.includes("OWNER"));
});

// -------------------------------- existing-user tab --------------------------------

test("4A-F1. role options are exactly ADMIN / MANAGER / EMPLOYEE — OWNER never appears", () => {
  assert.deepEqual([...WORKFORCE_ROLE_OPTIONS], ["ADMIN", "MANAGER", "EMPLOYEE"]);
  const out = html({ assignableUsers: USERS, initialTab: "existing" });
  assert.ok(out.includes('value="ADMIN"') && out.includes('value="MANAGER"') && out.includes('value="EMPLOYEE"'));
  assert.ok(out.includes(tFr.roleAdmin) && out.includes(tFr.roleManager) && out.includes(tFr.roleEmployee));
  assert.ok(!out.includes("OWNER"), "no OWNER option / string anywhere in the dialog");
});

test("4A-F2. user options use users.id as the value and users.email as the label, plus a disabled placeholder", () => {
  const out = html({ assignableUsers: USERS, initialTab: "existing" });
  assert.ok(out.includes('value="11111111-1111-4111-8111-111111111111"'));
  assert.ok(out.includes("alice@example.com") && out.includes("bob@example.com"));
  assert.ok(out.includes(tFr.selectUserPlaceholder));
  assert.ok(out.includes('<option value="" disabled=""'), "empty placeholder option is disabled");
  assert.ok(!/name="userId"[^>]*type="text"/.test(out) && !out.includes('type="text"'), "no free-text userId input");
});

test("4A-F3. the existing-user form carries only userId + role fields — no workspace / org / actor input", () => {
  const out = html({ assignableUsers: USERS, initialTab: "existing" });
  assert.ok(out.includes('name="userId"') && out.includes('name="role"'));
  for (const forbidden of ['name="workspace"', 'name="workspaceOrgId"', 'name="org"', 'name="organizationId"', 'name="actor"', 'name="role_id"']) {
    assert.ok(!out.includes(forbidden), `must not render ${forbidden}`);
  }
});

test("4A-F4. no error alert is rendered on the initial (un-submitted) dialog", () => {
  assert.ok(!html({ assignableUsers: USERS, initialTab: "existing" }).includes('role="alert"'));
});

test("4A-F5. accessibility wiring: labelled dialog, label/for on both selects, submit shows the non-pending label", () => {
  const out = html({ assignableUsers: USERS, initialTab: "existing" });
  assert.ok(out.includes('aria-labelledby="add-workforce-member-title"'));
  assert.ok(out.includes('id="add-workforce-member-title"'));
  assert.ok(out.includes('for="workforce-user"') && out.includes('id="workforce-user"'));
  assert.ok(out.includes('for="workforce-role"') && out.includes('id="workforce-role"'));
  assert.ok(out.includes(tFr.submitButton) && !out.includes(tFr.submitting), "idle render shows submit label, not the pending label");
  assert.ok(out.includes(tFr.addMemberTitle) && out.includes(tFr.addMemberDescription));
});

test("4A-F6. hasMore=true renders the 'first 50 shown' hint; hasMore=false does not", () => {
  assert.ok(html({ assignableUsers: USERS, hasMore: true, initialTab: "existing" }).includes(tFr.eligibleUsersLimited));
  assert.ok(!html({ assignableUsers: USERS, hasMore: false, initialTab: "existing" }).includes(tFr.eligibleUsersLimited));
});

test("4A-F7. no eligible users -> existing-user select is disabled and the localized explanation is shown; no user options; submit disabled", () => {
  const out = html({ assignableUsers: [], initialTab: "existing" });
  assert.match(out, /<select[^>]*id="workforce-user"[^>]*\bdisabled=""/);
  assert.ok(out.includes(tFr.errorNoEligibleUsers));
  assert.ok(!out.includes("@example.com"), "no user <option> rows when the list is empty");
  assert.match(out, /<button[^>]*type="submit"[^>]*\bdisabled=""/);
});

test("4A-F8. existing-user select is NOT disabled when eligible users exist", () => {
  const out = html({ assignableUsers: USERS, initialTab: "existing" });
  assert.doesNotMatch(out, /<select[^>]*id="workforce-user"[^>]*\bdisabled=""/);
});

test("4A-F9. EN locale renders the English dialog copy and role labels", () => {
  const out = html({ assignableUsers: USERS, locale: "en", initialTab: "existing" });
  assert.ok(out.includes(tEn.addMemberButton) && out.includes(tEn.addMemberTitle));
  assert.ok(out.includes(tEn.roleAdmin) && out.includes(tEn.roleManager) && out.includes(tEn.roleEmployee));
  assert.ok(!out.includes("OWNER"));
});

// ---------------------------- pure branching helpers: existing-user tab ----------------------------

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

// ---------------------------- pure branching helpers: invite-by-email tab ----------------------------

test("4A-I6. workforceInviteErrorMessage maps every code to localized copy, and null -> null", () => {
  assert.equal(workforceInviteErrorMessage("INVALID_EMAIL", tFr), tFr.inviteErrorInvalidEmail);
  assert.equal(workforceInviteErrorMessage("INVALID_ROLE", tFr), tFr.inviteErrorInvalidRole);
  assert.equal(workforceInviteErrorMessage("SELF_INVITE_NOT_ALLOWED", tFr), tFr.inviteErrorSelfInvite);
  assert.equal(workforceInviteErrorMessage("OWNER_TARGET", tFr), tFr.inviteErrorOwnerTarget);
  assert.equal(workforceInviteErrorMessage("ALREADY_WORKFORCE_MEMBER", tFr), tFr.inviteErrorAlreadyMember);
  assert.equal(workforceInviteErrorMessage("INVITATION_ALREADY_PENDING", tFr), tFr.inviteErrorAlreadyPending);
  assert.equal(workforceInviteErrorMessage("GENERIC", tFr), tFr.inviteErrorGeneric);
  assert.equal(workforceInviteErrorMessage(null, tFr), null);
});

test("4A-I7. success (undefined) -> clears error, closes the dialog, refreshes", () => {
  const s = spies();
  applyWorkforceInviteResult(undefined, s.actions);
  assert.deepEqual(s.calls.setError, [null]);
  assert.equal(s.calls.close, 1);
  assert.equal(s.calls.refresh, 1);
});

test("4A-I8. INVITATION_ALREADY_PENDING -> shows inline error AND refreshes, but does NOT close the dialog", () => {
  const s = spies();
  applyWorkforceInviteResult({ error: "INVITATION_ALREADY_PENDING" }, s.actions);
  assert.deepEqual(s.calls.setError, ["INVITATION_ALREADY_PENDING"]);
  assert.equal(s.calls.refresh, 1);
  assert.equal(s.calls.close, 0);
});

test("4A-I9. every other invite error code -> inline error only, no close, no refresh", () => {
  for (const code of ["INVALID_EMAIL", "INVALID_ROLE", "SELF_INVITE_NOT_ALLOWED", "OWNER_TARGET", "ALREADY_WORKFORCE_MEMBER"]) {
    const s = spies();
    applyWorkforceInviteResult({ error: code }, s.actions);
    assert.deepEqual(s.calls.setError, [code]);
    assert.equal(s.calls.close, 0);
    assert.equal(s.calls.refresh, 0);
  }
});
