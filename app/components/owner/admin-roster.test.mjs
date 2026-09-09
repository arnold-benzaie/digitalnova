// PHASE OWNER-UI (Slice 2) — render test for the /admin/owner ADMIN roster.
// Renders AdminRoster (a plain server component — no hooks) to static
// markup with the client lifecycle island stubbed, and asserts the
// presentation contract: the three status sections, the displayed columns,
// empty states, and — critically — that NO raw userId UUID reaches the
// markup (only email / name / status / date are shown).
//
// Run with: npx tsx --test --experimental-test-module-mocks components/owner/admin-roster.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Stub the client island (it uses useTransition/useRouter which
// renderToStaticMarkup cannot run) and the "use server" wrapper it imports.
mock.module("@/components/owner/admin-lifecycle-actions", {
  namedExports: {
    AdminLifecycleActions: ({ status }) => createElement("span", { "data-actions-for": status }, "actions"),
  },
});
mock.module("@/lib/actions/workforce-admin-ui", { namedExports: {} });

const { AdminRoster } = await import("./admin-roster.tsx");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

const rows = [
  { userId: UUID_A, fullName: "Alice Active", email: "alice@example.com", status: "ACTIVE", joinedAt: "2026-01-02T10:00:00.000Z", invitedByEmail: "owner@example.com" },
  { userId: UUID_B, fullName: null, email: "bob@example.com", status: "SUSPENDED", joinedAt: "2026-02-03T11:00:00.000Z", invitedByEmail: null },
  { userId: UUID_C, fullName: "Carol Gone", email: "carol@example.com", status: "OFFBOARDING", joinedAt: "2026-03-04T12:00:00.000Z", invitedByEmail: "alice@example.com" },
];

test("AdminRoster: renders the three status sections with the right members", () => {
  const html = renderToStaticMarkup(createElement(AdminRoster, { rows, locale: "fr" }));
  assert.match(html, /Administrateurs actifs/);
  assert.match(html, /Administrateurs suspendus/);
  assert.match(html, /Administrateurs en départ/);
  assert.match(html, /alice@example\.com/);
  assert.match(html, /bob@example\.com/);
  assert.match(html, /carol@example\.com/);
  // status labels
  assert.match(html, /Actif/);
  assert.match(html, /Suspendu/);
  assert.match(html, /Départ en cours/);
  // "added by" shown for A and C, neutral fallback for B
  assert.match(html, /owner@example\.com/);
});

test("AdminRoster: NEVER renders a raw userId / UUID", () => {
  const html = renderToStaticMarkup(createElement(AdminRoster, { rows, locale: "fr" }));
  for (const id of [UUID_A, UUID_B, UUID_C]) {
    assert.equal(html.includes(id), false, `raw userId leaked into the markup: ${id}`);
  }
  // no generic uuid anywhere
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(html), false, "a UUID-shaped string leaked into the markup");
});

test("AdminRoster: ACTIVE + SUSPENDED rows get the lifecycle island; OFFBOARDING does not", () => {
  const html = renderToStaticMarkup(createElement(AdminRoster, { rows, locale: "fr" }));
  assert.match(html, /data-actions-for="ACTIVE"/);
  assert.match(html, /data-actions-for="SUSPENDED"/);
  assert.equal(html.includes('data-actions-for="OFFBOARDING"'), false, "OFFBOARDING rows are terminal — no lifecycle island");
});

test("AdminRoster: empty roster -> clean empty states in every section, no table", () => {
  const html = renderToStaticMarkup(createElement(AdminRoster, { rows: [], locale: "fr" }));
  assert.match(html, /Aucun administrateur actif\./);
  assert.match(html, /Aucun administrateur suspendu\./);
  assert.match(html, /Aucun administrateur en départ\./);
  assert.equal(html.includes("<table"), false, "no table is rendered for an empty section");
});

test("AdminRoster: English locale renders English section headings", () => {
  const html = renderToStaticMarkup(createElement(AdminRoster, { rows, locale: "en" }));
  assert.match(html, /Active administrators/);
  assert.match(html, /Suspended administrators/);
  assert.match(html, /Offboarding administrators/);
});
