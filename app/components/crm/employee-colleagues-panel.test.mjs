// components/crm/employee-colleagues-panel.test.mjs — WORKFORCE EMPLOYEE
// "MES COLLÈGUES" — strictly presentational component. No act()-capable
// React harness in this repo (see components/app-sidebar-nav.test.mjs), so
// markup is asserted via renderToStaticMarkup, same approach as
// components/crm/manager-team-panel.test.mjs.
//
// Run: npx tsx --test components/crm/employee-colleagues-panel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { EmployeeColleaguesPanel } = await import("./employee-colleagues-panel.tsx");
const { dictionaries } = await import("@/lib/i18n/dictionaries");

const tFr = dictionaries.fr.employee;
const tEn = dictionaries.en.employee;

function html(props) {
  return renderToStaticMarkup(React.createElement(EmployeeColleaguesPanel, { locale: "fr", ...props }));
}

test("renders the title/subtitle and every colleague's displayName + role label", () => {
  const out = html({ colleagues: [{ userId: "u1", displayName: "Alice", role: "EMPLOYEE" }] });
  assert.ok(out.includes(tFr.colleaguesTitle));
  assert.ok(out.includes(tFr.colleaguesSubtitle));
  assert.ok(out.includes("Alice"));
  assert.ok(out.includes(tFr.colleaguesRoleEmployee));
});

test("empty list renders the empty-state copy, not an empty <ul>", () => {
  const out = html({ colleagues: [] });
  assert.ok(out.includes(tFr.colleaguesEmptyState));
  assert.ok(!out.includes("<ul"));
});

test("EN locale renders English copy", () => {
  const out = html({ colleagues: [], locale: "en" });
  assert.ok(out.includes(tEn.colleaguesTitle) && out.includes(tEn.colleaguesEmptyState));
  assert.ok(!out.includes(tFr.colleaguesTitle));
});

test("no mutation control of any kind: no <button>, no <form>, no <a>, no onClick-bearing markup", () => {
  const out = html({ colleagues: [{ userId: "u1", displayName: "Alice", role: "EMPLOYEE" }] });
  for (const forbidden of ["<button", "<form", "<a ", "<select", "<input"]) {
    assert.ok(!out.includes(forbidden), `must not render ${forbidden}`);
  }
});

test("no raw internal id (userId) appears in the visible markup", () => {
  const out = html({ colleagues: [{ userId: "11111111-1111-4111-8111-111111111111", displayName: "Alice", role: "EMPLOYEE" }] });
  assert.ok(!out.includes("11111111-1111-4111-8111-111111111111"), "the id is a React key only, never rendered text");
});

test("component's own copy never introduces the word OWNER, ADMIN or MANAGER (a display name may legitimately contain arbitrary text, but the component's fixed strings must not)", () => {
  for (const word of ["owner", "admin", "manager"]) {
    assert.ok(!tFr.colleaguesTitle.toLowerCase().includes(word));
    assert.ok(!tFr.colleaguesSubtitle.toLowerCase().includes(word));
    assert.ok(!tFr.colleaguesRoleEmployee.toLowerCase().includes(word));
  }
});

test("component's own copy is never the MANAGER 'Mon équipe' wording — a distinct feature, distinct framing", () => {
  assert.notEqual(tFr.colleaguesTitle, "Mon équipe");
});

test("renders one list item per colleague, in the order given (sorting is the server function's job, not this component's)", () => {
  const out = html({
    colleagues: [
      { userId: "u1", displayName: "Zed", role: "EMPLOYEE" },
      { userId: "u2", displayName: "Amy", role: "EMPLOYEE" },
    ],
  });
  const zedIndex = out.indexOf("Zed");
  const amyIndex = out.indexOf("Amy");
  assert.ok(zedIndex >= 0 && amyIndex >= 0 && zedIndex < amyIndex, "renders in the array order it was given, unmodified");
});
