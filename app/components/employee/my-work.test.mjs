// PHASE EMPLOYEE-OPS (Slice 2 / Slice 3) — render tests for the
// components/employee/* sections of /admin/crm/my-work. Every section is a
// plain server component (no hooks); the ONLY client island
// (my-work-actions.tsx: ClaimProspectButton / MyFollowUpActions) is stubbed
// here at the module boundary — it has its own focused test
// (components/employee/my-work-actions.test.mjs).
//
// Load-bearing contract asserted for ALL sections:
//   - NO UUID reaches the markup as VISIBLE TEXT, ever;
//   - the ONLY place a UUID may appear at all is inside an href to the
//     canonical, self-guarded /admin/crm/clients/[id] route (mission §11) —
//     the "add a follow-up" / "add an interaction" deep links. Everywhere
//     else stays strictly id-free (name-based /admin/crm/clients?q= links).
//   - counts / groups / empty states / FR+EN labels are correct.
//
// Run with: npx tsx --test --experimental-test-module-mocks components/employee/my-work.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The single client island — stubbed so the server sections render without
// a Next.js request context (useRouter / useTransition).
mock.module("@/components/employee/my-work-actions", {
  namedExports: {
    ClaimProspectButton: () => null,
    MyFollowUpActions: () => null,
  },
});

const { MyWorkSummary } = await import("./my-work-summary.tsx");
const { MyToday } = await import("./my-today.tsx");
const { MyProspects } = await import("./my-prospects.tsx");
const { MyFollowUps } = await import("./my-follow-ups.tsx");
const { MyTasks } = await import("./my-tasks.tsx");
const { MyRecentInteractions } = await import("./my-recent-interactions.tsx");
const { AvailableProspects } = await import("./available-prospects.tsx");

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const U = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

const CID1 = U("1");
const CID2 = U("2");
const TID1 = U("a");
const TID2 = U("b");
const TID3 = U("c");
const IID1 = U("d");

const render = (Comp, props, locale) => renderToStaticMarkup(createElement(Comp, { ...props, locale }));

/** Strip the value of every `/admin/crm/clients/<id>[#anchor]` href — the
 * one sanctioned place an id may appear — then assert nothing UUID-shaped
 * is left anywhere in the markup. */
