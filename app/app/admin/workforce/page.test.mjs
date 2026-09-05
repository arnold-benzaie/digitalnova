// PHASE OWNER-UI-3A — focused test for the /admin/workforce read-only page.
//
// Proves: the page's authorization boundary exists, runs FIRST, and asks
// for exactly "WORKFORCE_MANAGE"; a denial produces no content; caller-
// supplied input has no authorization effect; and the page renders exactly
// what listWorkforceMembers() returns (email / localized role / localized
// status), with an empty-state when the list is empty.
//
// @/lib/rbac/require-staff-member AND @/lib/actions/workforce are mocked at
// the module boundary (same technique lib/actions/workforce.test.mjs uses)
// so neither module's real @/db import loads — no live Postgres, no Next
// runtime. getLocale() is left real: outside a request scope it never
// throws and returns "fr", so assertions use the real FR dictionary.
//
// The OWNER-exclusion invariant is NOT re-litigated here — it is a
// property of listWorkforceMembers()'s server-side positive allowlist,
// exhaustively proven by lib/actions/workforce.test.mjs and
// workforce.integration.test.mjs. This page has no OWNER-specific
// rendering branch: it maps whatever WorkforceMember[] it is given.
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/workforce/page.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { dictionaries } from "@/lib/i18n/dictionaries";

const t = dictionaries.fr.workforce;

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
      return "ADMIN";
    },
  },
});

let workforceRows = [];
let listCalls = 0;
let listError = null;
mock.module("@/lib/actions/workforce", {
  namedExports: {
    listWorkforceMembers: async () => {
      listCalls += 1;
      if (listError) throw listError;
      return workforceRows;
    },
  },
});

// PHASE OWNER-UI-4A — the eligible-user read is a separate module-boundary
// mock (its real impl imports @/db); the client dialog is stubbed to a
// no-op so its transitive "use client" deps never load. The stub is still
// a real element in the tree, so its forwarded props are assertable.
let assignableResult = { users: [], hasMore: false };
let assignableError = null;
let assignableCalls = 0;
mock.module("@/lib/actions/workforce-ui", {
  namedExports: {
    listAssignableWorkforceUsers: async () => {
      assignableCalls += 1;
      if (assignableError) throw assignableError;
      return assignableResult;
    },
  },
});
mock.module("@/components/workforce/add-workforce-member-form", {
  namedExports: { AddWorkforceMemberForm: () => null },
});

const { default: WorkforcePage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
  workforceRows = [];
  listCalls = 0;
  listError = null;
  assignableResult = { users: [], hasMore: false };
  assignableError = null;
  assignableCalls = 0;
}

/** Every element in the tree whose props satisfy `pred` — walks children
 * AND the AdminPageHero `actions` slot (where the Add-Member dialog lives). */
function findByProps(node, pred, found = []) {
  if (node == null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) findByProps(child, pred, found);
    return found;
  }
  if (node.props) {
    if (pred(node.props)) found.push(node);
    findByProps(node.props.children, pred, found);
    findByProps(node.props.actions, pred, found);
  }
  return found;
}
const addMemberForms = (el) => findByProps(el, (p) => "assignableUsers" in p && "hasMore" in p);

/** Recursively collect every string leaf + title/subtitle props from a
 * React element tree, so a rendered async Server Component can be asserted
 * against without a DOM renderer. */
function collectText(node, out = []) {
  if (node == null || node === false) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === "object" && node.props) {
    if (typeof node.props.title === "string") out.push(node.props.title);
    if (typeof node.props.subtitle === "string") out.push(node.props.subtitle);
    collectText(node.props.children, out);
  }
  return out;
}

const member = (over) => ({ userId: "u-" + Math.random().toString(36).slice(2), email: "x@example.com", role: "ADMIN", status: "ACTIVE", ...over });

test("OWNER-UI-3A page: authorized -> renders, guard called exactly once with 'WORKFORCE_MANAGE' before the workforce list", async () => {
  reset();
  workforceRows = [member({ email: "admin@example.com", role: "ADMIN", status: "ACTIVE" })];
  const el = await WorkforcePage();
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"]);
  assert.ok(el, "expected a React element when authorized");
  assert.equal(listCalls, 1);
});

test("OWNER-UI-3A page: a guard denial (NEXT_REDIRECT) rejects before any workforce row is fetched or rendered", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => WorkforcePage(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"], "the guard still ran, with exactly WORKFORCE_MANAGE");
  assert.equal(listCalls, 0, "listWorkforceMembers() must never run when the page guard denies");
  assert.equal(assignableCalls, 0, "listAssignableWorkforceUsers() must never run when the page guard denies");
});

test("OWNER-UI-3A page: authorization ignores caller-supplied input — a forged { searchParams } / { params } changes nothing", async () => {
  reset();
  workforceRows = [member({ email: "a@example.com" })];
  const el = await WorkforcePage({ searchParams: { role: "OWNER", workspace: "other-org" }, params: { workspace: "other-org" } });
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"], "still exactly WORKFORCE_MANAGE — no caller value influences the check");
  assert.ok(el);
});

test("OWNER-UI-3A page: the component declares no parameters (nothing to read role / workspace / identity from)", () => {
  assert.equal(WorkforcePage.length, 0);
});

