// PHASE EMPLOYEE-OPS (Slice 3) — the ONLY client island of /admin/crm/my-work.
//
// Same approach as components/crm/radar-follow-up-quick-actions.test.mjs
// (this repo has no act()-capable React harness):
//   - the pure code -> localized-copy mappers (claimErrorMessage /
//     followUpQuickErrorMessage) are asserted directly, FR + EN;
//   - the post-result branching is the REUSED helpers
//     applyRadarAssignmentResult (from radar-assignment-controls.tsx) and
//     applyFollowUpActionResult (from follow-up-actions.tsx) — asserted to
//     be imported, not re-implemented, and to expose no auto-retry surface;
//   - the render matrix (which affordance shows, FR/EN labels, NO visible
//     id, buttons type=button, NO assignee <select> / target-user field) is
//     asserted via renderToStaticMarkup with next/navigation + the action
//     modules mocked.
//
// A client / task UUID is an IDENTIFIER passed as an action argument, never
// an authorization secret. This file asserts it is never HUMAN-VISIBLE.
// Server-side ownership / eligibility rejection is covered by the frozen
// backend suites (radar-assignment / crm-tasks-auth integration tests).
//
// Run with: npx tsx --test --experimental-test-module-mocks components/employee/my-work-actions.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { mock } = await import("node:test");

mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh: () => {} }) } });
mock.module("@/lib/actions/radar-assignment", {
  namedExports: { claimProspect: async () => undefined, assignProspect: async () => undefined, unassignProspect: async () => undefined },
});
mock.module("@/lib/actions/crm-tasks", {
  namedExports: {
    completeFollowUp: async () => undefined,
    cancelFollowUp: async () => undefined,
    rescheduleFollowUp: async () => undefined,
    claimFollowUp: async () => undefined,
    releaseFollowUp: async () => undefined,
    assignFollowUp: async () => undefined,
    reopenFollowUp: async () => undefined,
  },
});
mock.module("@/components/gbp-audit/ui/use-confirm-dialog", {
  namedExports: { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
});

const { ClaimProspectButton, MyFollowUpActions, claimErrorMessage, followUpQuickErrorMessage } = await import("./my-work-actions.tsx");
const { applyRadarAssignmentResult } = await import("@/components/crm/radar-assignment-controls");
const { applyFollowUpActionResult } = await import("@/components/crm/follow-up-actions");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.employee;
const tEn = dictionaries.en.employee;

const CLIENT = "11111111-1111-4111-8111-111111111111";
const TASK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const decodeEntities = (s) =>
  s.replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const visibleText = (out) => decodeEntities(out).replace(/<[^>]*>/g, " ");

const SOURCE = readFileSync(fileURLToPath(new URL("./my-work-actions.tsx", import.meta.url)), "utf8");
// Structural "must NOT contain" checks run against comment-stripped code —
// the JSDoc legitimately names the backend gates / deferred verbs.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ============================ claimErrorMessage ============================

test("S3-CE1. every code claimProspect can return to a self-claim maps to safe copy (FR + EN)", () => {
  for (const t of [tFr, tEn]) {
    assert.equal(claimErrorMessage("ALREADY_ASSIGNED", t), t.errProspectUnavailable);
    assert.equal(claimErrorMessage("PROSPECT_NOT_FOUND", t), t.errProspectUnavailable);
    assert.equal(claimErrorMessage("INVALID_CLIENT", t), t.errProspectUnavailable);
    assert.equal(claimErrorMessage("ASSIGNMENT_CHANGED_RETRY", t), t.errProspectUnavailable);
    assert.equal(claimErrorMessage("ASSIGNEE_NOT_ELIGIBLE", t), t.errActionNotAllowed);
  }
});

test("S3-CE2. unrelated / null / undefined codes -> null (generic path takes over)", () => {
  for (const c of ["ASSIGNMENT_UNCHANGED", "NOT_ALLOWED_TO_ASSIGN", "INVALID_ASSIGNEE", null, undefined, "WAT"]) {
    assert.equal(claimErrorMessage(c, tFr), null);
  }
});

// ============================ followUpQuickErrorMessage ============================

test("S3-FE1. NOT_ALLOWED -> 'no longer yours'; stale codes -> 'status changed' (FR + EN)", () => {
  for (const t of [tFr, tEn]) {
    assert.equal(followUpQuickErrorMessage("NOT_ALLOWED", t), t.errFollowUpNotYours);
    assert.equal(followUpQuickErrorMessage("FOLLOWUP_NOT_FOUND", t), t.errFollowUpStatusChanged);
    assert.equal(followUpQuickErrorMessage("ALREADY_TERMINAL", t), t.errFollowUpStatusChanged);
    assert.equal(followUpQuickErrorMessage("FOLLOWUP_CHANGED_RETRY", t), t.errFollowUpStatusChanged);
    assert.equal(followUpQuickErrorMessage("INVALID_DUE_AT", t), t.errInvalidDate);
    assert.equal(followUpQuickErrorMessage("ASSIGNEE_NOT_ELIGIBLE", t), t.errActionNotAllowed);
  }
});

test("S3-FE2. null / undefined / unknown -> null (generic path)", () => {
  for (const c of [null, undefined, "WAT"]) assert.equal(followUpQuickErrorMessage(c, tFr), null);
});

// ============================ reused result handlers ============================

function spy() {
  const calls = { setError: [], refresh: 0 };
  return { calls, setError: (e) => calls.setError.push(e), refresh: () => { calls.refresh += 1; } };
}

test("S3-R1. claim success (undefined) -> clear error + refresh (reused radar handler)", () => {
  const a = spy();
  applyRadarAssignmentResult(undefined, a);
  assert.deepEqual(a.calls.setError, [null]);
  assert.equal(a.calls.refresh, 1);
});

test("S3-R2. claim stale (ALREADY_ASSIGNED) -> error + refresh (row moved)", () => {
  const a = spy();
  applyRadarAssignmentResult({ error: "ALREADY_ASSIGNED" }, a);
  assert.deepEqual(a.calls.setError, ["ALREADY_ASSIGNED"]);
  assert.equal(a.calls.refresh, 1);
});

test("S3-R3. follow-up NOT_ALLOWED -> error only, NO refresh, NO retry (reused 3C handler)", () => {
  const a = spy();
  applyFollowUpActionResult({ error: "NOT_ALLOWED" }, a);
  assert.deepEqual(a.calls.setError, ["NOT_ALLOWED"]);
  assert.equal(a.calls.refresh, 0);
});

test("S3-R4. neither reused handler takes an action arg — no auto-retry surface", () => {
  assert.equal(applyRadarAssignmentResult.length, 2);
  assert.equal(applyFollowUpActionResult.length, 2);
});

// ============================ ClaimProspectButton render ============================

function claimHtml(props) {
  return decodeEntities(renderToStaticMarkup(React.createElement(ClaimProspectButton, { clientId: CLIENT, locale: "fr", ...props })));
}

test("S3-C1. renders one type=button with the claim CTA, no <select>, no target-user field", () => {
  const out = claimHtml();
  assert.ok(out.includes(tFr.claimCta));
  assert.ok(!/<button(?![^>]*type="button")/.test(out), "button must be type=button");
  assert.ok(!out.includes("<select"), "no assignee picker");
  assert.ok(!/name="(assignee|assigneeUserId|userId|targetUserId|currentUserId)"/.test(out), "no target-user field");
});

test("S3-C2. EN CTA", () => {
  assert.ok(claimHtml({ locale: "en" }).includes(tEn.claimCta));
});

test("S3-C3. the client id never appears as visible text", () => {
  assert.ok(!visibleText(claimHtml()).includes(CLIENT));
});

// ============================ MyFollowUpActions render ============================

function fuHtml(props) {
  return decodeEntities(
    renderToStaticMarkup(React.createElement(MyFollowUpActions, { taskId: TASK, dueAt: "2026-09-10T09:00:00.000Z", locale: "fr", ...props })),
  );
}

test("S3-F1. renders Complete + Cancel + Reschedule (with a date input), all type=button", () => {
  const out = fuHtml();
  assert.ok(out.includes(tFr.actionComplete));
  assert.ok(out.includes(tFr.actionCancel));
  assert.ok(out.includes(tFr.actionReschedule));
  assert.ok(out.includes('type="date"'), "reschedule needs a date input");
  assert.ok(!/<button(?![^>]*type="button")/.test(out), "every button must be type=button");
});

test("S3-F2. no assign / reassign / release affordance (foreign-ownership actions absent)", () => {
  const out = fuHtml();
  assert.ok(!out.includes("<select"), "no assignee <select>");
  assert.ok(!/name="(assignee|assigneeUserId|userId)"/.test(out), "no assignee field");
});

test("S3-F3. labelled group + localized aria-label; task id never visible text", () => {
  const out = fuHtml();
  assert.ok(out.includes('role="group"'));
  assert.ok(out.includes(`aria-label="${tFr.quickActionsLabel}"`));
  assert.ok(!visibleText(out).includes(TASK));
});

test("S3-F4. EN labels", () => {
  const out = fuHtml({ locale: "en" });
  assert.ok(out.includes(tEn.actionComplete) && out.includes(tEn.actionCancel) && out.includes(tEn.actionReschedule));
});

// ============================ structural guards ============================

test("S3-G1. reuses the existing result handlers, not a re-implementation", () => {
  assert.match(SOURCE, /import \{ applyRadarAssignmentResult \} from "@\/components\/crm\/radar-assignment-controls"/);
  assert.match(SOURCE, /import \{ applyFollowUpActionResult \} from "@\/components\/crm\/follow-up-actions"/);
});

test("S3-G2. imports ONLY claimProspect from radar-assignment (no assign / unassign)", () => {
  for (const forbidden of ["assignProspect", "unassignProspect"]) {
    assert.ok(!CODE.includes(forbidden), `must not reference ${forbidden}`);
  }
  assert.ok(SOURCE.includes("claimProspect"));
});

test("S3-G3. imports ONLY complete / cancel / reschedule from crm-tasks (no claim / assign / release / reopen)", () => {
  for (const forbidden of ["claimFollowUp", "assignFollowUp", "releaseFollowUp", "reopenFollowUp"]) {
    assert.ok(!CODE.includes(forbidden), `must not reference ${forbidden}`);
  }
  assert.ok(SOURCE.includes("completeFollowUp") && SOURCE.includes("cancelFollowUp") && SOURCE.includes("rescheduleFollowUp"));
});

test("S3-G4. no new server action / API / confirm dialog", () => {
  assert.ok(!CODE.includes('"use server"'), "presentation island only");
  assert.ok(!/\bfetch\(/.test(CODE) && !CODE.includes("/api/"), "no API route");
  assert.ok(!CODE.includes("use-confirm-dialog"), "no confirm dialog in the compact island");
});

test("S3-G5. no optimistic update / no auto-retry", () => {
  assert.ok(!CODE.includes("setTimeout") && !/\bretry\b/i.test(CODE), "no auto-retry");
});

test("S3-G6. holds no role / workspace / actor-id string (server is the sole authority)", () => {
  assert.ok(!/RADAR_WORK|RADAR_ASSIGN|WORKFORCE_MANAGE|OWNER_MANAGE|workspaceOrgId|organizationId|currentUserId/.test(CODE));
});

// ============================ i18n symmetry ============================

test("S3-I1. dictionaries.employee has identical key sets in FR and EN", () => {
  assert.deepEqual(Object.keys(tFr).sort(), Object.keys(tEn).sort());
});

test("S3-I2. every employee key the island references exists in the dictionary, non-empty in both locales", () => {
  const referenced = [...SOURCE.matchAll(/\bt\.([a-zA-Z]+)\b/g)].map((m) => m[1]);
  for (const k of new Set(referenced)) {
    assert.ok(k in tFr, `island references t.${k} missing from employee dictionary`);
    assert.ok(typeof tFr[k] === "string" && tFr[k].length > 0, `fr.${k} non-empty`);
    assert.ok(typeof tEn[k] === "string" && tEn[k].length > 0, `en.${k} non-empty`);
  }
});
