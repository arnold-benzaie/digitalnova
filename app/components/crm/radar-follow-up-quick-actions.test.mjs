// components/crm/radar-follow-up-quick-actions.test.mjs — PHASE
// RADAR-CORE-3E queue quick actions (Claim / Complete) on the deterministic
// next follow-up of a row in /admin/crm/radar.
//
// Same approach as components/crm/follow-up-actions.test.mjs (this repo has
// no act()-capable React harness):
//   - the visibility matrix (which affordance renders for each caps /
//     ownership state, the FR/EN labels, the absence of any human-visible
//     UUID) is asserted via renderToStaticMarkup AND directly against the
//     exported pure predicates canClaimRadarFollowUp() /
//     canCompleteRadarFollowUp();
//   - the code -> localized-copy mapping is asserted against the exported
//     pure radarQuickFollowUpErrorMessage();
//   - the post-result branching (success/stale -> refresh, domain -> error
//     only, no auto-retry) is asserted against the REUSED 3C helper
//     applyFollowUpActionResult() imported from ./follow-up-actions.tsx —
//     proving the reuse, not a re-implementation.
//
// A task UUID is an IDENTIFIER, not an authorization secret: it may appear
// in a prop or an action argument. This file asserts it is never
// HUMAN-VISIBLE text. Forged-id server rejection is covered by the frozen
// 3A backend suite (lib/actions/crm-tasks-auth.integration.test.mjs).
//
// NOT wired into package.json's `test` list — run with:
//   npx tsx --test --experimental-test-module-mocks components/crm/radar-follow-up-quick-actions.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});
mock.module("@/lib/actions/crm-tasks", {
  namedExports: {
    // Never invoked by a static render; present so the value imports resolve.
    claimFollowUp: async () => undefined,
    completeFollowUp: async () => undefined,
  },
});
mock.module("@/components/gbp-audit/ui/use-confirm-dialog", {
  namedExports: { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
});

const {
  RadarFollowUpQuickActions,
  canClaimRadarFollowUp,
  canCompleteRadarFollowUp,
  radarQuickFollowUpErrorMessage,
} = await import("./radar-follow-up-quick-actions.tsx");
const { applyFollowUpActionResult } = await import("./follow-up-actions.tsx");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.crm.radar.quickFollowUp;
const tEn = dictionaries.en.crm.radar.quickFollowUp;

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
      React.createElement(RadarFollowUpQuickActions, {
        taskId: TASK,
        followUpAssignedUserId: null,
        currentUserId: ME,
        caps: ALL_CAPS,
        locale: "fr",
        t: tFr,
        ...props,
      }),
    ),
  );
}

/** Visible text only — strip every tag so an id that legitimately lives in
 * an attribute would not count as "rendered to a human". (This component
 * puts no id in any attribute; this is belt-and-braces.) */
const visibleText = (out) => out.replace(/<[^>]*>/g, " ");

const SOURCE = readFileSync(
  fileURLToPath(new URL("./radar-follow-up-quick-actions.tsx", import.meta.url)),
  "utf8",
);
// Structural "must NOT contain" checks run against code with comments
// stripped — the JSDoc legitimately names the 3A gates / deferred verbs to
// explain where authority lives. ("must contain" checks stay on SOURCE.)
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ============================ null-task defense ============================

test("3E-N1. taskId null -> renders nothing", () => {
  assert.equal(html({ taskId: null }), "");
});

test("3E-N2. taskId null -> both predicates are false", () => {
  assert.equal(
    canClaimRadarFollowUp({ taskId: null, followUpAssignedUserId: null, caps: ALL_CAPS }),
    false,
  );
  assert.equal(
    canCompleteRadarFollowUp({
      taskId: null,
      followUpAssignedUserId: null,
      currentUserId: ME,
      caps: ALL_CAPS,
    }),
    false,
  );
});

// ============================ Claim visibility ============================