const CLIENT_DETAIL_HREF_RE = /\/admin\/crm\/clients\/[0-9a-f-]{36}(?:#[a-z-]+)?/gi;
const noUuid = (html) =>
  assert.equal(UUID_RE.test(html.replace(CLIENT_DETAIL_HREF_RE, "/admin/crm/clients/_")), false, "a UUID-shaped string leaked outside a client-detail href");

/** Visible text only (tags stripped) — a UUID must NEVER be here. */
const visibleText = (html) => html.replace(/<[^>]*>/g, " ");
const noUuidVisible = (html) => assert.equal(UUID_RE.test(visibleText(html)), false, "a UUID-shaped string was rendered as visible text");

// ---------------- MyWorkSummary ----------------
const counts = {
  assignedProspects: 4,
  followUpsOverdue: 2,
  followUpsDueToday: 1,
  followUpsUpcoming: 3,
  openTasks: 5,
  prospectsWithoutFollowUp: 2,
};

test("MyWorkSummary: renders all six counters (FR)", () => {
  const html = render(MyWorkSummary, { counts }, "fr");
  assert.match(html, /Mes prospects/);
  assert.match(html, /Relances en retard/);
  assert.match(html, /Relances aujourd\S*hui/);
  assert.match(html, /Relances à venir/);
  assert.match(html, /Tâches ouvertes/);
  assert.match(html, /Prospects sans relance/);
  for (const v of [4, 2, 1, 3, 5]) assert.ok(html.includes(`>${v}</p>`), `expected the counter value ${v}`);
  noUuid(html);
});

test("MyWorkSummary: EN labels", () => {
  const html = render(MyWorkSummary, { counts }, "en");
  assert.match(html, /Overdue follow-ups/);
  assert.match(html, /Open tasks/);
});

// ---------------- MyFollowUps ----------------
const followUps = {
  overdue: [
    { taskId: TID1, title: "Rappeler le gérant", clientId: CID1, clientName: "Boulangerie Lefèvre", dueAt: "2026-09-01T09:00:00.000Z", status: "todo", bucket: "overdue" },
  ],
  dueToday: [
    { taskId: TID2, title: "Envoyer le devis", clientId: CID2, clientName: "Garage Moreau", dueAt: "2026-09-10T09:00:00.000Z", status: "in_progress", bucket: "due-today" },
  ],
  upcoming: [
    { taskId: TID3, title: "Relance trimestrielle", clientId: CID1, clientName: "Boulangerie Lefèvre", dueAt: "2026-10-01T09:00:00.000Z", status: "todo", bucket: "upcoming" },
  ],
};

test("MyFollowUps: three groups with counts + titles + client links (FR)", () => {
  const html = render(MyFollowUps, { groups: followUps }, "fr");
  assert.match(html, /Mes relances/);
  assert.match(html, /En retard · 1/);
  assert.match(html, /Aujourd\S*hui · 1/);
  assert.match(html, /À venir · 1/);
  assert.match(html, /Rappeler le gérant/);
  assert.match(html, /href="\/admin\/crm\/clients\?q=Boulangerie/);
  noUuid(html);
  noUuidVisible(html);
});

test("MyFollowUps: empty -> single empty line, no group headings", () => {
  const html = render(MyFollowUps, { groups: { overdue: [], dueToday: [], upcoming: [] } }, "fr");
  assert.match(html, /Aucune relance ouverte\./);
  assert.equal(html.includes("En retard ·"), false);
  noUuid(html);
});

test("MyFollowUps: EN headings", () => {
  const html = render(MyFollowUps, { groups: followUps }, "en");
  assert.match(html, /My follow-ups/);
  assert.match(html, /Overdue · 1/);
  assert.match(html, /Today · 1/);
  assert.match(html, /Upcoming · 1/);
});

// ---------------- MyToday ----------------
const openTasks = [
  { taskId: TID1, title: "Tâche en retard", clientId: CID1, clientName: "Boulangerie Lefèvre", dueAt: "2026-09-02T09:00:00.000Z", status: "todo", bucket: "overdue" },
  { taskId: TID2, title: "Tâche du jour", clientId: null, clientName: null, dueAt: "2026-09-10T09:00:00.000Z", status: "todo", bucket: "due-today" },
  { taskId: TID3, title: "Tâche future", clientId: CID2, clientName: "Garage Moreau", dueAt: "2026-12-01T09:00:00.000Z", status: "todo", bucket: "upcoming" },
];

test("MyToday: only overdue + due-today items appear, upcoming excluded (FR)", () => {
  const html = render(MyToday, { followUps, openTasks }, "fr");
  assert.match(html, /À faire aujourd\S*hui/);
  assert.match(html, /Rappeler le gérant/); // overdue follow-up
  assert.match(html, /Envoyer le devis/); // due-today follow-up
  assert.match(html, /Tâche en retard/); // overdue task
  assert.match(html, /Tâche du jour/); // due-today task
  assert.equal(html.includes("Tâche future"), false, "upcoming task must not appear in today");
  assert.equal(html.includes("Relance trimestrielle"), false, "upcoming follow-up must not appear in today");
  noUuid(html);
  noUuidVisible(html);
});

test("MyToday: nothing due -> empty state", () => {
  const html = render(
    MyToday,
    { followUps: { overdue: [], dueToday: [], upcoming: followUps.upcoming }, openTasks: [openTasks[2]] },
    "fr",
  );
  assert.match(html, /Rien d\S*urgent pour aujourd\S*hui\./);
  noUuid(html);
});

// ---------------- MyProspects ----------------
const prospects = [
  { clientId: CID1, name: "Boulangerie Lefèvre", stage: "prospect", needsFollowUp: false, nextFollowUpDueAt: "2026-09-20T09:00:00.000Z" },
  { clientId: CID2, name: "Garage Moreau", stage: "lead", needsFollowUp: true, nextFollowUpDueAt: null },
];

test("MyProspects: table rows + stage labels + missing-follow-up tag + gap callout (FR)", () => {
  const html = render(MyProspects, { prospects, withoutFollowUp: [prospects[1]] }, "fr");
  assert.match(html, /Mes prospects/);
  assert.match(html, /Boulangerie Lefèvre/);
  assert.match(html, /Garage Moreau/);
  assert.match(html, />Prospect</); // stage badge label
  assert.match(html, />Lead</);
  assert.match(html, /Aucune relance/); // noNextFollowUp tag for Garage Moreau
  assert.match(html, /Prospects sans prochaine relance/);
  noUuidVisible(html);
  noUuid(html);
});

test("MyProspects: Slice-3 deep links land on the canonical client-detail route (FR)", () => {
  const html = render(MyProspects, { prospects, withoutFollowUp: [prospects[1]] }, "fr");
  // add-interaction shortcut, per assigned row -> /admin/crm/clients/<id>
  assert.match(html, /Ajouter une interaction/);
  assert.match(html, new RegExp(`href="/admin/crm/clients/${CID1}"`));
  // add-follow-up shortcut -> /admin/crm/clients/<id>#suivis (row + gap callout)
  assert.match(html, /Ajouter une relance/);
  assert.match(html, new RegExp(`href="/admin/crm/clients/${CID2}#suivis"`));
  // the ONLY uuids present are inside those client-detail hrefs
  const stripped = html.replace(CLIENT_DETAIL_HREF_RE, "/admin/crm/clients/_");
  assert.equal(UUID_RE.test(stripped), false);
  noUuidVisible(html);
});

test("MyProspects: no assigned prospects -> empty state, gap callout still shows its own empty line", () => {
  const html = render(MyProspects, { prospects: [], withoutFollowUp: [] }, "fr");
  assert.match(html, /Aucun prospect ne vous est attribué\./);
  assert.match(html, /Tous vos prospects ont une prochaine relance\./);
  noUuid(html);
});

test("MyProspects: EN labels", () => {
  const html = render(MyProspects, { prospects, withoutFollowUp: [] }, "en");
  assert.match(html, /My prospects/);
  assert.match(html, /Next follow-up/);
  assert.match(html, /Add an interaction/);
});

// ---------------- MyTasks ----------------
test("MyTasks: standalone task renders a dash for prospect + status badge (FR)", () => {
  const html = render(MyTasks, { tasks: openTasks }, "fr");
  assert.match(html, /Mes tâches/);
  assert.match(html, /Tâche du jour/);
  assert.match(html, /—/); // standalone task, no client
  assert.match(html, />À faire</); // task status label
  noUuid(html);
});

test("MyTasks: stays read-only — no action controls, no client island (§15)", () => {
  const html = render(MyTasks, { tasks: openTasks }, "fr");
  assert.equal(html.includes("<button"), false, "Mes tâches must not expose mutation controls");
  assert.equal(html.includes("<form"), false);
});

test("MyTasks: empty -> empty state", () => {
  const html = render(MyTasks, { tasks: [] }, "fr");
  assert.match(html, /Aucune tâche ouverte\./);
  noUuid(html);
});

// ---------------- MyRecentInteractions ----------------
const interactions = [
  { interactionId: IID1, clientId: CID1, clientName: "Boulangerie Lefèvre", type: "call", summary: "Point sur la proposition commerciale.", occurredAt: "2026-09-09T14:30:00.000Z" },
];

test("MyRecentInteractions: type label + client link + summary (FR)", () => {
  const html = render(MyRecentInteractions, { interactions }, "fr");
  assert.match(html, /Activité récente/);
  assert.match(html, /Appel/); // interaction type label (fr)
  assert.match(html, /Point sur la proposition commerciale\./);
  assert.match(html, /href="\/admin\/crm\/clients\?q=Boulangerie/);
  noUuid(html);
  noUuidVisible(html);
});

test("MyRecentInteractions: empty -> empty state", () => {
  const html = render(MyRecentInteractions, { interactions: [] }, "fr");
  assert.match(html, /Aucune activité récente\./);
  noUuid(html);
});

test("MyRecentInteractions: EN type label", () => {
  const html = render(MyRecentInteractions, { interactions }, "en");
  assert.match(html, /Recent activity/);
  assert.match(html, /Call/);
});

// ---------------- AvailableProspects ----------------
const claimable = [
  { clientId: CID1, name: "Institut Beauté Zen", stage: "lead", createdAt: "2026-09-05T09:00:00.000Z" },
];

test("AvailableProspects: list + link to RADAR; claim affordance is the stubbed island (FR)", () => {
  const html = render(AvailableProspects, { prospects: claimable }, "fr");
  assert.match(html, /Prospects disponibles/);
  assert.match(html, /Institut Beauté Zen/);
  assert.match(html, /href="\/admin\/crm\/radar"/);
  // the section itself authors no form; the claim button lives in the
  // separately-tested my-work-actions island (stubbed to null here).
  assert.equal(html.includes("<form"), false, "the available list authors no form");
  noUuid(html);
  noUuidVisible(html);
});

test("AvailableProspects: empty -> empty state, RADAR link still present", () => {
  const html = render(AvailableProspects, { prospects: [] }, "fr");
  assert.match(html, /Aucun prospect disponible à attribuer\./);
  assert.match(html, /href="\/admin\/crm\/radar"/);
  noUuid(html);
});

test("AvailableProspects: EN labels", () => {
  const html = render(AvailableProspects, { prospects: claimable }, "en");
  assert.match(html, /Available prospects/);
  assert.match(html, /Open Radar/);
});
