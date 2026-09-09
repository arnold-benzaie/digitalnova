// lib/actions/employee-work.integration.test.mjs — disposable-Postgres proof
// of PHASE EMPLOYEE-OPS Slice 1: getMyWork() in lib/actions/employee-work.ts.
//
// Proves the read model is (a) gated by requireStaffMember("RADAR_WORK"),
// (b) scoped ENTIRELY to the authenticated session user — one employee
// never sees another's assigned prospects / follow-ups / tasks /
// interactions — (c) takes no parameter through which a user/workspace
// could be selected, (d) buckets follow-ups overdue / due-today / upcoming
// correctly, (e) surfaces claimable unassigned prospects.
//
// Same harness as the workforce tests: real @/db + real
// requireStaffMember; only @/lib/session and @/lib/notifications mocked.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/employee-work.integration.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

const APP_DIR = "/Users/arnoldbenzaie/Documents/projects.md/digitalnova/.claude/worktrees/chantier1-phase2-quote-public-page/app";
const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

async function startDisposablePostgres(namePrefix) {
  const container = `pm-${namePrefix}-${randomUUID().slice(0, 8)}`;
  const port = 5900 + Math.floor(Math.random() * 90);
  const user = "emp_work";
  const password = "emp_work_local_only";
  const db = "emp_work_check";
  const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${db}`;
  if (/supabase|neon|pooler/i.test(url) || !/@127\.0\.0\.1:/.test(url)) throw new Error("REFUS : cible non locale.");
  if (sh("docker", ["info"], { stdio: "ignore" }).status !== 0) throw new Error("Docker indisponible.");
  const runc = sh("docker", [
    "run", "-d", "--rm", "--name", container,
    "-e", `POSTGRES_USER=${user}`, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${db}`,
    "-p", `127.0.0.1:${port}:5432`, "postgres:16-alpine",
  ]);
  if (runc.status !== 0) throw new Error(`docker run a echoue : ${runc.stderr}`);
  const pool = new Pool({ connectionString: url });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { await pool.query("select 1"); ready = true; } catch { await sleep(500); }
  }
  if (!ready) throw new Error("Postgres jetable jamais pret.");
  return { url, pool, stop: async () => { await pool.end().catch(() => {}); sh("docker", ["rm", "-f", container], { stdio: "ignore" }); } };
}

