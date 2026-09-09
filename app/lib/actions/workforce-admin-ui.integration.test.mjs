// lib/actions/workforce-admin-ui.integration.test.mjs — disposable-Postgres
// proof of the OWNER-UI read side:
//   - listAdminGovernanceRoster()  (ADMIN-only roster, OWNER never present)
//   - listGovernanceHistory()      (owner.admin_* audit, workspace-scoped,
//                                   newest-first, limit 25, identity resolved,
//                                   no raw UUID in the shape)
//
// Same harness as lib/actions/workforce.integration.test.mjs: real @/db +
// real requireStaffMember("OWNER_MANAGE"); only @/lib/session and
// @/lib/notifications mocked at the established boundaries.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce-admin-ui.integration.test.mjs
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
  const user = "wa_ui";
  const password = "wa_ui_local_only";
  const db = "wa_ui_check";
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

test("OWNER-UI read side: roster + governance history against one disposable Postgres", async () => {
  const { url, pool, stop } = await startDisposablePostgres("wa-ui");
  try {
    const dbMigrate = await import(`${APP_DIR}/scripts/db-migrate.mjs`);
    const applied = await dbMigrate.run({ argv: ["--apply", "--db-url", url], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
    assert.equal(applied.ok, true, `migration apply failed: ${JSON.stringify(applied)}`);

    const orgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);
    const otherOrgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'Other', false)", [otherOrgId]);

    const seedUser = async (email, fullName = null) => {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, full_name, status) values ($1,$2,$3,$4,'active')", [id, `clerk_${id}`, email, fullName]);
      return id;
    };
    const roleRows = (await pool.query("select id, name from staff_roles")).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));

    const ownerUserId = await seedUser("owner@example.com", "Olga Owner");
    const adminAId = await seedUser("admin-a@example.com", "Alice Admin");
    const adminBId = await seedUser("admin-b@example.com", null); // no full name -> email
    const managerId = await seedUser("manager@example.com", "Manny Manager");
    const employeeId = await seedUser("employee@example.com");
    const actorOwnerId = ownerUserId;

    const seedStaff = (uid, rid, status = "ACTIVE") =>
      pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,$4)", [uid, orgId, rid, status]);
    await seedStaff(ownerUserId, roleId.OWNER);
    await seedStaff(adminAId, roleId.ADMIN);
    await seedStaff(adminBId, roleId.ADMIN, "SUSPENDED");
    await seedStaff(managerId, roleId.MANAGER);
    await seedStaff(employeeId, roleId.EMPLOYEE);

    // audit_log fixtures
    const seedAudit = (action, actorId, org, metadata, createdAt) =>
      pool.query(
        "insert into audit_log (action, actor_user_id, organization_id, target_type, target_id, metadata, created_at) values ($1,$2,$3,'staff_member',$4,$5,$6)",
        [action, actorId, org, randomUUID(), JSON.stringify(metadata), createdAt],
      );
    // 3 relevant, internal-workspace, different times
    await seedAudit("owner.admin_suspended", actorOwnerId, orgId, { targetUserId: adminBId, previousStatus: "ACTIVE", newStatus: "SUSPENDED" }, "2026-09-01T10:00:00Z");
    await seedAudit("owner.admin_demoted", actorOwnerId, orgId, { targetUserId: adminAId, previousRole: "ADMIN", newRole: "MANAGER" }, "2026-09-03T10:00:00Z");
    await seedAudit("owner.admin_reactivated", actorOwnerId, orgId, { targetUserId: adminBId, previousStatus: "SUSPENDED", newStatus: "ACTIVE" }, "2026-09-02T10:00:00Z");
    // noise that must NOT appear: wrong action, wrong workspace
    await seedAudit("crm.client_created", actorOwnerId, orgId, { name: "x" }, "2026-09-04T10:00:00Z");
    await seedAudit("workforce.member_added", actorOwnerId, orgId, { role: "ADMIN" }, "2026-09-04T11:00:00Z");
    await seedAudit("owner.admin_offboarded", actorOwnerId, otherOrgId, { targetUserId: adminAId }, "2026-09-05T10:00:00Z");
    // 30 more relevant rows to exercise the limit
    for (let i = 0; i < 30; i++) {
      await seedAudit("owner.admin_suspended", actorOwnerId, orgId, { targetUserId: adminAId, previousStatus: "ACTIVE", newStatus: "SUSPENDED" }, `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00Z`);
    }

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

    const { listAdminGovernanceRoster, listGovernanceHistory } = await import(`${APP_DIR}/lib/actions/workforce-admin-ui.ts`);
    // GOVERNANCE_HISTORY_ACTIONS is module-private ("use server" files may only
    // export async functions) — assert against the known literal set.
    const GOVERNANCE_HISTORY_ACTIONS = ["owner.admin_demoted", "owner.admin_suspended", "owner.admin_reactivated", "owner.admin_offboarded"];
    const asUser = (u) => { sessionMockState = { kind: "session", userId: u }; };

    // ---- listAdminGovernanceRoster ----
    asUser(adminAId);
    await assert.rejects(() => listAdminGovernanceRoster(), /NEXT_REDIRECT/, "ADMIN cannot read the roster");
    asUser(managerId);
    await assert.rejects(() => listAdminGovernanceRoster(), /NEXT_REDIRECT/);
    asUser(ownerUserId);
    const roster = await listAdminGovernanceRoster();
    assert.equal(roster.length, 2, "roster returns exactly the two ADMIN rows");
    assert.ok(roster.every((r) => r.email.startsWith("admin-")), "only ADMIN emails");
    assert.ok(!roster.some((r) => r.email === "owner@example.com"), "OWNER never in the roster");
    assert.ok(!roster.some((r) => r.email === "manager@example.com" || r.email === "employee@example.com"));
    const byEmail = Object.fromEntries(roster.map((r) => [r.email, r]));
    assert.equal(byEmail["admin-a@example.com"].status, "ACTIVE");
    assert.equal(byEmail["admin-b@example.com"].status, "SUSPENDED");
    assert.equal(byEmail["admin-a@example.com"].fullName, "Alice Admin");
    assert.equal(byEmail["admin-b@example.com"].fullName, null);
    // shape has no staffMemberId / roleId / workspaceOrgId
    for (const r of roster) {
      assert.deepEqual(Object.keys(r).sort(), ["email", "fullName", "invitedByEmail", "joinedAt", "status", "userId"]);
    }

    // ---- listGovernanceHistory ----
    asUser(adminAId);
    await assert.rejects(() => listGovernanceHistory(), /NEXT_REDIRECT/, "ADMIN cannot read history");
    asUser(employeeId);
    await assert.rejects(() => listGovernanceHistory(), /NEXT_REDIRECT/);

    asUser(ownerUserId);
    const history = await listGovernanceHistory();
    // only the 4 governance actions
    for (const h of history) assert.ok(GOVERNANCE_HISTORY_ACTIONS.includes(h.action), `unexpected action ${h.action}`);
    // limit 25
    assert.equal(history.length, 25, "history is capped at 25");
    // newest first — the 3 explicit Sept rows are the newest and come first
    assert.equal(history[0].action, "owner.admin_demoted"); // 2026-09-03
    assert.equal(history[1].action, "owner.admin_reactivated"); // 2026-09-02
    assert.equal(history[2].action, "owner.admin_suspended"); // 2026-09-01
    for (let i = 1; i < history.length; i++) {
      assert.ok(new Date(history[i - 1].at) >= new Date(history[i].at), "strictly newest-first");
    }
    // workspace scope — the other-org offboard is absent
    assert.ok(!history.some((h) => h.action === "owner.admin_offboarded"), "other-workspace event excluded");
    // identity resolved server-side
    const demote = history[0];
    assert.equal(demote.actorName, "Olga Owner");
    assert.equal(demote.actorEmail, "owner@example.com");
    assert.equal(demote.targetName, "Alice Admin");
    assert.equal(demote.targetEmail, "admin-a@example.com");
    assert.equal(demote.newRole, "MANAGER");
    const react = history[1];
    assert.equal(react.targetName, null, "adminB has no full name");
    assert.equal(react.targetEmail, "admin-b@example.com");
    // no raw UUID anywhere in the returned shape
    const blob = JSON.stringify(history);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(blob), false, "a UUID leaked into a history row");

    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
