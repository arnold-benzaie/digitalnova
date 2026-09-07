// app/admin/crm/tasks/tasks-page.test.mjs — PHASE RADAR-CORE-3D
// structured follow-up awareness on the global /admin/crm/tasks workspace.
//
// This server page runs DB queries, so a full render test would need a DB
// harness. Instead:
//   - the row classification + the type-filter sanitizer are pure and are
//     unit-tested directly against ./task-row-type.ts;
//   - the branch rendering (which row class shows what), the type-filter
//     predicate, the batched owner resolver, and the pagination math are
//     asserted structurally against the page source, slicing between the
//     `// FOLLOW-UP ROW` and `// GENERIC TASK ROW` comment markers so a
//     reversed branch cannot pass.
//
// NOT wired into package.json's `test` list — run with:
//   npx tsx --test app/admin/crm/tasks/tasks-page.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { isFollowUpTaskRow, sanitizeTaskTypeFilter } = await import("./task-row-type.ts");

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
const CRM_I18N = readFileSync(
  fileURLToPath(new URL("../../../../lib/i18n/dictionaries/crm.ts", import.meta.url)),
  "utf8",
);

const FU_MARK = PAGE_SRC.indexOf("// FOLLOW-UP ROW");
const GEN_MARK = PAGE_SRC.indexOf("// GENERIC TASK ROW");
const FU_BRANCH = PAGE_SRC.slice(FU_MARK, GEN_MARK);
const GEN_BRANCH = PAGE_SRC.slice(GEN_MARK, PAGE_SRC.indexOf("})}", GEN_MARK));

// ============================ classification (pure) ============================

test("3D-C1. client non-null + due non-null -> FOLLOW-UP", () => {
  assert.equal(isFollowUpTaskRow({ clientId: "c1", dueDate: new Date("2026-09-01T00:00:00Z") }), true);
});

test("3D-C2. client null + due non-null (G2) -> GENERIC", () => {
  assert.equal(isFollowUpTaskRow({ clientId: null, dueDate: new Date("2026-09-01T00:00:00Z") }), false);
});

test("3D-C3. client non-null + due null (G3) -> GENERIC", () => {
  assert.equal(isFollowUpTaskRow({ clientId: "c1", dueDate: null }), false);
});

test("3D-C4. client null + due null (G1) -> GENERIC", () => {
  assert.equal(isFollowUpTaskRow({ clientId: null, dueDate: null }), false);
});

test("3D-C5. classification is status-independent — the helper neither accepts nor inspects status", () => {
  // A done/cancelled client+dated fixture is still a follow-up: the helper
  // signature is { clientId, dueDate } only.
  assert.equal(isFollowUpTaskRow({ clientId: "c1", dueDate: new Date() }), true);
  const src = readFileSync(fileURLToPath(new URL("./task-row-type.ts", import.meta.url)), "utf8");
  assert.ok(!/status/.test(src.split("export type TaskTypeFilter")[0]), "isFollowUpTaskRow body never references status");
});

// ============================ sanitizer (pure) ============================

test("3D-S1. sanitizeTaskTypeFilter: known values pass through", () => {
  assert.equal(sanitizeTaskTypeFilter("all"), "all");
  assert.equal(sanitizeTaskTypeFilter("followup"), "followup");
  assert.equal(sanitizeTaskTypeFilter("task"), "task");
});

test("3D-S2. sanitizeTaskTypeFilter: anything else -> 'all'", () => {
  for (const v of [undefined, "", "bogus", "Followup", "FOLLOWUP", "followup; DROP TABLE tasks", "task ", "all "]) {
    assert.equal(sanitizeTaskTypeFilter(v), "all", `${JSON.stringify(v)} -> all`);
  }
});

// ============================ type-filter predicate (structural) ============================

test("3D-T1. type=followup predicate = and(isNotNull(clientId), isNotNull(dueDate)) — status-independent", () => {
  assert.match(
    PAGE_SRC,
    /type === "followup"\)\s*conditions\.push\(and\(isNotNull\(tasks\.clientId\), isNotNull\(tasks\.dueDate\)\)\)/,
  );
  const fuPredicate = PAGE_SRC.slice(PAGE_SRC.indexOf('type === "followup"'), PAGE_SRC.indexOf('type === "task"'));
  assert.ok(!/tasks\.status/.test(fuPredicate), "the followup type predicate must not reference tasks.status");
});

test("3D-T2. type=task predicate = or(isNull(clientId), isNull(dueDate)) — De Morgan complement", () => {
  assert.match(
    PAGE_SRC,
    /type === "task"\)\s*conditions\.push\(or\(isNull\(tasks\.clientId\), isNull\(tasks\.dueDate\)\)\)/,
  );
});

