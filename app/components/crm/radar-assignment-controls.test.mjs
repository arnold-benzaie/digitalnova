// components/crm/radar-assignment-controls.test.mjs — PHASE RADAR-CORE-1B
// per-row prospect-assignment controls for the /admin/crm/radar queue.
//
// Same approach as components/workforce/workforce-lifecycle-actions.test.mjs
// (this repo has no act()-capable React harness):
//   - visible markup (which affordances render for each caps / assignment
//     state, absence of any raw UUID / role / workspace, FR/EN labels,
//     inactive suffix) is asserted via renderToStaticMarkup;
//   - the code -> localized-copy mapping and the post-result branching are
//     asserted directly against the exported pure helpers
//     radarAssignmentErrorMessage() / applyRadarAssignmentResult().
//
// NOT wired into package.json's `test` list — run with:
//   npx tsx --test --experimental-test-module-mocks components/crm/radar-assignment-controls.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});
mock.module("@/lib/actions/radar-assignment", {
  namedExports: {
    // Never invoked by a static render; present so the value imports resolve.
    claimProspect: async () => undefined,
    assignProspect: async () => undefined,
    unassignProspect: async () => undefined,
  },
});
mock.module("@/components/gbp-audit/ui/use-confirm-dialog", {
  namedExports: { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
});

const { RadarAssignmentControls, radarAssignmentErrorMessage, applyRadarAssignmentResult } = await import(
  "./radar-assignment-controls.tsx"
);
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.crm.radar.assignment;
const tEn = dictionaries.en.crm.radar.assignment;

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ALL_CAPS = { canClaimToSelf: true, canAssignOthers: true, canReleaseOwn: true };
const EMPLOYEE_CAPS = { canClaimToSelf: true, canAssignOthers: false, canReleaseOwn: true };
const OWNER_CAPS = { canClaimToSelf: false, canAssignOthers: true, canReleaseOwn: true };
const NO_CAPS = { canClaimToSelf: false, canAssignOthers: false, canReleaseOwn: false };

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
      React.createElement(RadarAssignmentControls, {
        clientId: CLIENT,
        assignedUserId: null,
        assignedUserName: null,
        assignedUserActive: false,
        currentUserId: ME,
        caps: ALL_CAPS,
        assignables: [
          { userId: OTHER, displayName: "Max Manager" },
          { userId: "b0000000-0000-4000-8000-000000000001", displayName: "Eve Employee" },
        ],
        locale: "fr",
        t: tFr,
        ...props,
      }),
    ),
  );
}

// -------------------------------- visible controls --------------------------------

test("R1B-C1. unassigned + canClaimToSelf -> Claim button rendered", () => {
  const out = html({ assignedUserId: null, caps: ALL_CAPS });
  assert.ok(out.includes(tFr.claim));
});

test("R1B-C2. unassigned + OWNER-like caps (canClaimToSelf:false) -> NO Claim button, assignee select still present", () => {
  const out = html({ assignedUserId: null, caps: OWNER_CAPS });
  assert.ok(!out.includes(`>${tFr.claim}<`), "no Claim button for a caller who cannot claim to self");
  assert.ok(out.includes("<select"), "canAssignOthers still yields the assignee select");
});

test("R1B-C3. unassigned + canAssignOthers -> assignee <select> with the roster options", () => {
  const out = html({ assignedUserId: null, caps: ALL_CAPS });
  assert.ok(out.includes("<select"));
  assert.ok(out.includes("Max Manager") && out.includes("Eve Employee"));
});

test("R1B-C4. unassigned + EMPLOYEE-like caps (canAssignOthers:false) -> Claim only, no <select>", () => {
  const out = html({ assignedUserId: null, caps: EMPLOYEE_CAPS });
  assert.ok(out.includes(tFr.claim));
  assert.ok(!out.includes("<select"), "an employee who cannot assign others sees no picker");
});

test("R1B-C5. assigned to me + canReleaseOwn -> Release button; owner label shown", () => {
  const out = html({ assignedUserId: ME, assignedUserName: "My Name", assignedUserActive: true, caps: ALL_CAPS });
  assert.ok(out.includes(tFr.release));
  assert.ok(out.includes("My Name"));
});

