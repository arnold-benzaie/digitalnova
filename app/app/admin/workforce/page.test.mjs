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

const { default: WorkforcePage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
  workforceRows = [];
  listCalls = 0;
  listError = null;
}

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
