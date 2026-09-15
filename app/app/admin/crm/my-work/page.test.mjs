// PHASE EMPLOYEE-OPS (Slice 2) — focused test for the /admin/crm/my-work
// protected route. Proves: (1) authorization is the FIRST thing that runs
// and asks for exactly "RADAR_WORK"; (2) the operational data is read only
// through getMyWork() (self view — never a direct DB call from the page,
// never with an argument); (3) a guard denial produces no page content and
// no data read; (4) caller-supplied input (a forged ?employee / ?userId)
// changes nothing; (5) the page component declares no parameters.
//
// @/lib/rbac/require-staff-member and @/lib/actions/employee-work are
// mocked at the module boundary so no live Postgres / Next runtime is
// needed. getLocale() is left real (returns "fr" outside a request).
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/crm/my-work/page.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let permissionCalls = [];
let denyMode = false;
let getMyWorkCalls = [];
/** @type {"OWNER"|"ADMIN"|"MANAGER"|"EMPLOYEE"} */
let mockViewerRole = "EMPLOYEE";

// WORKFORCE ACCESS CONTROL — the page now calls requireRadarAccess()
// (RADAR-permission-aware), not requireStaffMember(). Same contract/
// signature; only the name changed at the real call site.
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireRadarAccess: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return mockViewerRole;
    },
  },
});

// WORKFORCE — EMPLOYEE "MES COLLÈGUES" — the page now also captures
// requireRadarAccess()'s return value and conditionally calls
// listEmployeeColleagues() only for an EMPLOYEE viewer. Mocked here so no
// live Postgres/Next runtime is needed, mirroring getMyWork()'s own mock
// above.
let listEmployeeColleaguesCalls = 0;
mock.module("@/lib/actions/employee-colleagues", {
  namedExports: {
    listEmployeeColleagues: async () => {
      listEmployeeColleaguesCalls += 1;
      return [{ userId: "colleague-1", displayName: "Colleague One", role: "EMPLOYEE" }];
    },
  },
});

const EMPTY_WORK = {
  assignedProspects: [],
  followUps: { overdue: [], dueToday: [], upcoming: [] },
  openTasks: [],
  recentInteractions: [],
  prospectsWithoutFollowUp: [],
  claimableUnassigned: [],
  counts: {
    assignedProspects: 0,
    followUpsOverdue: 0,
    followUpsDueToday: 0,
    followUpsUpcoming: 0,
    openTasks: 0,
    prospectsWithoutFollowUp: 0,
  },
};

mock.module("@/lib/actions/employee-work", {
  namedExports: {
    getMyWork: async (...args) => {
      getMyWorkCalls.push(args);
      return EMPTY_WORK;
    },
  },
});

// Slice 3: the section components import the client island, which pulls in
// "use client" hooks + the radar/crm-tasks action modules. The page itself
// never renders those children (this test asserts the element tree is
// built, not its markup), so stub the island at the boundary.
mock.module("@/components/employee/my-work-actions", {
  namedExports: { ClaimProspectButton: () => null, MyFollowUpActions: () => null },
});

const { default: MyWorkPage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
  getMyWorkCalls = [];
  mockViewerRole = "EMPLOYEE";
  listEmployeeColleaguesCalls = 0;
}

test("my-work page: authorized -> renders; guard called exactly once with 'RADAR_WORK'; data read via getMyWork() with no argument", async () => {
  reset();
  const el = await MyWorkPage();
  assert.deepEqual(permissionCalls, ["RADAR_WORK"]);
  assert.equal(getMyWorkCalls.length, 1, "the page reads its data through getMyWork()");
  assert.deepEqual(getMyWorkCalls[0], [], "getMyWork() is called with no argument — it is a pure self view");
  assert.ok(el, "expected a React element when authorized");
});

test("my-work page: a guard denial (NEXT_REDIRECT) propagates — no data read, no page content", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => MyWorkPage(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_WORK"], "the guard still ran, with exactly RADAR_WORK, before any read");
  assert.equal(getMyWorkCalls.length, 0, "a denied caller never reaches the data read");
  assert.equal(listEmployeeColleaguesCalls, 0, "a denied caller never reaches the colleagues read either");
});

// ------------- WORKFORCE — EMPLOYEE "MES COLLÈGUES" -------------

test("my-work page: EMPLOYEE viewer -> listEmployeeColleagues() is called exactly once, panel is rendered", async () => {
  reset();
  mockViewerRole = "EMPLOYEE";
  const el = await MyWorkPage();
  assert.equal(listEmployeeColleaguesCalls, 1, "an EMPLOYEE viewer fetches the colleagues panel data");
  assert.ok(el);
});

test("my-work page: MANAGER viewer -> listEmployeeColleagues() is never called, no colleagues panel data fetched", async () => {
  reset();
  mockViewerRole = "MANAGER";
  const el = await MyWorkPage();
  assert.equal(listEmployeeColleaguesCalls, 0, "a MANAGER viewer must never trigger the EMPLOYEE-only colleagues read");
  assert.ok(el);
});

test("my-work page: ADMIN viewer -> listEmployeeColleagues() is never called", async () => {
  reset();
  mockViewerRole = "ADMIN";
  await MyWorkPage();
  assert.equal(listEmployeeColleaguesCalls, 0);
});

test("my-work page: OWNER viewer -> listEmployeeColleagues() is never called", async () => {
  reset();
  mockViewerRole = "OWNER";
  await MyWorkPage();
  assert.equal(listEmployeeColleaguesCalls, 0);
});

test("my-work page: authorization ignores caller-supplied input — a forged { searchParams } / { params } changes nothing", async () => {
  reset();
  const el = await MyWorkPage({ searchParams: { employee: "someone-else", userId: "11111111-1111-4111-8111-111111111111" }, params: { workspace: "other-org" } });
  assert.deepEqual(permissionCalls, ["RADAR_WORK"], "still exactly RADAR_WORK — no caller value influences the check");
  assert.equal(getMyWorkCalls.length, 1);
  assert.deepEqual(getMyWorkCalls[0], [], "still no argument — a forged employee/userId is never forwarded");
  assert.ok(el);
});

test("my-work page: the component declares no parameters (nothing to read employee / userId / workspace from)", () => {
  assert.equal(MyWorkPage.length, 0);
});