test("OWNER-UI-3A page: renders one row per member — email + localized role + localized status", async () => {
  reset();
  workforceRows = [
    member({ email: "admin@example.com", role: "ADMIN", status: "ACTIVE" }),
    member({ email: "manager@example.com", role: "MANAGER", status: "SUSPENDED" }),
    member({ email: "employee@example.com", role: "EMPLOYEE", status: "OFFBOARDING" }),
  ];
  const text = collectText(await WorkforcePage()).join(" | ");

  assert.ok(text.includes("admin@example.com"), "ADMIN row email");
  assert.ok(text.includes("manager@example.com"), "MANAGER row email");
  assert.ok(text.includes("employee@example.com"), "EMPLOYEE row email");

  assert.ok(text.includes(t.roleAdmin), "localized ADMIN role label");
  assert.ok(text.includes(t.roleManager), "localized MANAGER role label");
  assert.ok(text.includes(t.roleEmployee), "localized EMPLOYEE role label");

  assert.ok(text.includes(t.statusActive), "localized ACTIVE status label");
  assert.ok(text.includes(t.statusSuspended), "localized SUSPENDED status label");
  assert.ok(text.includes(t.statusOffboarding), "localized OFFBOARDING status label");

  assert.ok(text.includes(t.columnMember) && text.includes(t.columnRole) && text.includes(t.columnStatus), "column headers");
  assert.ok(text.includes(t.title) && text.includes(t.subtitle), "hero title + subtitle");

  // Raw enum values must not leak past the localization map.
  assert.ok(!text.split("|").some((seg) => /\bADMIN\b|\bMANAGER\b|\bEMPLOYEE\b|\bACTIVE\b|\bSUSPENDED\b|\bOFFBOARDING\b/.test(seg)), "no raw role/status enum rendered");
});

test("OWNER-UI-3A page: an empty list renders the dictionary-backed empty state, not a table", async () => {
  reset();
  workforceRows = [];
  const text = collectText(await WorkforcePage()).join(" | ");
  assert.ok(text.includes(t.emptyState), "empty-state message");
  assert.ok(!text.includes(t.columnMember), "no table header when empty");
});

test("OWNER-UI-3A page: a listWorkforceMembers() failure propagates — never swallowed into an empty table", async () => {
  reset();
  listError = new Error("internal workspace is not configured");
  await assert.rejects(() => WorkforcePage(), /internal workspace is not configured/);
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"], "the page guard still ran first");
});

// ---------------------------- PHASE OWNER-UI-4A ----------------------------
// The page now also renders the "add member" dialog and feeds it
// listAssignableWorkforceUsers()'s result. The dialog component and the
// eligible-user read are both module-boundary mocks here; the anti-join
// semantics (OWNER / existing members excluded) are proven for real in
// lib/actions/workforce-ui.integration.test.mjs.

test("OWNER-UI-4A page: renders exactly one AddWorkforceMemberForm, after the guard, with listAssignableWorkforceUsers() called once", async () => {
  reset();
  workforceRows = [member({ email: "admin@example.com" })];
  assignableResult = { users: [{ id: "11111111-1111-4111-8111-111111111111", email: "candidate@example.com" }], hasMore: false };
  const el = await WorkforcePage();
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"]);
  assert.equal(assignableCalls, 1, "eligible-user read runs once, only after the route guard resolved");
  assert.equal(addMemberForms(el).length, 1, "exactly one add-member dialog is rendered");
});

test("OWNER-UI-4A page: forwards assignable.users and assignable.hasMore verbatim to the dialog", async () => {
  reset();
  const users = [
    { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" },
    { id: "22222222-2222-4222-8222-222222222222", email: "b@example.com" },
  ];
  assignableResult = { users, hasMore: true };
  const [form] = addMemberForms(await WorkforcePage());
  assert.deepEqual(form.props.assignableUsers, users);
  assert.equal(form.props.hasMore, true);
});

test("OWNER-UI-4A page: an empty eligible list is forwarded as [] (the dialog disables itself; the page does not gate)", async () => {
  reset();
  assignableResult = { users: [], hasMore: false };
  const [form] = addMemberForms(await WorkforcePage());
  assert.deepEqual(form.props.assignableUsers, []);
  assert.equal(form.props.hasMore, false);
});

test("OWNER-UI-4A page: the workforce table / empty-state stay independent of the eligible-user list", async () => {
  reset();
  workforceRows = [];
  assignableResult = { users: [{ id: "11111111-1111-4111-8111-111111111111", email: "c@example.com" }], hasMore: false };
  const text = collectText(await WorkforcePage()).join(" | ");
  assert.ok(text.includes(t.emptyState), "members list empty-state still renders when there ARE eligible users");
  assert.ok(!text.includes(t.columnMember), "still no table when there are no members");
});

test("OWNER-UI-4A page: a listAssignableWorkforceUsers() failure propagates — not swallowed into a broken render", async () => {
  reset();
  assignableError = new Error("internal workspace is not configured");
  await assert.rejects(() => WorkforcePage(), /internal workspace is not configured/);
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"], "the page guard still ran first");
});

test("OWNER-UI-4A page: still a zero-parameter Server Component; forged params/searchParams remain inert", async () => {
  reset();
  assert.equal(WorkforcePage.length, 0);
  assignableResult = { users: [], hasMore: false };
  const el = await WorkforcePage({ searchParams: { role: "OWNER", workspace: "other" }, params: { workspace: "other" } });
  assert.deepEqual(permissionCalls, ["WORKFORCE_MANAGE"]);
  assert.equal(addMemberForms(el).length, 1);
});