test("R1B-C6. assigned to someone else, no caps -> label only, no buttons/select", () => {
  const out = html({ assignedUserId: OTHER, assignedUserName: "Other Person", assignedUserActive: true, caps: NO_CAPS });
  assert.ok(out.includes("Other Person"));
  assert.ok(!out.includes("<button"), "no action button");
  assert.ok(!out.includes("<select"), "no assignee picker");
});

test("R1B-C7. assigned to someone else + canAssignOthers -> reassign <select> AND Release button", () => {
  const out = html({ assignedUserId: OTHER, assignedUserName: "Other Person", assignedUserActive: true, caps: ALL_CAPS });
  assert.ok(out.includes("<select"));
  assert.ok(out.includes(tFr.release));
});

test("R1B-C8. inactive foreign assignment -> inactive suffix is appended to the owner label", () => {
  const out = html({ assignedUserId: OTHER, assignedUserName: "Stale Owner", assignedUserActive: false, caps: ALL_CAPS });
  assert.ok(out.includes(tFr.assigneeInactiveSuffix));
});

test("R1B-C9. assigned but name unresolved -> generic 'assigned' label, never the raw UUID", () => {
  const STRANGER = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // not in the assignables roster
  const out = html({ assignedUserId: STRANGER, assignedUserName: null, assignedUserActive: true, caps: ALL_CAPS });
  assert.ok(out.includes(tFr.assignedUnknown));
  assert.ok(!out.includes(STRANGER), "the assigned user id must never appear in the markup");
});

test("R1B-C10. no raw ids (clientId, currentUserId) and no role/workspace strings rendered", () => {
  const out = html({ assignedUserId: ME, assignedUserName: "My Name", caps: ALL_CAPS });
  assert.ok(!out.includes(CLIENT) && !out.includes(ME));
  for (const forbidden of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE", "workspace", "organizationId", "actor", "staffMemberId"]) {
    assert.ok(!out.includes(forbidden), `must not render "${forbidden}"`);
  }
});

test("R1B-C11. unassigned + NO_CAPS -> the localized 'Unassigned' label IS rendered, and no button/select", () => {
  const out = html({ assignedUserId: null, caps: NO_CAPS });
  assert.ok(out.includes(tFr.unassigned), "an unassigned row must show the localized Unassigned label, never a blank cell");
  assert.ok(!out.includes("<button"), "no mutation button for a no-capability viewer");
  assert.ok(!out.includes("<select"), "no assignee picker for a no-capability viewer");
});

test("R1B-C11b. unassigned + NO_CAPS -> 'Unassigned' label in EN too; no raw id, no role/workspace strings", () => {
  const out = html({ assignedUserId: null, caps: NO_CAPS, locale: "en", t: tEn });
  assert.ok(out.includes(tEn.unassigned));
  assert.ok(!out.includes(tFr.unassigned), "no FR label leaks into the EN render");
  assert.ok(!out.includes(CLIENT));
  for (const forbidden of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE", "workspace", "organizationId", "actor"]) {
    assert.ok(!out.includes(forbidden), `must not render "${forbidden}"`);
  }
});

test("R1B-C11c. unassigned + EMPLOYEE-like caps -> 'Unassigned' label AND Claim, still no picker", () => {
  const out = html({ assignedUserId: null, caps: EMPLOYEE_CAPS });
  assert.ok(out.includes(tFr.unassigned));
  assert.ok(out.includes(tFr.claim));
  assert.ok(!out.includes("<select"));
});

test("R1B-C12. FR vs EN labels — no locale leak", () => {
  const fr = html({ assignedUserId: null, caps: ALL_CAPS, locale: "fr", t: tFr });
  assert.ok(fr.includes(tFr.claim));
  const en = html({ assignedUserId: null, caps: ALL_CAPS, locale: "en", t: tEn });
  assert.ok(en.includes(tEn.claim));
  assert.ok(!en.includes(tFr.claim), "no FR label leaks into the EN render");
});

