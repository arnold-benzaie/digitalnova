// Pure-logic tests, no DB, no rendering — getStaffNavSections()/
// getClientNavSections() return plain data, not JSX, so they're testable
// directly without a component-rendering harness (this repo doesn't have
// one). Uses the real fr navigation dictionary as the NavDict input.
//
// Run with: npx tsx --test components/app-sidebar-nav.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { getStaffNavSections, getClientNavSections } from "./app-sidebar-nav.tsx";
import { navigation } from "../lib/i18n/dictionaries/navigation.ts";

const t = navigation.fr;

test("getStaffNavSections() includes a Catalogue link to /admin/catalogue in the business section", () => {
  const sections = getStaffNavSections(t);
  const business = sections.find((s) => s.key === "business");
  assert.ok(business, "expected a 'business' section to exist");

  const catalogueItem = business.items.find((i) => i.href === "/admin/catalogue");
  assert.ok(catalogueItem, "expected an item linking to /admin/catalogue in the business section");
  assert.equal(catalogueItem.label, t.items.catalogue);
});

test("getStaffNavSections() has exactly one item pointing to /admin/catalogue, across all sections", () => {
  const sections = getStaffNavSections(t);
  const matches = sections.flatMap((s) => s.items).filter((i) => i.href === "/admin/catalogue");
  assert.equal(matches.length, 1);
});

test("getClientNavSections() never links to /admin/catalogue", () => {
  const sections = getClientNavSections(t);
  const matches = sections.flatMap((s) => s.items).filter((i) => i.href === "/admin/catalogue");
  assert.equal(matches.length, 0);
});

test("getClientNavSections() has no item labeled like the catalogue nav entry", () => {
  const sections = getClientNavSections(t);
  const matches = sections.flatMap((s) => s.items).filter((i) => i.label === t.items.catalogue);
  assert.equal(matches.length, 0);
});

// ---------------- PHASE OWNER-UI-2 — Owner Control nav visibility ----------------
// The item is generated ONLY on an explicit { isOwner: true }; every other
// shape (false / undefined / omitted / {}) must leave the sidebar data
// with no /admin/owner item at all — absence, not a hidden/disabled item.

const ownerItems = (sections) => sections.flatMap((s) => s.items).filter((i) => i.href === "/admin/owner");

test("OWNER-UI-2: { isOwner: true } -> exactly one /admin/owner item, in the relation section, with the dictionary label", () => {
  const sections = getStaffNavSections(t, { isOwner: true });
  const matches = ownerItems(sections);
  assert.equal(matches.length, 1, "expected exactly one Owner Control item");
  assert.equal(matches[0].label, t.items.ownerControl);

  const relation = sections.find((s) => s.key === "relation");
  assert.ok(relation, "expected a 'relation' section");
  assert.ok(
    relation.items.some((i) => i.href === "/admin/owner"),
    "the Owner Control item must live in the relation section",
  );
  // last item of that section
  assert.equal(relation.items[relation.items.length - 1].href, "/admin/owner");
});

test("OWNER-UI-2: the Owner Control item is never duplicated under { isOwner: true }", () => {
  const sections = getStaffNavSections(t, { isOwner: true });
  assert.equal(ownerItems(sections).length, 1);
});

test("OWNER-UI-2: { isOwner: false } -> no /admin/owner item", () => {
  assert.equal(ownerItems(getStaffNavSections(t, { isOwner: false })).length, 0);
});

test("OWNER-UI-2: { isOwner: undefined } -> no /admin/owner item", () => {
  assert.equal(ownerItems(getStaffNavSections(t, { isOwner: undefined })).length, 0);
});

test("OWNER-UI-2: options omitted entirely -> no /admin/owner item (all existing single-arg callers unaffected)", () => {
  assert.equal(ownerItems(getStaffNavSections(t)).length, 0);
});

test("OWNER-UI-2: empty options object -> no /admin/owner item", () => {
  assert.equal(ownerItems(getStaffNavSections(t, {})).length, 0);
});

test("OWNER-UI-2: a truthy-but-not-true isOwner (e.g. a string) does NOT reveal the item — strict === true only", () => {
  // getStaffNavSections is typed to boolean, but a JS caller / forged
  // client value could be anything; the check must be strict.
  assert.equal(ownerItems(getStaffNavSections(t, { isOwner: "true" })).length, 0);
  assert.equal(ownerItems(getStaffNavSections(t, { isOwner: 1 })).length, 0);
});

test("OWNER-UI-2: getClientNavSections() never contains /admin/owner (client portal is unaffected)", () => {
  assert.equal(ownerItems(getClientNavSections(t)).length, 0);
});

