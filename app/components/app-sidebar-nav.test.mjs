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