test("R1B-C13. idle render: real <button type=\"button\">, no disabled attribute, no role=\"alert\"", () => {
  const out = html({ assignedUserId: null, caps: ALL_CAPS });
  assert.ok(out.includes('type="button"'));
  assert.ok(!out.includes('disabled=""'), "idle render must not set the disabled attribute");
  assert.ok(!out.includes('role="alert"'), "no error region on the un-acted render");
});

// ---------------------------- pure helpers ----------------------------

const ALL_CODES = [
  "INVALID_CLIENT",
  "PROSPECT_NOT_FOUND",
  "INVALID_ASSIGNEE",
  "ASSIGNEE_NOT_ELIGIBLE",
  "ALREADY_ASSIGNED",
  "ASSIGNMENT_UNCHANGED",
  "NOT_ALLOWED_TO_ASSIGN",
  "ASSIGNMENT_CHANGED_RETRY",
];

test("R1B-H1. radarAssignmentErrorMessage maps every one of the 8 codes to localized copy (FR + EN); null / unknown -> null", () => {
  const expectFr = {
    INVALID_CLIENT: tFr.errInvalidClient,
    PROSPECT_NOT_FOUND: tFr.errProspectNotFound,
    INVALID_ASSIGNEE: tFr.errInvalidAssignee,
    ASSIGNEE_NOT_ELIGIBLE: tFr.errAssigneeNotEligible,
    ALREADY_ASSIGNED: tFr.errAlreadyAssigned,
    ASSIGNMENT_UNCHANGED: tFr.errAssignmentUnchanged,
    NOT_ALLOWED_TO_ASSIGN: tFr.errNotAllowedToAssign,
    ASSIGNMENT_CHANGED_RETRY: tFr.errAssignmentChangedRetry,
  };
  for (const code of ALL_CODES) {
    assert.equal(radarAssignmentErrorMessage(code, tFr), expectFr[code]);
    assert.equal(typeof radarAssignmentErrorMessage(code, tEn), "string");
    assert.notEqual(radarAssignmentErrorMessage(code, tEn), "");
  }
  assert.equal(radarAssignmentErrorMessage(null, tFr), null);
  assert.equal(radarAssignmentErrorMessage(undefined, tFr), null);
  assert.equal(radarAssignmentErrorMessage("SOMETHING_ELSE", tFr), null);
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

test("R1B-H2. success (undefined) -> clears error, refreshes exactly once", () => {
  const s = spies();
  applyRadarAssignmentResult(undefined, s.actions);
  assert.deepEqual(s.calls.setError, [null]);
  assert.equal(s.calls.refresh, 1);
});

test("R1B-H3. stale-state codes -> inline error AND one refresh", () => {
  for (const code of ["ALREADY_ASSIGNED", "ASSIGNMENT_CHANGED_RETRY", "PROSPECT_NOT_FOUND"]) {
    const s = spies();
    applyRadarAssignmentResult({ error: code }, s.actions);
    assert.deepEqual(s.calls.setError, [code]);
    assert.equal(s.calls.refresh, 1, `${code} must refresh the stale row`);
  }
});

test("R1B-H4. ASSIGNMENT_UNCHANGED -> silent no-op: clears error, NO refresh, no error shown", () => {
  const s = spies();
  applyRadarAssignmentResult({ error: "ASSIGNMENT_UNCHANGED" }, s.actions);
  assert.deepEqual(s.calls.setError, [null]);
  assert.equal(s.calls.refresh, 0);
});

test("R1B-H5. authoritative-but-not-stale codes -> inline error only, no refresh", () => {
  for (const code of ["ASSIGNEE_NOT_ELIGIBLE", "INVALID_ASSIGNEE", "NOT_ALLOWED_TO_ASSIGN", "INVALID_CLIENT"]) {
    const s = spies();
    applyRadarAssignmentResult({ error: code }, s.actions);
    assert.deepEqual(s.calls.setError, [code]);
    assert.equal(s.calls.refresh, 0, `${code} must not refresh`);
  }
});