test("3E-C1. open unassigned + canClaimToSelf -> Claim rendered", () => {
  const out = html({ followUpAssignedUserId: null, caps: EMPLOYEE_CAPS });
  assert.ok(out.includes(tFr.claim));
});

test("3E-C2. assigned to self -> Claim hidden", () => {
  assert.ok(!html({ followUpAssignedUserId: ME }).includes(tFr.claim));
});

test("3E-C3. assigned foreign -> Claim hidden", () => {
  assert.ok(!html({ followUpAssignedUserId: OTHER }).includes(tFr.claim));
});

test("3E-C4. canClaimToSelf:false (OWNER-like) -> Claim hidden even when unassigned", () => {
  assert.ok(!html({ followUpAssignedUserId: null, caps: OWNER_CAPS }).includes(tFr.claim));
});

test("3E-C5. canClaimRadarFollowUp predicate matrix", () => {
  assert.equal(canClaimRadarFollowUp({ taskId: TASK, followUpAssignedUserId: null, caps: { canClaimToSelf: true } }), true);
  assert.equal(canClaimRadarFollowUp({ taskId: TASK, followUpAssignedUserId: null, caps: { canClaimToSelf: false } }), false);
  assert.equal(canClaimRadarFollowUp({ taskId: TASK, followUpAssignedUserId: ME, caps: { canClaimToSelf: true } }), false);
  assert.equal(canClaimRadarFollowUp({ taskId: TASK, followUpAssignedUserId: OTHER, caps: { canClaimToSelf: true } }), false);
});

// ============================ Complete visibility ============================

test("3E-K1. unassigned + canReleaseOwn -> Complete rendered", () => {
  assert.ok(html({ followUpAssignedUserId: null, caps: EMPLOYEE_CAPS }).includes(tFr.complete));
});

test("3E-K2. assigned to self + canReleaseOwn -> Complete rendered", () => {
  assert.ok(html({ followUpAssignedUserId: ME, caps: EMPLOYEE_CAPS }).includes(tFr.complete));
});

test("3E-K3. assigned foreign + !canAssignOthers -> Complete hidden", () => {
  assert.ok(!html({ followUpAssignedUserId: OTHER, caps: EMPLOYEE_CAPS }).includes(tFr.complete));
});

test("3E-K4. assigned foreign + canAssignOthers -> Complete rendered", () => {
  assert.ok(html({ followUpAssignedUserId: OTHER, caps: ALL_CAPS }).includes(tFr.complete));
});

test("3E-K5. unassigned + !canReleaseOwn -> Complete hidden", () => {
  assert.ok(!html({ followUpAssignedUserId: null, caps: NO_CAPS }).includes(tFr.complete));
});

test("3E-K6. canCompleteRadarFollowUp predicate matrix (explicit booleans, no precedence tricks)", () => {
  const base = { taskId: TASK, currentUserId: ME };
  // unassigned / self -> canReleaseOwn
  assert.equal(canCompleteRadarFollowUp({ ...base, followUpAssignedUserId: null, caps: { canReleaseOwn: true, canAssignOthers: false } }), true);
  assert.equal(canCompleteRadarFollowUp({ ...base, followUpAssignedUserId: null, caps: { canReleaseOwn: false, canAssignOthers: true } }), false);
  assert.equal(canCompleteRadarFollowUp({ ...base, followUpAssignedUserId: ME, caps: { canReleaseOwn: true, canAssignOthers: false } }), true);
  assert.equal(canCompleteRadarFollowUp({ ...base, followUpAssignedUserId: ME, caps: { canReleaseOwn: false, canAssignOthers: true } }), false);
  // foreign -> canAssignOthers
  assert.equal(canCompleteRadarFollowUp({ ...base, followUpAssignedUserId: OTHER, caps: { canReleaseOwn: true, canAssignOthers: false } }), false);
  assert.equal(canCompleteRadarFollowUp({ ...base, followUpAssignedUserId: OTHER, caps: { canReleaseOwn: false, canAssignOthers: true } }), true);
});

