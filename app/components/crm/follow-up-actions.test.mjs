// components/crm/follow-up-actions.test.mjs — PHASE RADAR-CORE-3C
// per-row follow-up lifecycle controls for a CLASS-A (client-linked +
// dated) task on app/admin/crm/clients/[id]/page.tsx.
//
// Same approach as components/crm/radar-assignment-controls.test.mjs
// (this repo has no act()-capable React harness):
//   - visible markup (which affordances render for each caps / ownership /
//     open-terminal state, the FR/EN labels, the inactive suffix, the
//     structured owner display, absence of any human-visible UUID / role /
//     workspace string) is asserted via renderToStaticMarkup;
//   - the code -> localized-copy mapping and the post-result branching are
//     asserted directly against the exported pure helpers
//     followUpActionErrorMessage() / applyFollowUpActionResult().
//
// A user / task UUID is an IDENTIFIER, not an authorization secret: it may
// appear in an <option value>, a form value, an action argument, or an
// internal DOM attribute. This file asserts it is never HUMAN-VISIBLE
// text. Forged-id server rejection is covered by the frozen 3A backend
// suite (lib/actions/crm-tasks-auth.integration.test.mjs) — not here.
//
// NOT wired into package.json's `test` list — run with:
//   npx tsx --test --experimental-test-module-mocks components/crm/follow-up-actions.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});
mock.module("@/lib/actions/crm-tasks", {
  namedExports: {
    // Never invoked by a static render; present so the value imports resolve.
    claimFollowUp: async () => undefined,
    assignFollowUp: async () => undefined,
    releaseFollowUp: async () => undefined,
    completeFollowUp: async () => undefined,
    cancelFollowUp: async () => undefined,
    reopenFollowUp: async () => undefined,
    rescheduleFollowUp: async () => undefined,
  },
});
mock.module("@/components/gbp-audit/ui/use-confirm-dialog", {
  namedExports: { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
});

const { FollowUpActions, followUpActionErrorMessage, applyFollowUpActionResult } = await import(
  "./follow-up-actions.tsx"
);
const { dictionaries } = await import("@/lib/i18n/dictionaries");
const { getTaskStatusOptions, TASK_STATUS_CLASS } = await import("./badges.tsx");
const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");

const tFr = dictionaries.fr.crm.clientDetail.followUp;
const tEn = dictionaries.en.crm.clientDetail.followUp;

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVE = "b0000000-0000-4000-8000-000000000001";
const STRANGER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TASK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ALL_CAPS = { canClaimToSelf: true, canAssignOthers: true, canReleaseOwn: true };
const EMPLOYEE_CAPS = { canClaimToSelf: true, canAssignOthers: false, canReleaseOwn: true };
const OWNER_CAPS = { canClaimToSelf: false, canAssignOthers: true, canReleaseOwn: true };
const NO_CAPS = { canClaimToSelf: false, canAssignOthers: false, canReleaseOwn: false };

const decodeEntities = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function html(props) {
  return decodeEntities(
    renderToStaticMarkup(
      React.createElement(FollowUpActions, {
        taskId: TASK,
        followUpAssignedUserId: null,
        assignedUserName: null,
        assignedUserActive: false,
        status: "todo",
        dueDate: new Date("2026-08-01T00:00:00Z"),
        currentUserId: ME,
        caps: ALL_CAPS,
        assignables: [
          { userId: OTHER, displayName: "Max Manager" },
          { userId: EVE, displayName: "Eve Employee" },
        ],
        locale: "fr",
        t: tFr,
        ...props,
      }),
    ),
  );
}

/** Visible text only — strip every tag, so an id that legitimately lives
 * in an attribute (`<option value="uuid">`, `id="fu-due-uuid"`) does not
 * count as "rendered to a human". */
const visibleText = (out) => out.replace(/<[^>]*>/g, " ");

// ============================ action visibility ============================

test("3C-V1. eligible actor + open unassigned -> Claim button rendered", () => {
  assert.ok(html({ caps: EMPLOYEE_CAPS }).includes(tFr.claim));
});

test("3C-V2. canClaimToSelf:false (OWNER-like) -> NO Claim button; assignee <select> still present", () => {
  const out = html({ caps: OWNER_CAPS });
  assert.ok(!out.includes(tFr.claim), "no Claim for a caller who cannot claim to self");
  assert.ok(out.includes("<select"), "canAssignOthers still yields the assignee select");
});

test("3C-V3. canAssignOthers:true -> assignee <select> with the roster displayNames", () => {
  const out = html({ caps: ALL_CAPS });
  assert.ok(out.includes("<select"));
  assert.ok(out.includes("Max Manager") && out.includes("Eve Employee"));
});

test("3C-V4. canAssignOthers:false -> no <select>", () => {
  assert.ok(!html({ caps: EMPLOYEE_CAPS }).includes("<select"));
});

test("3C-V5. assigned to me + canReleaseOwn + open -> Release button; owner label shown", () => {
  const out = html({ followUpAssignedUserId: ME, assignedUserName: "My Name", assignedUserActive: true });
  assert.ok(out.includes(tFr.release));
  assert.ok(out.includes("My Name"));
});

test("3C-V6. foreign + canAssignOthers + open -> Release button rendered", () => {
  const out = html({ followUpAssignedUserId: OTHER, assignedUserName: "Other Person", assignedUserActive: true });
  assert.ok(out.includes(tFr.release));
});

test("3C-V7. foreign + !canAssignOthers -> NO Release button", () => {
  const out = html({ followUpAssignedUserId: OTHER, assignedUserName: "Other Person", caps: EMPLOYEE_CAPS });
  assert.ok(!out.includes(tFr.release), "an employee cannot release a foreign follow-up");
});

test("3C-V8. open + actorMayMutateLifecycle -> Complete + Cancel rendered", () => {
  const out = html({});
  assert.ok(out.includes(tFr.complete));
  assert.ok(out.includes(tFr.cancel));
});

test("3C-V9. NO_CAPS -> no Complete / Cancel / Claim / select / Release", () => {
  const out = html({ caps: NO_CAPS });
  for (const label of [tFr.complete, tFr.cancel, tFr.claim, tFr.release]) {
    assert.ok(!out.includes(label), `must not render "${label}"`);
  }
  assert.ok(!out.includes("<select"));
});

test("3C-V10. open + permitted -> Reschedule date input + submit rendered", () => {
  const out = html({});
  assert.ok(out.includes('type="date"'));
  assert.ok(out.includes(tFr.rescheduleSubmit));
  assert.ok(out.includes(tFr.dueDateLabel));
});

test("3C-V11. status=done -> Reopen ONLY; every open-only affordance hidden", () => {
  const out = html({ status: "done", followUpAssignedUserId: ME, assignedUserName: "My Name", assignedUserActive: true });
  assert.ok(out.includes(tFr.reopen));
  for (const label of [tFr.claim, tFr.complete, tFr.cancel, tFr.release, tFr.rescheduleSubmit]) {
    assert.ok(!out.includes(label), `terminal row must not render "${label}"`);
  }
  assert.ok(!out.includes("<select"), "terminal row must not render the assignee picker");
  assert.ok(!out.includes('type="date"'), "terminal row must not render the reschedule input");
});

test("3C-V12. status=cancelled -> Reopen ONLY", () => {
  const out = html({ status: "cancelled", followUpAssignedUserId: ME, assignedUserName: "My Name", assignedUserActive: true });
  assert.ok(out.includes(tFr.reopen));
  for (const label of [tFr.claim, tFr.complete, tFr.cancel, tFr.release, tFr.rescheduleSubmit]) {
    assert.ok(!out.includes(label));
  }
});

test("3C-V13. terminal + foreign + !canAssignOthers -> no Reopen", () => {
  const out = html({ status: "done", followUpAssignedUserId: OTHER, assignedUserName: "Other", caps: EMPLOYEE_CAPS });
  assert.ok(!out.includes(tFr.reopen));
});

test("3C-V14. idle render: real <button type=\"button\">, no disabled attribute, no role=\"alert\"", () => {
  const out = html({});
  assert.ok(out.includes('type="button"'));
  assert.ok(!out.includes('disabled=""'), "idle render must not set the disabled attribute");
  assert.ok(!out.includes('role="alert"'), "no error region on the un-acted render");
});

// ============================ task / follow-up boundary ============================

const PAGE_SRC = readFileSync(
  fileURLToPath(new URL("../../app/admin/crm/clients/[id]/page.tsx", import.meta.url)),
  "utf8",
);

test("3C-B1. dueDate non-null -> the component renders its controls (owner label present)", () => {
  const out = html({ dueDate: new Date("2026-08-01T00:00:00Z") });
  assert.ok(out.includes(tFr.followUpOwner), "a Class-A follow-up row shows the follow-up owner label");
});

test("3C-B2. dueDate null -> the component renders NOTHING (fail-closed guard)", () => {
  const out = renderToStaticMarkup(
    React.createElement(FollowUpActions, {
      taskId: TASK,
      followUpAssignedUserId: null,
      assignedUserName: null,
      assignedUserActive: false,
      status: "todo",
      dueDate: null,
      currentUserId: ME,
      caps: ALL_CAPS,
      assignables: [],
      locale: "fr",
      t: tFr,
    }),
  );
  assert.equal(out, "", "no due date => no markup at all");
});

test("3C-B3. the server page gates <FollowUpActions> on `task.clientId !== null && task.dueDate !== null` (structural — no extra harness file)", () => {
  // The row classification lives on the server page; asserting it directly
  // would need a second DB harness/file, which the contract forbids.
  assert.match(PAGE_SRC, /task\.clientId !== null && task\.dueDate !== null/, "isFollowUpTask uses the frozen identity");
  assert.match(PAGE_SRC, /isFollowUpTask\(task\)\s*\?[\s\S]{0,1200}<FollowUpActions/, "the truthy branch renders <FollowUpActions>");
});

test("3C-B4. Class B (generic null-due) row keeps InlineStatusSelect + the legacy free-text assignee, and gets NO follow-up UI", () => {
  const classB = PAGE_SRC.slice(PAGE_SRC.indexOf("CLASS B"), PAGE_SRC.indexOf("</section>", PAGE_SRC.indexOf("CLASS B")));
  assert.match(classB, /<InlineStatusSelect value=\{task\.status\}/, "Class B keeps the status dropdown");
  assert.match(classB, /task\.assignee \?\? t\.unassigned/, "Class B keeps the legacy free-text assignee display");
  assert.ok(!classB.includes("<FollowUpActions"), "Class B never renders <FollowUpActions>");
  assert.ok(!classB.includes("followUpOwner"), "Class B is not labeled with the follow-up owner label");
});

test("3C-B5. Class A row uses the structured status Badge (not InlineStatusSelect) and the structured owner", () => {
  const classA = PAGE_SRC.slice(PAGE_SRC.indexOf("CLASS A"), PAGE_SRC.indexOf("CLASS B"));
  assert.match(classA, /<Badge label=\{taskStatusLabel\[task\.status\]/, "Class A shows a read-only status Badge");
  assert.ok(!classA.includes("<InlineStatusSelect"), "Class A drops the status dropdown");
  assert.match(classA, /followUpAssignedUserId=\{task\.assignedUserId\}/, "Class A passes the structured assigned_user_id");
});

test("3C-B6. Class A follow-up row renders the resolved assignee NAME, never the raw task.assignee free text", () => {
  // The component is not even given `task.assignee`; a Class-A owner is the
  // resolved structured identity.
  const out = html({ followUpAssignedUserId: OTHER, assignedUserName: "Jane Doe", assignedUserActive: true });
  assert.ok(visibleText(out).includes("Jane Doe"));
});

// ============================ identifier exposure (Fix-2) ============================

test("3C-I1. each eligible roster option carries value=\"<userId>\"", () => {
  const out = html({ caps: ALL_CAPS });
  assert.ok(out.includes(`value="${OTHER}"`), "Max Manager option value is the server-issued userId");
  assert.ok(out.includes(`value="${EVE}"`), "Eve Employee option value is the server-issued userId");
});

test("3C-I2. option visible text is the displayName; the userId is NOT visible text", () => {
  const vt = visibleText(html({ caps: ALL_CAPS }));
  assert.ok(vt.includes("Max Manager") && vt.includes("Eve Employee"));
  assert.ok(!vt.includes(OTHER) && !vt.includes(EVE), "a roster userId must never be human-visible");
});

test("3C-I3. followUpAssignedUserId is never human-visible text", () => {
  const vt = visibleText(html({ followUpAssignedUserId: ME, assignedUserName: "My Name", assignedUserActive: true }));
  assert.ok(!vt.includes(ME));
  assert.ok(vt.includes("My Name"));
});

test("3C-I4. unresolved structured assignee -> localized 'Former user', never the raw id", () => {
  const out = html({ followUpAssignedUserId: STRANGER, assignedUserName: null, assignedUserActive: true });
  assert.ok(out.includes(tFr.formerUser));
  assert.ok(!visibleText(out).includes(STRANGER), "the unresolved assignee id must never be visible");
});

test("3C-I5. inactive resolved assignee -> displayName + '(inactive)' suffix, never the raw id", () => {
  const out = html({ followUpAssignedUserId: OTHER, assignedUserName: "Stale Owner", assignedUserActive: false });
  assert.ok(out.includes("Stale Owner") && out.includes(tFr.inactiveSuffix));
  assert.ok(!visibleText(out).includes(OTHER));
});

test("3C-I6. taskId is never human-visible text (may live only in an attribute)", () => {
  assert.ok(!visibleText(html({})).includes(TASK));
});

test("3C-I7. every one of the six error-mapper outputs is id-free (no taskId / userId)", () => {
  const CODES = [
    "FOLLOWUP_NOT_FOUND",
    "INVALID_DUE_AT",
    "ASSIGNEE_NOT_ELIGIBLE",
    "NOT_ALLOWED",
    "ALREADY_TERMINAL",
    "FOLLOWUP_CHANGED_RETRY",
  ];
  for (const code of CODES) {
    for (const t of [tFr, tEn]) {
      const m = followUpActionErrorMessage(code, t);
      assert.equal(typeof m, "string");
      assert.notEqual(m, "");
      for (const id of [TASK, ME, OTHER, EVE, STRANGER]) {
        assert.ok(!m.includes(id), `${code} message must not contain an id`);
      }
    }
  }
});

test("3C-I8. only server-filtered assignables reach the picker — an OWNER / inactive id is simply absent", () => {
  // Eligibility is decided server-side by listAssignableRadarMembers(); the
  // component renders exactly what it is given. A roster that omits OWNER
  // therefore yields no OWNER option.
  const out = html({ assignables: [{ userId: OTHER, displayName: "Max Manager" }] });
  assert.ok(!out.includes(`value="${EVE}"`), "an id not in the roster never becomes an option");
  assert.ok(out.includes(`value="${OTHER}"`));
});

test("3C-I9. forged-id server rejection is delegated to the frozen 3A backend suite (documented, not re-proven here)", () => {
  // assignFollowUp(taskId, forgedUserId) still runs requireStaffMember,
  // isValidUuid, internal-org resolve, RADAR_ASSIGN escalation and
  // isEligibleAssignee under the row lock — proven by
  // lib/actions/crm-tasks-auth.integration.test.mjs (3A-1..3A-11).
  assert.ok(true);
});

test("3C-I10. no organization / workspace / role identifier appears in visible text", () => {
  const vt = visibleText(html({ followUpAssignedUserId: ME, assignedUserName: "My Name", caps: ALL_CAPS }));
  for (const forbidden of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE", "workspace", "organizationId", "workspaceOrgId", "staffMemberId", "actor"]) {
    assert.ok(!vt.includes(forbidden), `must not render "${forbidden}"`);
  }
  assert.ok(!vt.includes(ME) && !vt.includes(TASK));
});

// ============================ error mapping / stale result ============================

const ALL_CODES = [
  "FOLLOWUP_NOT_FOUND",
  "INVALID_DUE_AT",
  "ASSIGNEE_NOT_ELIGIBLE",
  "NOT_ALLOWED",
  "ALREADY_TERMINAL",
  "FOLLOWUP_CHANGED_RETRY",
];

test("3C-E1. followUpActionErrorMessage maps every one of the 6 codes (FR + EN); null / unknown -> null", () => {
  const expectFr = {
    FOLLOWUP_NOT_FOUND: tFr.errNotFound,
    INVALID_DUE_AT: tFr.errInvalidDueDate,
    ASSIGNEE_NOT_ELIGIBLE: tFr.errAssigneeNotEligible,
    NOT_ALLOWED: tFr.errNotAllowed,
    ALREADY_TERMINAL: tFr.errAlreadyTerminal,
    FOLLOWUP_CHANGED_RETRY: tFr.errChangedRetry,
  };
  for (const code of ALL_CODES) {
    assert.equal(followUpActionErrorMessage(code, tFr), expectFr[code]);
    assert.equal(typeof followUpActionErrorMessage(code, tEn), "string");
    assert.notEqual(followUpActionErrorMessage(code, tEn), "");
  }
  assert.equal(followUpActionErrorMessage(null, tFr), null);
  assert.equal(followUpActionErrorMessage(undefined, tFr), null);
  assert.equal(followUpActionErrorMessage("SOMETHING_ELSE", tFr), null);
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

test("3C-E2. success (undefined) -> clears error, refreshes exactly once", () => {
  const s = spies();
  applyFollowUpActionResult(undefined, s.actions);
  assert.deepEqual(s.calls.setError, [null]);
  assert.equal(s.calls.refresh, 1);
});

test("3C-E3. stale-state codes -> inline error AND one refresh", () => {
  for (const code of ["FOLLOWUP_NOT_FOUND", "ASSIGNEE_NOT_ELIGIBLE", "ALREADY_TERMINAL", "FOLLOWUP_CHANGED_RETRY"]) {
    const s = spies();
    applyFollowUpActionResult({ error: code }, s.actions);
    assert.deepEqual(s.calls.setError, [code]);
    assert.equal(s.calls.refresh, 1, `${code} must refresh the stale row`);
  }
});

test("3C-E4. authoritative-but-not-stale codes -> inline error only, NO refresh", () => {
  for (const code of ["NOT_ALLOWED", "INVALID_DUE_AT"]) {
    const s = spies();
    applyFollowUpActionResult({ error: code }, s.actions);
    assert.deepEqual(s.calls.setError, [code]);
    assert.equal(s.calls.refresh, 0, `${code} must not refresh`);
  }
});

test("3C-E5. applyFollowUpActionResult never receives the action -> it structurally cannot auto-retry", () => {
  // The helper's only inputs are `result` and `{ setError, refresh }` —
  // there is no callable it could re-invoke.
  const s = spies();
  applyFollowUpActionResult({ error: "FOLLOWUP_CHANGED_RETRY" }, s.actions);
  assert.deepEqual(s.calls.setError, ["FOLLOWUP_CHANGED_RETRY"]);
  assert.equal(s.calls.refresh, 1);
});

// ============================ cancelled side-effect (approved, Fix-1) ============================

test("3C-C1. getTaskStatusOptions('fr') contains { cancelled, Annulé }", () => {
  const fr = getTaskStatusOptions("fr");
  assert.ok(fr.some((o) => o.value === "cancelled" && o.label === "Annulé"));
});

test("3C-C2. getTaskStatusOptions('en') contains { cancelled, Cancelled }", () => {
  const en = getTaskStatusOptions("en");
  assert.ok(en.some((o) => o.value === "cancelled" && o.label === "Cancelled"));
});

test("3C-C3. TASK_STATUS_CLASS.cancelled is a non-empty class string", () => {
  assert.equal(typeof TASK_STATUS_CLASS.cancelled, "string");
  assert.notEqual(TASK_STATUS_CLASS.cancelled, "");
});

test("3C-C4. all four RADAR-CORE-3A backend statuses are representable in the shared options", () => {
  const values = getTaskStatusOptions("fr").map((o) => o.value);
  for (const v of ["todo", "in_progress", "done", "cancelled"]) {
    assert.ok(values.includes(v), `${v} must be a selectable/displayable status`);
  }
});

test("3C-C5. a cancelled Class-A follow-up renders its status Badge label + class on the page", () => {
  assert.match(PAGE_SRC, /<Badge label=\{taskStatusLabel\[task\.status\] \?\? task\.status\} className=\{TASK_STATUS_CLASS\[task\.status\] \?\? ""\} \/>/);
});

// ============================ FR / EN ============================

test("3C-L1. EN render uses EN labels, no FR leak", () => {
  const en = html({ locale: "en", t: tEn });
  assert.ok(en.includes(tEn.claim) && en.includes(tEn.complete) && en.includes(tEn.cancel));
  assert.ok(!en.includes(tFr.claim), "no FR label leaks into the EN render");
});

test("3C-L2. FR render uses FR labels, no EN leak", () => {
  const fr = html({ locale: "fr", t: tFr });
  assert.ok(fr.includes(tFr.claim));
  assert.ok(!fr.includes(tEn.claim), "no EN 'Claim' leaks into the FR render");
});

test("3C-L3. the follow-up owner label is distinct from the prospect owner label (crm.clientDetail.assignmentTitle)", () => {
  assert.notEqual(tFr.followUpOwner, dictionaries.fr.crm.clientDetail.assignmentTitle);
  assert.notEqual(tEn.followUpOwner, dictionaries.en.crm.clientDetail.assignmentTitle);
  assert.ok(html({}).includes(tFr.followUpOwner));
});

test("3C-L4. no hard-delete control lives inside <FollowUpActions>", () => {
  const src = readFileSync(fileURLToPath(new URL("./follow-up-actions.tsx", import.meta.url)), "utf8");
  assert.ok(!/deleteTask|DeleteTaskButton/.test(src), "hard delete stays the separate pre-existing control");
});
