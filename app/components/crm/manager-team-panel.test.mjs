// components/crm/manager-team-panel.test.mjs — WORKFORCE MANAGER "MON
// ÉQUIPE" — strictly presentational component. No act()-capable React
// harness in this repo (see components/app-sidebar-nav.test.mjs), so
// markup is asserted via renderToStaticMarkup, same approach as
// workforce-lifecycle-actions.test.mjs.
//
// Run: npx tsx --test components/crm/manager-team-panel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { ManagerTeamPanel } = await import("./manager-team-panel.tsx");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.crm.radar.myTeam;
const tEn = dictionaries.en.crm.radar.myTeam;

function html(props) {
  return renderToStaticMarkup(React.createElement(ManagerTeamPanel, { locale: "fr", ...props }));
}

test("renders the title/subtitle and every member's displayName + role label", () => {
  const out = html({ members: [{ userId: "u1", displayName: "Alice", role: "EMPLOYEE" }] });
  assert.ok(out.includes(tFr.title));
  assert.ok(out.includes(tFr.subtitle));
  assert.ok(out.includes("Alice"));
  assert.ok(out.includes(tFr.roleEmployee));
});

test("empty list renders the empty-state copy, not an empty <ul>", () => {
  const out = html({ members: [] });
  assert.ok(out.includes(tFr.emptyState));
  assert.ok(!out.includes("<ul"));
});

test("EN locale renders English copy", () => {
  const out = html({ members: [], locale: "en" });
  assert.ok(out.includes(tEn.title) && out.includes(tEn.emptyState));
  assert.ok(!out.includes(tFr.title));
});

test("no mutation control of any kind: no <button>, no <form>, no <a>, no onClick-bearing markup", () => {
  const out = html({ members: [{ userId: "u1", displayName: "Alice", role: "EMPLOYEE" }] });
  for (const forbidden of ["<button", "<form", "<a ", "<select", "<input"]) {
    assert.ok(!out.includes(forbidden), `must not render ${forbidden}`);
  }
});

test("no raw internal id (userId) appears in the visible markup", () => {
  const out = html({ members: [{ userId: "11111111-1111-4111-8111-111111111111", displayName: "Alice", role: "EMPLOYEE" }] });
  assert.ok(!out.includes("11111111-1111-4111-8111-111111111111"), "the id is a React key only, never rendered text");
});

test("component's own copy never introduces the word OWNER (a display name may legitimately contain arbitrary text, but the component's fixed strings must not)", () => {
  assert.ok(!tFr.title.toLowerCase().includes("owner") && !tFr.subtitle.toLowerCase().includes("owner") && !tFr.roleEmployee.toLowerCase().includes("owner"));
});

test("renders one list item per member, in the order given (sorting is the server function's job, not this component's)", () => {
  const out = html({
    members: [
      { userId: "u1", displayName: "Zed", role: "EMPLOYEE" },
      { userId: "u2", displayName: "Amy", role: "EMPLOYEE" },
    ],
  });
  const zedIndex = out.indexOf("Zed");
  const amyIndex = out.indexOf("Amy");
  assert.ok(zedIndex >= 0 && amyIndex >= 0 && zedIndex < amyIndex, "renders in the array order it was given, unmodified");
});
