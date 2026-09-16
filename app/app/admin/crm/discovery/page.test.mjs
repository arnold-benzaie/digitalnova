// MISSION C-2C-1 — focused test for the /admin/crm/discovery protected
// route. Proves: (1) authorization is the FIRST thing that runs and asks
// for exactly "RADAR_QUEUE_VIEW" — the SAME permission searchRadarDiscovery()
// itself re-checks; (2) a guard denial produces no page content; (3) the
// page performs no Discovery/CRM read of its own (it has none to mock —
// the entire search flow lives in the client island); (4) the component
// declares no parameters, so no caller-supplied searchParams/params can
// ever reach the RBAC check.
//
// @/lib/rbac/require-staff-member and @/lib/i18n/locale are mocked at the
// module boundary so no live Postgres / Next runtime is needed. The client
// island (components/crm/discovery-search-panel.tsx) imports a "use
// server" action module and React client hooks, so it is stubbed here —
// mirrors app/admin/crm/my-work/page.test.mjs's own "stub the island at
// the boundary" convention.
//
// Run: npx tsx --test --experimental-test-module-mocks app/admin/crm/discovery/page.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let permissionCalls = [];
let denyMode = false;

mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireRadarAccess: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "EMPLOYEE";
    },
  },
});

mock.module("@/lib/i18n/locale", {
  namedExports: { getLocale: async () => "fr" },
});

// Stubbed at the module boundary (mirrors app/admin/crm/my-work/page.test.mjs's
// own "stub the island" convention) — a marker function, never actually
// invoked by React here (the page only BUILDS the element tree via
// React.createElement; it is not rendered), so the panel's props are read
// directly off the returned element below instead of via a call-log side
// effect.
function DiscoverySearchPanelStub() {
  return null;
}
mock.module("@/components/crm/discovery-search-panel", {
  namedExports: { DiscoverySearchPanel: DiscoverySearchPanelStub },
});

const { default: CrmDiscoveryPage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
}

/** Finds the DiscoverySearchPanel element within the page's returned
 * Fragment tree and returns its props (or null if absent). */
function findPanelProps(el) {
  const children = el?.props?.children;
  const list = Array.isArray(children) ? children : [children];
  const panelEl = list.find((child) => child && child.type === DiscoverySearchPanelStub);
  return panelEl ? panelEl.props : null;
}

test("discovery page: authorized -> renders; guard called exactly once with 'RADAR_QUEUE_VIEW'", async () => {
  reset();
  const el = await CrmDiscoveryPage();
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.ok(el, "expected a React element when authorized");
});

test("discovery page: a guard denial (NEXT_REDIRECT) propagates — no page content built", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => CrmDiscoveryPage(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"], "the guard still ran, before any content");
});

test("discovery page: passes the crm.discovery dictionary slice and the resolved locale to the search panel, and nothing else", async () => {
  reset();
  const el = await CrmDiscoveryPage();
  const props = findPanelProps(el);
  assert.ok(props, "expected a DiscoverySearchPanel element in the returned tree");
  // MISSION C-2D-3 — `locale` was added so the panel's own formatLocalTime()
  // call can render FR/EN-appropriate local-time strings — still no
  // session, role, or DB data reaches the client island.
  assert.deepEqual(Object.keys(props).sort(), ["locale", "t"]);
  assert.equal(props.locale, "fr");
  assert.equal(typeof props.t.title, "string");
  assert.equal(typeof props.t.searchButton, "string");
});

test("discovery page: the component declares no parameters (nothing to read searchParams/params from)", () => {
  assert.equal(CrmDiscoveryPage.length, 0);
});

test("discovery page: authorization ignores caller-supplied input — a forged { searchParams } changes nothing", async () => {
  reset();
  const el = await CrmDiscoveryPage({ searchParams: { cursor: "forged", clientId: "11111111-1111-4111-8111-111111111111" } });
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"], "still exactly RADAR_QUEUE_VIEW — no caller value influences the check");
  assert.ok(el);
});