test("3D-T3. no raw SQL / token interpolation in the type predicate", () => {
  const block = PAGE_SRC.slice(PAGE_SRC.indexOf("const conditions"), PAGE_SRC.indexOf("const whereClause"));
  assert.ok(!/sql`/.test(block), "type filter uses Drizzle predicates, not sql``");
  assert.ok(!/\$\{type\}/.test(block), "the raw type token is never interpolated");
});

test("3D-T4. type predicate flows into the shared whereClause -> paginated query AND filtered count", () => {
  // `whereClause` is built from `conditions` (which now includes the type
  // predicate) and is passed to both the page query and the filtered
  // count(*); the overall/unfiltered count keeps NO whereClause.
  assert.match(PAGE_SRC, /const whereClause = conditions\.length \? and\(\.\.\.conditions\) : undefined/);
  const fromTasks = [...PAGE_SRC.matchAll(/\.from\(tasks\)\s*\n?\s*\.where\(whereClause\)/g)];
  assert.ok(fromTasks.length >= 2, "both the page query and the filtered count use whereClause");
  assert.match(PAGE_SRC, /count\(\*\)::int` }\)\.from\(tasks\),\n\s*\]\);/, "the overall count keeps no whereClause");
});

// ============================ branch structure ============================

test("3D-B1. both branch markers exist and are ordered follow-up then generic", () => {
  assert.ok(FU_MARK !== -1 && GEN_MARK !== -1);
  assert.ok(FU_MARK < GEN_MARK, "the ternary truthy branch (isFollowUpTaskRow) is the FOLLOW-UP branch");
  assert.match(PAGE_SRC, /return isFollowUpTaskRow\(task\) \? \(/);
});

test("3D-B2. FOLLOW-UP branch: type Badge, structured owner, read-only status Badge, Edit + Delete, NO InlineStatusSelect / FollowUpActions", () => {
  assert.match(FU_BRANCH, /<Badge label=\{tFollowUp\.typeFollowUp\}/, "Follow-up type Badge");
  assert.match(FU_BRANCH, /followUpOwnerLabel\(task\.assignedUserId\)/, "structured owner label");
  assert.match(FU_BRANCH, /\{tFollowUp\.owner\}:/, "follow-up owner label prefix");
  assert.match(FU_BRANCH, /<Badge label=\{taskStatusLabel\[task\.status\] \?\? task\.status\} className=\{TASK_STATUS_CLASS\[task\.status\] \?\? ""\}/, "read-only status Badge");
  assert.match(FU_BRANCH, /<EditTaskForm task=\{task\}/);
  assert.match(FU_BRANCH, /<DeleteTaskButton id=\{task\.id\}/);
  // The client link lives in the shared `clientCell` (computed once before
  // the ternary); the follow-up branch renders it via {clientCell}. Assert
  // the branch consumes it AND that clientCell itself links to the detail
  // page.
  assert.match(FU_BRANCH, /\{clientCell\}/, "follow-up branch renders the shared client cell");
  assert.match(
    PAGE_SRC,
    /const clientCell = task\.clientId \? \(\s*<Link href=\{`\/admin\/crm\/clients\/\$\{task\.clientId\}`\}/,
    "clientCell links to the prospect detail page",
  );
  assert.ok(!/<InlineStatusSelect/.test(FU_BRANCH), "follow-up row has NO InlineStatusSelect");
  assert.ok(!/FollowUpActions/.test(FU_BRANCH), "follow-up row has NO FollowUpActions");
  assert.ok(!/task\.assignee/.test(FU_BRANCH), "follow-up row never renders the legacy free-text assignee");
});

test("3D-B3. GENERIC branch: type Badge, legacy assignee, InlineStatusSelect, Edit + Delete, NO structured owner / FollowUpActions", () => {
  assert.match(GEN_BRANCH, /<Badge label=\{tFollowUp\.typeTask\}/, "Task type Badge");
  assert.match(GEN_BRANCH, /\{task\.assignee \? ` · \$\{task\.assignee\}` : ""\}/, "legacy free-text assignee preserved");
  assert.match(GEN_BRANCH, /<InlineStatusSelect value=\{task\.status\} options=\{taskStatusOptions\} action=\{updateTaskStatus\.bind\(null, task\.id\)\}/, "InlineStatusSelect preserved verbatim");
  assert.match(GEN_BRANCH, /<EditTaskForm task=\{task\}/);
  assert.match(GEN_BRANCH, /<DeleteTaskButton id=\{task\.id\}/);
  assert.ok(!/followUpOwnerLabel|followUpAssigneeById/.test(GEN_BRANCH), "generic row has NO structured owner display");
  assert.ok(!/tFollowUp\.owner/.test(GEN_BRANCH), "generic row has NO follow-up owner label");
  assert.ok(!/FollowUpActions/.test(GEN_BRANCH), "generic row has NO FollowUpActions");
});

test("3D-B4. G2 preservation — due date rendered once, shared by both branches (clientless + dated keeps its date)", () => {
  // The dueCell is computed before the ternary, so a generic G2 row
  // (clientId null, dueDate non-null) still shows the formatted due date.
  assert.match(PAGE_SRC, /const dueCell = task\.dueDate \? ` · \$\{t\.duePrefix\} \$\{formatDate\(task\.dueDate, locale\)\}` : ""/);
  assert.match(GEN_BRANCH, /\{dueCell\}/, "generic branch renders the shared dueCell");
  assert.match(FU_BRANCH, /\{dueCell\}/, "follow-up branch renders the shared dueCell");
});

test("3D-B5. no FollowUpActions import, no Axis-C capability additions (Option B)", () => {
  assert.ok(!/follow-up-actions/.test(PAGE_SRC), "does not import components/crm/follow-up-actions");
  assert.ok(!/FollowUpActions/.test(PAGE_SRC), "does not render <FollowUpActions>");
  assert.ok(!/requireSession|getRadarCapabilities|listAssignableRadarMembers/.test(PAGE_SRC), "no Axis-C capability/session/picker resolution added");
  assert.match(PAGE_SRC, /await requireStaffRole\(\);/, "gate stays requireStaffRole()");
});

// ============================ structured-owner batch ============================

test("3D-O1. owner ids collected ONLY from follow-up rows (isFollowUpTaskRow), never by dueDate alone", () => {
  assert.match(PAGE_SRC, /allTasks\s*\n?\s*\.filter\(isFollowUpTaskRow\)\s*\n?\s*\.map\(\(task\) => task\.assignedUserId\)/);
  const collectBlock = PAGE_SRC.slice(PAGE_SRC.indexOf("followUpAssigneeIds"), PAGE_SRC.indexOf("followUpAssigneeById ="));
  assert.ok(!/task\.dueDate !== null/.test(collectBlock), "the collector never filters by dueDate alone");
  assert.match(PAGE_SRC, /new Set\(/, "assignee ids are deduped");
});

test("3D-O2. empty-list guard — inArray only runs when there is at least one id", () => {
  assert.match(PAGE_SRC, /if \(followUpAssigneeIds\.length > 0\) \{/);
  assert.match(PAGE_SRC, /inArray\(users\.id, followUpAssigneeIds\)/);
  const idx = PAGE_SRC.indexOf("inArray(users.id, followUpAssigneeIds)");
  const guardIdx = PAGE_SRC.indexOf("if (followUpAssigneeIds.length > 0)");
  assert.ok(guardIdx !== -1 && guardIdx < idx, "the inArray call is inside the length>0 guard");
});

test("3D-O3. one batched owner query, server-resolved internal org, no per-row DB call / N+1", () => {
  assert.match(PAGE_SRC, /await getInternalOrganizationId\(\)/, "internal org resolved server-side");
  assert.ok(!/params\.(organizationId|workspaceOrgId|orgId)/.test(PAGE_SRC), "no caller-supplied org/workspace id");
  const mapBodies = [...PAGE_SRC.matchAll(/allTasks\.map\(\(task\) => \{([\s\S]*?)\n            \}\)\}/g)];
  for (const m of mapBodies) {
    assert.ok(!/await db/.test(m[1]), "no await db inside an allTasks.map row body");
  }
  assert.equal([...PAGE_SRC.matchAll(/\.from\(users\)/g)].length, 1, "exactly one users query");
});

test("3D-O4. owner label fallbacks — Unassigned / name / name + inactiveSuffix / Former user, never a raw id", () => {
  const fn = PAGE_SRC.slice(PAGE_SRC.indexOf("function followUpOwnerLabel"), PAGE_SRC.indexOf("return (\n"));
  assert.match(fn, /if \(!assignedUserId\) return tFollowUp\.unassigned/);
  assert.match(fn, /if \(!info \|\| info\.name === null\) return tFollowUp\.formerUser/);
  assert.match(fn, /return info\.active \? info\.name : `\$\{info\.name\} \$\{tFollowUp\.inactiveSuffix\}`/);
  assert.ok(!/assignedUserId\}`|\$\{assignedUserId\}/.test(fn), "the raw assignedUserId is never returned/interpolated as a label");
});

// ============================ type-filter UI ============================

test("3D-U1. <select name=\"type\"> with all/followup/task options, localized, no open/active wording", () => {
  assert.match(PAGE_SRC, /<select name="type" defaultValue=\{type === "all" \? "" : type\}/);
  assert.match(PAGE_SRC, /<option value="">\{tFollowUp\.typeAll\}<\/option>/);
  assert.match(PAGE_SRC, /<option value="followup">\{tFollowUp\.typeFollowUps\}<\/option>/);
  assert.match(PAGE_SRC, /<option value="task">\{tFollowUp\.typeTasks\}<\/option>/);
  assert.match(PAGE_SRC, /aria-label=\{tFollowUp\.typeFilterLabel\}/);
});

test("3D-U2. hasFilters accounts for a non-all type; buildHref preserves type via Params; reset clears everything", () => {
  assert.match(PAGE_SRC, /const hasFilters = Boolean\(q \|\| status \|\| type !== "all"\)/);
  assert.match(PAGE_SRC, /type Params = \{ q\?: string; status\?: string; type\?: string; page\?: string \}/, "type is a Params key so buildHref carries it");
  assert.match(PAGE_SRC, /<a href="\/admin\/crm\/tasks" className="text-xs text-pm-gris underline">\{t\.reset\}<\/a>/, "reset link clears all params");
});

// ============================ pagination unchanged ============================

test("3D-P1. pagination math unchanged", () => {
  assert.match(PAGE_SRC, /const PAGE_SIZE = 20;/);
  assert.match(PAGE_SRC, /\.limit\(PAGE_SIZE\)\s*\n?\s*\.offset\(\(page - 1\) \* PAGE_SIZE\)/);
  assert.match(PAGE_SRC, /const totalPages = Math\.max\(1, Math\.ceil\(totalCount \/ PAGE_SIZE\)\);/);
  assert.match(PAGE_SRC, /page: page > 1 \? String\(page - 1\) : undefined/);
  assert.match(PAGE_SRC, /page: page < totalPages \? String\(page \+ 1\) : undefined/);
});

// ============================ i18n ============================

const FU_KEYS = [
  "owner",
  "unassigned",
  "inactiveSuffix",
  "formerUser",
  "typeFollowUp",
  "typeTask",
  "typeFilterLabel",
  "typeAll",
  "typeFollowUps",
  "typeTasks",
];

test("3D-I1. crm.tasks.followUp exists in FR and EN with identical 10-key sets", () => {
  const blocks = [...CRM_I18N.matchAll(/followUp: \{([\s\S]*?)\n      \},/g)]
    .map((m) => [...m[1].matchAll(/^\s+([a-zA-Z]+):/gm)].map((x) => x[1]).sort());
  // The 3C crm.clientDetail.followUp block also matches this pattern; filter
  // to the two blocks whose keys equal the 3D set.
  const taskBlocks = blocks.filter((keys) => keys.length === FU_KEYS.length && keys.every((k) => FU_KEYS.includes(k)));
  assert.equal(taskBlocks.length, 2, "one FR + one EN crm.tasks.followUp block");
  assert.deepEqual(taskBlocks[0], [...FU_KEYS].sort());
  assert.deepEqual(taskBlocks[0], taskBlocks[1], "FR and EN key sets are identical");
});

test("3D-I2. every crm.tasks.followUp key is referenced by page.tsx", () => {
  for (const k of FU_KEYS) {
    assert.ok(PAGE_SRC.includes(`tFollowUp.${k}`), `tFollowUp.${k} is used by the page`);
  }
});

test("3D-I3. no 'open' / 'active' wording in the type-filter labels (FR + EN)", () => {
  // Pull just the four type-filter label VALUES from every crm.tasks.followUp
  // block (identified by the presence of `typeFollowUps:`), then assert none
  // of them contain a whole word "open" / "active" / "ouvert" / "actif".
  const blocks = [...CRM_I18N.matchAll(/followUp: \{([\s\S]*?)\n      \},/g)]
    .map((m) => m[1])
    .filter((body) => /typeFollowUps:/.test(body));
  assert.equal(blocks.length, 2, "one FR + one EN crm.tasks.followUp block");
  const BANNED = /\b(open|active|ouvert|actif|ouverte)\b/i;
  for (const body of blocks) {
    for (const key of ["typeFilterLabel", "typeAll", "typeFollowUps", "typeTasks"]) {
      const m = body.match(new RegExp(`${key}: "([^"]+)"`));
      assert.ok(m, `${key} present`);
      assert.ok(!BANNED.test(m[1]), `${key} = "${m[1]}" must not use open/active wording`);
    }
  }
});