test("OWNER-UI-2: getClientNavSections() has no item labeled like the Owner Control nav entry", () => {
  const matches = getClientNavSections(t)
    .flatMap((s) => s.items)
    .filter((i) => i.label === t.items.ownerControl);
  assert.equal(matches.length, 0);
});

// ---------------- PHASE OWNER-UI-3B — Workforce nav visibility ----------------
// The /admin/workforce item is generated ONLY on an explicit
// { canManageWorkforce: true }; every other shape leaves the sidebar with
// no such item. Independent of the OWNER-UI-2 { isOwner } flag.

const workforceItems = (sections) => sections.flatMap((s) => s.items).filter((i) => i.href === "/admin/workforce");

test("OWNER-UI-3B: { canManageWorkforce: true } -> exactly one /admin/workforce item, in the relation section, with the dictionary label", () => {
  const sections = getStaffNavSections(t, { canManageWorkforce: true });
  const matches = workforceItems(sections);
  assert.equal(matches.length, 1, "expected exactly one Workforce item");
  assert.equal(matches[0].label, t.items.workforce);
  assert.equal(matches[0].href, "/admin/workforce");

  const relation = sections.find((s) => s.key === "relation");
  assert.ok(relation, "expected a 'relation' section");
  assert.ok(relation.items.some((i) => i.href === "/admin/workforce"), "the Workforce item must live in the relation section");
});

test("OWNER-UI-3B: the Workforce item sits immediately after Users and before any Owner Control item", () => {
  const relation = getStaffNavSections(t, { canManageWorkforce: true, isOwner: true }).find((s) => s.key === "relation");
  const hrefs = relation.items.map((i) => i.href);
  assert.equal(hrefs[hrefs.indexOf("/admin/workforce") - 1], "/admin/users", "Workforce comes right after Users");
  assert.ok(hrefs.indexOf("/admin/workforce") < hrefs.indexOf("/admin/owner"), "Workforce comes before Owner Control");
});

test("OWNER-UI-3B: the Workforce item is never duplicated under { canManageWorkforce: true }", () => {
  assert.equal(workforceItems(getStaffNavSections(t, { canManageWorkforce: true })).length, 1);
});

test("OWNER-UI-3B: { canManageWorkforce: false } -> no /admin/workforce item", () => {
  assert.equal(workforceItems(getStaffNavSections(t, { canManageWorkforce: false })).length, 0);
});

test("OWNER-UI-3B: { canManageWorkforce: undefined } -> no /admin/workforce item", () => {
  assert.equal(workforceItems(getStaffNavSections(t, { canManageWorkforce: undefined })).length, 0);
});

test("OWNER-UI-3B: options omitted entirely -> no /admin/workforce item", () => {
  assert.equal(workforceItems(getStaffNavSections(t)).length, 0);
});

test("OWNER-UI-3B: empty options object -> no /admin/workforce item", () => {
  assert.equal(workforceItems(getStaffNavSections(t, {})).length, 0);
});

test("OWNER-UI-3B: a truthy-but-not-true canManageWorkforce (string / number) does NOT reveal the item — strict === true only", () => {
  assert.equal(workforceItems(getStaffNavSections(t, { canManageWorkforce: "true" })).length, 0);
  assert.equal(workforceItems(getStaffNavSections(t, { canManageWorkforce: 1 })).length, 0);
});

test("OWNER-UI-3B: OWNER-like (isOwner:true, canManageWorkforce:true) -> BOTH Workforce and Owner Control visible", () => {
  const sections = getStaffNavSections(t, { isOwner: true, canManageWorkforce: true });
  assert.equal(workforceItems(sections).length, 1);
  assert.equal(ownerItems(sections).length, 1);
});

test("OWNER-UI-3B: ADMIN-like (isOwner:false, canManageWorkforce:true) -> Workforce visible, Owner Control absent", () => {
  const sections = getStaffNavSections(t, { isOwner: false, canManageWorkforce: true });
  assert.equal(workforceItems(sections).length, 1);
  assert.equal(ownerItems(sections).length, 0);
});

test("OWNER-UI-3B: MANAGER/EMPLOYEE-like (isOwner:false, canManageWorkforce:false) -> neither Workforce nor Owner Control", () => {
  const sections = getStaffNavSections(t, { isOwner: false, canManageWorkforce: false });
  assert.equal(workforceItems(sections).length, 0);
  assert.equal(ownerItems(sections).length, 0);
});

test("OWNER-UI-3B: getClientNavSections() never contains /admin/workforce, and no Owner Control regression", () => {
  const sections = getClientNavSections(t);
  assert.equal(workforceItems(sections).length, 0);
  assert.equal(ownerItems(sections).length, 0);
  assert.equal(
    sections.flatMap((s) => s.items).filter((i) => i.label === t.items.workforce).length,
    0,
    "no item labeled like the Workforce nav entry",
  );
});