test("EMPLOYEE-OPS Slice 1: getMyWork() is session-scoped, RADAR_WORK-gated, and buckets follow-ups", async () => {
  const { url, pool, stop } = await startDisposablePostgres("emp-work");
  try {
    const dbMigrate = await import(`${APP_DIR}/scripts/db-migrate.mjs`);
    const applied = await dbMigrate.run({ argv: ["--apply", "--db-url", url], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
    assert.equal(applied.ok, true, `migration apply failed: ${JSON.stringify(applied)}`);

    const orgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);

    const seedUser = async (email) => {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [id, `clerk_${id}`, email]);
      return id;
    };
    const roleId = Object.fromEntries((await pool.query("select id, name from staff_roles")).rows.map((r) => [r.name, r.id]));

    const empA = await seedUser("emp-a@example.com");
    const empB = await seedUser("emp-b@example.com");
    const mgr = await seedUser("mgr@example.com");
    const clientOnly = await seedUser("client-only@example.com");
    for (const [uid, rid] of [[empA, roleId.EMPLOYEE], [empB, roleId.EMPLOYEE], [mgr, roleId.MANAGER]]) {
      await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [uid, orgId, rid]);
    }
    // clientOnly gets a legacy Axis-A client membership but NO staff_members row
    const clientRoleId = (await pool.query("select id from roles where name='client' limit 1")).rows[0]?.id;
    if (clientRoleId) await pool.query("insert into memberships (user_id, organization_id, role_id) values ($1,$2,$3)", [clientOnly, orgId, clientRoleId]);

    // --- prospects ---
    const client = async (name, assignedTo = null) => {
      const id = randomUUID();
      await pool.query("insert into crm_clients (id, name, stage, assigned_user_id) values ($1,$2,'prospect',$3)", [id, name, assignedTo]);
      return id;
    };
    const aP1 = await client("A prospect 1 (has follow-up)", empA);
    await client("A prospect 2 (NO follow-up)", empA);
    const bP1 = await client("B prospect 1", empB);
    await client("Unassigned 1", null);
    await client("Unassigned 2", null);
    // an archived unassigned prospect must NOT be claimable
    const uArch = await client("Unassigned archived", null);
    await pool.query("update crm_clients set archived_at = now() where id = $1", [uArch]);

    // --- follow-ups (client-linked, dated) for A: one overdue, one due today, one upcoming ---
    const followUp = async (clientId, assignedTo, title, dueSql, status = "todo") => {
      const id = randomUUID();
      await pool.query(`insert into tasks (id, client_id, assigned_user_id, title, due_date, status) values ($1,$2,$3,$4,${dueSql},$5)`, [id, clientId, assignedTo, title, status]);
      return id;
    };
    await followUp(aP1, empA, "A overdue follow-up", "now() - interval '2 days'");
    await followUp(aP1, empA, "A due-today follow-up", "now()");
    await followUp(aP1, empA, "A upcoming follow-up", "now() + interval '3 days'");
    await followUp(aP1, empA, "A DONE follow-up (excluded)", "now() - interval '1 day'", "done");
    // B's follow-up — must never appear for A
    await followUp(bP1, empB, "B overdue follow-up", "now() - interval '5 days'");

    // --- a standalone open task (no client) assigned to A ---
    const standaloneA = randomUUID();
    await pool.query("insert into tasks (id, client_id, assigned_user_id, title, due_date, status) values ($1, null, $2, 'A standalone task', null, 'in_progress')", [standaloneA, empA]);
    // a task assigned to B — must never appear for A
    await pool.query("insert into tasks (id, client_id, assigned_user_id, title, status) values ($1, null, $2, 'B task', 'todo')", [randomUUID(), empB]);

    // --- interactions ---
    const interaction = async (clientId, byUser, summary, occurredSql) => {
      await pool.query(`insert into interactions (client_id, type, summary, occurred_at, created_by_user_id) values ($1,'note',$2,${occurredSql},$3)`, [clientId, summary, byUser]);
    };
    await interaction(aP1, empA, "A interaction older", "now() - interval '2 days'");
    await interaction(aP1, empA, "A interaction newest", "now() - interval '1 hour'");
    await interaction(bP1, empB, "B interaction", "now()");
    // a legacy interaction with only free-text created_by (no created_by_user_id) — must NOT count as A's
    await pool.query("insert into interactions (client_id, type, summary, created_by) values ($1,'note','legacy text author', 'Some Name')", [aP1]);

    process.env.DATABASE_URL = url;
    let sessionMockState = { kind: "unauthenticated" };
    mock.module("@/lib/session", {
      namedExports: {
        requireSession: async () => {
          if (sessionMockState.kind === "unauthenticated") {
            const err = new Error("NEXT_REDIRECT");
            err.digest = "NEXT_REDIRECT;replace;/sign-in;307;";
            throw err;
          }
          return { userId: sessionMockState.userId };
        },
      },
    });
    mock.module("@/lib/notifications", {
      namedExports: {
        getInternalOrganizationId: async () => (await pool.query("select id from organizations where is_internal = true limit 1")).rows[0]?.id ?? null,
      },
    });

    const { getMyWork } = await import(`${APP_DIR}/lib/actions/employee-work.ts`);
    const asUser = (u) => { sessionMockState = { kind: "session", userId: u }; };

    // 0. zero parameters — nothing to select a user/workspace with
    assert.equal(getMyWork.length, 0);

    // 1. unauthenticated -> redirect
    sessionMockState = { kind: "unauthenticated" };
    await assert.rejects(() => getMyWork(), /NEXT_REDIRECT/);

    // 2. a caller with NO staff_members row (client) -> redirect (RADAR_WORK denied)
    asUser(clientOnly);
    await assert.rejects(() => getMyWork(), /NEXT_REDIRECT/);

    // 3. EMPLOYEE A — only A's data
    asUser(empA);
    const a = await getMyWork();

    assert.deepEqual(
      a.assignedProspects.map((p) => p.name).sort(),
      ["A prospect 1 (has follow-up)", "A prospect 2 (NO follow-up)"],
      "A sees exactly A's two assigned prospects — never B's",
    );
    const aP1Row = a.assignedProspects.find((p) => p.name.startsWith("A prospect 1"));
    const aP2Row = a.assignedProspects.find((p) => p.name.startsWith("A prospect 2"));
    assert.equal(aP1Row.needsFollowUp, false, "prospect 1 has an open follow-up");
    assert.equal(aP2Row.needsFollowUp, true, "prospect 2 has none");
    assert.ok(aP1Row.nextFollowUpDueAt !== null, "prospect 1 exposes its next follow-up due date");
    assert.deepEqual(a.prospectsWithoutFollowUp.map((p) => p.name), ["A prospect 2 (NO follow-up)"]);

    // follow-up buckets
    assert.deepEqual(a.followUps.overdue.map((f) => f.title), ["A overdue follow-up"]);
    assert.deepEqual(a.followUps.dueToday.map((f) => f.title), ["A due-today follow-up"]);
    assert.deepEqual(a.followUps.upcoming.map((f) => f.title), ["A upcoming follow-up"]);
    assert.ok(!a.followUps.overdue.concat(a.followUps.dueToday, a.followUps.upcoming).some((f) => f.title.includes("DONE")), "terminal follow-ups excluded");
    assert.ok(!JSON.stringify(a.followUps).includes("B overdue follow-up"), "B's follow-up never leaks to A");
    for (const f of [...a.followUps.overdue, ...a.followUps.dueToday, ...a.followUps.upcoming]) {
      assert.equal(f.clientName, "A prospect 1 (has follow-up)", "follow-up carries its client name");
    }

    // open tasks (follow-ups + standalone), never B's
    const aTaskTitles = a.openTasks.map((t) => t.title).sort();
    assert.ok(aTaskTitles.includes("A standalone task"));
    assert.ok(aTaskTitles.includes("A overdue follow-up"));
    assert.ok(!aTaskTitles.includes("B task") && !aTaskTitles.includes("B overdue follow-up"), "B's tasks never leak to A");
    assert.ok(!aTaskTitles.includes("A DONE follow-up (excluded)"), "terminal tasks excluded from openTasks");
    const standaloneRow = a.openTasks.find((t) => t.title === "A standalone task");
    assert.equal(standaloneRow.clientId, null);
    assert.equal(standaloneRow.clientName, null);
    assert.equal(standaloneRow.bucket, "none", "a task with no due date buckets as 'none'");

    // recent interactions — only A's created_by_user_id, newest first
    assert.deepEqual(a.recentInteractions.map((i) => i.summary), ["A interaction newest", "A interaction older"]);
    assert.ok(!a.recentInteractions.some((i) => i.summary === "B interaction"), "B's interaction never leaks");
    assert.ok(!a.recentInteractions.some((i) => i.summary === "legacy text author"), "a legacy free-text-only interaction is not attributed to A");
    assert.ok(a.recentInteractions.every((i) => i.clientName === "A prospect 1 (has follow-up)"));

    // claimable unassigned — the two live ones, NOT the archived one
    assert.deepEqual(a.claimableUnassigned.map((c) => c.name).sort(), ["Unassigned 1", "Unassigned 2"]);
    assert.ok(!a.claimableUnassigned.some((c) => c.name === "Unassigned archived"), "archived prospects are not claimable");

    // counts
    assert.deepEqual(a.counts, {
      assignedProspects: 2,
      followUpsOverdue: 1,
      followUpsDueToday: 1,
      followUpsUpcoming: 1,
      openTasks: aTaskTitles.length,
      prospectsWithoutFollowUp: 1,
    });

    // 4. EMPLOYEE B — only B's data
    asUser(empB);
    const b = await getMyWork();
    assert.deepEqual(b.assignedProspects.map((p) => p.name), ["B prospect 1"]);
    assert.deepEqual(b.followUps.overdue.map((f) => f.title), ["B overdue follow-up"]);
    assert.equal(b.followUps.dueToday.length, 0);
    assert.equal(b.followUps.upcoming.length, 0);
    assert.deepEqual(b.recentInteractions.map((i) => i.summary), ["B interaction"]);
    assert.ok(!JSON.stringify(b).includes("A prospect 1"), "A's data never leaks to B");
    // claimable list is workspace-wide (same for everyone)
    assert.deepEqual(b.claimableUnassigned.map((c) => c.name).sort(), ["Unassigned 1", "Unassigned 2"]);

    // 5. MANAGER — self-view works, returns MANAGER's own (empty) scope, never A's or B's
    asUser(mgr);
    const m = await getMyWork();
    assert.equal(m.assignedProspects.length, 0);
    assert.equal(m.followUps.overdue.length + m.followUps.dueToday.length + m.followUps.upcoming.length, 0);
    assert.equal(m.openTasks.length, 0);
    assert.equal(m.recentInteractions.length, 0);
    assert.ok(!JSON.stringify(m).includes("A prospect") && !JSON.stringify(m).includes("B prospect"), "MANAGER self-view never contains another user's assigned work");
    assert.deepEqual(m.claimableUnassigned.map((c) => c.name).sort(), ["Unassigned 1", "Unassigned 2"]);

    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