// ============================ empty render ============================

test("3E-E1. no visible affordance and no error -> renders nothing", () => {
  // foreign + employee: neither Claim nor Complete; no error state.
  assert.equal(html({ followUpAssignedUserId: OTHER, caps: EMPLOYEE_CAPS }), "");
});

test("3E-E2. wrapper is a labelled group with the localized actions label when something renders", () => {
  const out = html({ followUpAssignedUserId: null, caps: EMPLOYEE_CAPS });
  assert.ok(out.includes('role="group"'));
  assert.ok(out.includes(`aria-label="${tFr.actionsLabel}"`));
});

test("3E-E3. buttons are type=button", () => {
  const out = html({ followUpAssignedUserId: null, caps: ALL_CAPS });
  assert.ok(!/<button(?![^>]*type="button")/.test(out), "every button must carry type=button");
});

// ============================ identifier safety ============================

test("3E-ID1. no raw task / user id in visible text (assigned-foreign render)", () => {
  const vis = visibleText(html({ followUpAssignedUserId: OTHER, caps: ALL_CAPS }));
  assert.ok(!vis.includes(TASK));
  assert.ok(!vis.includes(OTHER));
  assert.ok(!vis.includes(ME));
});

test("3E-ID2. no raw task / user id anywhere in the markup (attributes included)", () => {
  const out = html({ followUpAssignedUserId: OTHER, caps: ALL_CAPS });
  assert.ok(!out.includes(TASK));
  assert.ok(!out.includes(OTHER));
  assert.ok(!out.includes(ME));
});

// ============================ error mapping ============================

test("3E-M1. every reachable domain code maps to its localized string (FR + EN)", () => {
  for (const t of [tFr, tEn]) {
    assert.equal(radarQuickFollowUpErrorMessage("FOLLOWUP_NOT_FOUND", t), t.errNotFound);
    assert.equal(radarQuickFollowUpErrorMessage("ASSIGNEE_NOT_ELIGIBLE", t), t.errAssigneeNotEligible);
    assert.equal(radarQuickFollowUpErrorMessage("NOT_ALLOWED", t), t.errNotAllowed);
    assert.equal(radarQuickFollowUpErrorMessage("ALREADY_TERMINAL", t), t.errAlreadyTerminal);
    assert.equal(radarQuickFollowUpErrorMessage("FOLLOWUP_CHANGED_RETRY", t), t.errChangedRetry);
  }
});

test("3E-M2. INVALID_DUE_AT / null / undefined / unknown -> null (generic-error path takes over)", () => {
  assert.equal(radarQuickFollowUpErrorMessage("INVALID_DUE_AT", tFr), null);
  assert.equal(radarQuickFollowUpErrorMessage(null, tFr), null);
  assert.equal(radarQuickFollowUpErrorMessage(undefined, tFr), null);
  assert.equal(radarQuickFollowUpErrorMessage("SOMETHING_ELSE", tFr), null);
});

// ============================ reused 3C result handler ============================

function spyActions() {
  const calls = { setError: [], refresh: 0 };
  return {
    calls,
    setError: (e) => calls.setError.push(e),
    refresh: () => {
      calls.refresh += 1;
    },
  };
}

test("3E-R1. success (undefined) -> clear error + refresh once", () => {
  const a = spyActions();
  applyFollowUpActionResult(undefined, a);
  assert.deepEqual(a.calls.setError, [null]);
  assert.equal(a.calls.refresh, 1);
});

test("3E-R2. stale code (FOLLOWUP_CHANGED_RETRY) -> set error + refresh once", () => {
  const a = spyActions();
  applyFollowUpActionResult({ error: "FOLLOWUP_CHANGED_RETRY" }, a);
  assert.deepEqual(a.calls.setError, ["FOLLOWUP_CHANGED_RETRY"]);
  assert.equal(a.calls.refresh, 1);
});

