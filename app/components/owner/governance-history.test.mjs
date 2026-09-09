// PHASE OWNER-UI (Slice 3) — render test for the /admin/owner governance
// history section. AdminRoster-style: renders GovernanceHistory (a plain
// server component — no hooks) to static markup and asserts the
// presentation contract: localized action sentences, resolved
// actor/target identity (name -> email -> neutral fallback), empty state,
// and — critically — that NO raw userId / UUID reaches the markup.
//
// Run with: npx tsx --test --experimental-test-module-mocks components/owner/governance-history.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// GovernanceHistory imports the "use server" wrapper only for its TYPE.
mock.module("@/lib/actions/workforce-admin-ui", { namedExports: {} });

const { GovernanceHistory } = await import("./governance-history.tsx");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const rows = [
  {
    action: "owner.admin_demoted",
    actorName: "Arnold Fogang",
    actorEmail: "arnold@example.com",
    targetName: "Hermann Djousse",
    targetEmail: "hermann@example.com",
    previousRole: "ADMIN",
    newRole: "MANAGER",
    previousStatus: null,
    newStatus: null,
    at: "2026-09-09T18:42:00.000Z",
  },
  {
    action: "owner.admin_suspended",
    actorName: null,
    actorEmail: "owner@example.com", // name missing -> email
    targetName: null,
    targetEmail: null, // both missing -> neutral fallback
    previousRole: null,
    newRole: null,
    previousStatus: "ACTIVE",
    newStatus: "SUSPENDED",
    at: "2026-09-08T09:00:00.000Z",
  },
];

test("GovernanceHistory: renders localized action sentences (FR)", () => {
  const html = renderToStaticMarkup(createElement(GovernanceHistory, { rows, locale: "fr" }));
  assert.match(html, /Historique de gouvernance/);
  assert.match(html, /Administrateur rétrogradé vers Manager/); // demote wording from newRole
  assert.match(html, /Administrateur suspendu/);
});

test("GovernanceHistory: resolves identity name -> email -> neutral fallback", () => {
  const html = renderToStaticMarkup(createElement(GovernanceHistory, { rows, locale: "fr" }));
  assert.match(html, /Hermann Djousse/); // target name
  assert.match(html, /Effectué par Arnold Fogang/); // actor name
  assert.match(html, /Effectué par owner@example\.com/); // actor: name missing -> email
  assert.match(html, /—/); // target: name+email missing -> neutral fallback
});

test("GovernanceHistory: NEVER renders a raw userId / UUID", () => {
  const html = renderToStaticMarkup(createElement(GovernanceHistory, { rows, locale: "fr" }));
  assert.equal(html.includes(UUID_A), false);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(html), false, "a UUID-shaped string leaked into the markup");
});

test("GovernanceHistory: empty -> clean empty state, no list", () => {
  const html = renderToStaticMarkup(createElement(GovernanceHistory, { rows: [], locale: "fr" }));
  assert.match(html, /Aucun évènement de gouvernance récent\./);
  assert.equal(html.includes("<ul"), false, "no list is rendered when there is nothing to show");
});

test("GovernanceHistory: EN locale -> EN title + sentences", () => {
  const html = renderToStaticMarkup(createElement(GovernanceHistory, { rows, locale: "en" }));
  assert.match(html, /Governance history/);
  assert.match(html, /Administrator demoted to Manager/);
  assert.match(html, /Administrator suspended/);
  assert.match(html, /Performed by Arnold Fogang/);
});