test("3E-R3. stale code (ALREADY_TERMINAL) -> set error + refresh once", () => {
  const a = spyActions();
  applyFollowUpActionResult({ error: "ALREADY_TERMINAL" }, a);
  assert.deepEqual(a.calls.setError, ["ALREADY_TERMINAL"]);
  assert.equal(a.calls.refresh, 1);
});

test("3E-R4. NOT_ALLOWED -> set error only, NO refresh", () => {
  const a = spyActions();
  applyFollowUpActionResult({ error: "NOT_ALLOWED" }, a);
  assert.deepEqual(a.calls.setError, ["NOT_ALLOWED"]);
  assert.equal(a.calls.refresh, 0);
});

test("3E-R5. the handler never re-invokes an action (no auto-retry surface)", () => {
  // applyFollowUpActionResult has no action parameter at all — a retry is
  // structurally impossible. Guard against a future signature change.
  assert.equal(applyFollowUpActionResult.length, 2);
});

// ============================ structural guards ============================

test("3E-G1. reuses applyFollowUpActionResult from the 3C module, not a re-implementation", () => {
  assert.match(SOURCE, /import \{ applyFollowUpActionResult \} from "@\/components\/crm\/follow-up-actions"/);
});

test("3E-G2. imports ONLY claimFollowUp + completeFollowUp from crm-tasks (no Release/Assign/Reschedule/Cancel/Reopen)", () => {
  for (const forbidden of ["releaseFollowUp", "assignFollowUp", "rescheduleFollowUp", "cancelFollowUp", "reopenFollowUp"]) {
    assert.ok(!CODE.includes(forbidden), `must not reference ${forbidden}`);
  }
  assert.ok(SOURCE.includes("claimFollowUp") && SOURCE.includes("completeFollowUp"));
});

test("3E-G3. no confirmation dialog, no full FollowUpActions component, no new server action / API", () => {
  assert.ok(!CODE.includes("use-confirm-dialog"), "no confirm dialog");
  assert.ok(!/\bFollowUpActions\b/.test(CODE), "must not pull in the full 3C control");
  assert.ok(!CODE.includes('"use server"'), "presentation component only");
  assert.ok(!/\bfetch\(/.test(CODE) && !CODE.includes("/api/"), "no API route");
});

test("3E-G4. no optimistic update / no auto-retry / no timezone or date input", () => {
  assert.ok(!CODE.includes("setTimeout") && !CODE.includes("retry"), "no auto-retry");
  assert.ok(!CODE.includes('type="date"') && !CODE.includes("toISOString"), "no reschedule affordance");
});

test("3E-G5. holds no role / workspace / org id string", () => {
  assert.ok(!/RADAR_WORK|RADAR_ASSIGN|workspaceOrgId|organizationId/.test(CODE));
});

// ============================ i18n symmetry ============================

test("3E-I1. crm.radar.quickFollowUp has identical key sets in FR and EN", () => {
  assert.deepEqual(Object.keys(tFr).sort(), Object.keys(tEn).sort());
});

test("3E-I2. exactly the 9 contracted keys, all non-empty strings", () => {
  const expected = [
    "claim",
    "complete",
    "pending",
    "actionsLabel",
    "errNotFound",
    "errNotAllowed",
    "errAlreadyTerminal",
    "errChangedRetry",
    "errAssigneeNotEligible",
  ].sort();
  assert.deepEqual(Object.keys(tFr).sort(), expected);
  for (const t of [tFr, tEn]) {
    for (const k of expected) assert.ok(typeof t[k] === "string" && t[k].length > 0, `${k} present`);
  }
});

test("3E-I3. every quickFollowUp key the component references exists in the dictionary", () => {
  const referenced = [...SOURCE.matchAll(/\bt\.([a-zA-Z]+)\b/g)].map((m) => m[1]);
  for (const k of new Set(referenced)) {
    assert.ok(k in tFr, `component references t.${k} which is missing from the dictionary`);
  }
});
