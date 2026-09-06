// lib/actions/workforce-ui.integration.test.mjs — disposable-Postgres proof
// for OWNER-UI-4A's UI glue:
//
//   - listAssignableWorkforceUsers()'s REAL anti-join excludes the current
//     OWNER and every existing ADMIN/MANAGER/EMPLOYEE (any status), and
//     includes a fresh `users` row that holds no staff_members row.
//   - addWorkforceMemberFromForm() delegates to R2B addWorkforceMember():
//     one staff_members row + exactly one workforce.member_added audit
//     event, correct workspace/role/inviter; a forged OWNER userId maps to
//     DUPLICATE and never mutates the OWNER row; a duplicate resubmit maps
//     to DUPLICATE and never changes the existing role.
//
// Mirrors lib/actions/workforce.integration.test.mjs exactly: one
// disposable Postgres, one seed, one test() body (db/index.ts caches its
// Pool on globalThis for the life of the process, so a second real-@/db
// scenario cannot open a fresh Pool). @/lib/session and @/lib/notifications
// are mocked (the Clerk-auth / server-only boundaries); next/cache's
// revalidatePath is mocked (no Next request scope). @/db is NOT mocked.
//
// R2B's own concurrency / positive-allowlist / audit-in-transaction
// internals are NOT re-proven here — that is workforce.integration.test.mjs.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce-ui.integration.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

async function startDisposablePostgres(namePrefix) {
  const container = `pm-${namePrefix}-${randomUUID().slice(0, 8)}`;
  const port = 5900 + Math.floor(Math.random() * 90);
  const user = "workforce_ui";
  const password = "workforce_ui_local_only";
  const db = "workforce_ui_check";
  const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${db}`;
  if (/supabase|neon|pooler/i.test(url) || !/@127\.0\.0\.1:/.test(url)) {
    throw new Error("REFUS : cible non locale.");
  }
  if (sh("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker indisponible — demarre Docker et relance.");
  }
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
  return {
    url,
    pool,
    stop: async () => {
      await pool.end().catch(() => {});
      sh("docker", ["rm", "-f", container], { stdio: "ignore" });
    },
  };
}

test("OWNER-UI-4A integration: eligible-user anti-join + addWorkforceMemberFromForm against real Postgres", async () => {
  const { url, pool, stop } = await startDisposablePostgres("workforce-ui");
  try {
    const dbMigrate = await import(
      new URL("../../scripts/db-migrate.mjs", import.meta.url).pathname
    );
    const applied = await dbMigrate.run({
      argv: ["--apply", "--db-url", url],
      env: TEST_ENV,
      promptFn: async () => "MIGRATE",
      ...silent,
    });
    assert.equal(applied.ok, true, `migration apply failed: ${JSON.stringify(applied)}`);

    const orgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);

    async function seedUser(email) {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [id, `clerk_${id}`, email]);
      return id;
    }

    const ownerUserId = await seedUser("owner@example.com");
    const adminUserId = await seedUser("admin@example.com");
    const managerUserId = await seedUser("manager@example.com");
    const employeeUserId = await seedUser("employee@example.com");
    const freshUserId = await seedUser("fresh@example.com");
    // A user with NO staff_members row but a non-active account status:
    // 4A deliberately applies no users.status eligibility policy (R2B's
    // notion of an eligible target is simply "an existing users row"), so
    // this user must still be offered by the picker.
    const suspendedNonStaffUserId = randomUUID();
    await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'suspended')", [
      suspendedNonStaffUserId,
      `clerk_${suspendedNonStaffUserId}`,
      "suspended-nonstaff@example.com",
    ]);

    const FIXED_OWNER_ID = "6a615714-4eb7-44f3-993b-f113292f0aa2";
    const roleRows = (await pool.query("select id, name from staff_roles order by name")).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    assert.equal(roleId.OWNER, FIXED_OWNER_ID, "0035 must have normalized OWNER to the fixed id");

    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [ownerUserId, orgId, roleId.OWNER]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [adminUserId, orgId, roleId.ADMIN]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'SUSPENDED')", [managerUserId, orgId, roleId.MANAGER]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'OFFBOARDING')", [employeeUserId, orgId, roleId.EMPLOYEE]);
    // freshUserId deliberately gets zero staff_members rows.

    process.env.DATABASE_URL = url;

    /** @type {{ kind: "unauthenticated" } | { kind: "session"; userId: string }} */
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
        getInternalOrganizationId: async () => {
          const [org] = (await pool.query("select id from organizations where is_internal = true limit 1")).rows;
          return org?.id ?? null;
        },
      },
    });
    let revalidateCalls = [];
    mock.module("next/cache", { namedExports: { revalidatePath: (p) => revalidateCalls.push(p) } });

    const {
      listAssignableWorkforceUsers,
      addWorkforceMemberFromForm,
      suspendWorkforceMemberAction,
      reactivateWorkforceMemberAction,
      offboardWorkforceMemberAction,
    } = await import(new URL("./workforce-ui.ts", import.meta.url).pathname);

    const asUser = (userId) => { sessionMockState = { kind: "session", userId }; };
    const form = (fields) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      return fd;
    };

    // 1. eligible-user anti-join: OWNER + ADMIN + MANAGER(SUSPENDED) +
    //    EMPLOYEE(OFFBOARDING) all absent; the fresh user is present; the
    //    projection is exactly { id, email }.
    asUser(adminUserId);
    const eligible = await listAssignableWorkforceUsers();
    const eligibleIds = eligible.users.map((u) => u.id);
    for (const excluded of [ownerUserId, adminUserId, managerUserId, employeeUserId]) {
      assert.ok(!eligibleIds.includes(excluded), `user already in staff_members leaked into the eligible list: ${excluded}`);
    }
    assert.ok(eligibleIds.includes(freshUserId), "a user with no staff_members row must be eligible");
    assert.ok(
      eligibleIds.includes(suspendedNonStaffUserId),
      "4A applies NO users.status eligibility policy — a non-active account with no staff_members row is still eligible",
    );
    assert.deepEqual(Object.keys(eligible.users.find((u) => u.id === freshUserId)).sort(), ["email", "id"]);
    assert.equal(eligible.hasMore, false);

    // 2. authorized add via the FromForm wrapper creates exactly one row.
    const result = await addWorkforceMemberFromForm(form({ userId: freshUserId, role: "MANAGER" }));
    assert.equal(result, undefined, `expected success, got ${JSON.stringify(result)}`);
    assert.deepEqual(revalidateCalls, ["/admin/workforce"]);

    const staffRows = (
      await pool.query("select id, workspace_org_id, role_id, status, invited_by_user_id from staff_members where user_id = $1", [freshUserId])
    ).rows;
    assert.equal(staffRows.length, 1, "exactly one staff_members row");
    assert.equal(staffRows[0].workspace_org_id, orgId);
    assert.equal(staffRows[0].role_id, roleId.MANAGER);
    assert.equal(staffRows[0].status, "ACTIVE");
    assert.equal(staffRows[0].invited_by_user_id, adminUserId);

    // 3. exactly one audit event, written by R2B (not the wrapper).
    const auditRows = (
      await pool.query("select action, actor_user_id, organization_id, metadata from audit_log where target_type = 'staff_member' and target_id = $1", [
        staffRows[0].id,
      ])
    ).rows;
    assert.equal(auditRows.length, 1, "exactly one workforce.member_added audit row");
    assert.equal(auditRows[0].action, "workforce.member_added");
    assert.equal(auditRows[0].actor_user_id, adminUserId);
    assert.equal(auditRows[0].organization_id, orgId);
    assert.equal(auditRows[0].metadata.role, "MANAGER");

    // 4. after the add, the fresh user is no longer eligible.
    const eligibleAfter = await listAssignableWorkforceUsers();
    assert.ok(!eligibleAfter.users.map((u) => u.id).includes(freshUserId), "a just-added member must drop out of the eligible list");

    // 5. forged OWNER userId + role ADMIN -> DUPLICATE, OWNER row untouched.
    revalidateCalls = [];
    const ownerAttempt = await addWorkforceMemberFromForm(form({ userId: ownerUserId, role: "ADMIN" }));
    assert.deepEqual(ownerAttempt, { error: "DUPLICATE" });
    assert.deepEqual(revalidateCalls, [], "a mapped error must not revalidate");
    const [ownerRowAfter] = (await pool.query("select role_id from staff_members where user_id = $1", [ownerUserId])).rows;
    assert.equal(ownerRowAfter.role_id, roleId.OWNER, "an existing OWNER must never be mutated through the 4A wrapper");

    // 6. duplicate resubmit for the fresh member -> DUPLICATE, role unchanged.
    const dup = await addWorkforceMemberFromForm(form({ userId: freshUserId, role: "EMPLOYEE" }));
    assert.deepEqual(dup, { error: "DUPLICATE" });
    const [freshRowAfterDup] = (await pool.query("select role_id from staff_members where user_id = $1", [freshUserId])).rows;
    assert.equal(freshRowAfterDup.role_id, roleId.MANAGER, "a duplicate add must never change the existing role");

    // ================================================================
    // PHASE RBAC-RUNTIME-R2D-B — suspend/reactivate/offboard wrappers.
    // Wrapper WIRING only (auth -> exactly one R2D-A call -> map -> revalidate);
    // R2D-A's own FOR UPDATE races / OWNER ne(roleId) guard / concurrency
    // multisets are proven by lib/actions/workforce.integration.test.mjs.
    // ================================================================
    const otherOrgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'external workspace', false)", [otherOrgId]);

    const r2dbActiveMgrId = await seedUser("r2db-active-mgr@example.com");
    const r2dbSuspMgrId = await seedUser("r2db-susp-mgr@example.com");
    const r2dbActiveEmpId = await seedUser("r2db-active-emp@example.com");
    const r2dbOffboardedId = await seedUser("r2db-offboarded@example.com");
    const r2dbAdmin2Id = await seedUser("r2db-admin2@example.com");
    const r2dbExternalMgrId = await seedUser("r2db-external-mgr@example.com");
    for (const [uid, rid, st, org] of [
      [r2dbActiveMgrId, roleId.MANAGER, "ACTIVE", orgId],
      [r2dbSuspMgrId, roleId.MANAGER, "SUSPENDED", orgId],
      [r2dbActiveEmpId, roleId.EMPLOYEE, "ACTIVE", orgId],
      [r2dbOffboardedId, roleId.MANAGER, "OFFBOARDING", orgId],
      [r2dbAdmin2Id, roleId.ADMIN, "ACTIVE", orgId],
      [r2dbExternalMgrId, roleId.MANAGER, "ACTIVE", otherOrgId],
    ]) {
      await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,$4)", [uid, org, rid, st]);
    }

    const statusOf = async (uid, org = orgId) =>
      (await pool.query("select status from staff_members where user_id = $1 and workspace_org_id = $2", [uid, org])).rows[0]?.status;
    const smIdOf = async (uid, org = orgId) =>
      (await pool.query("select id from staff_members where user_id = $1 and workspace_org_id = $2", [uid, org])).rows[0]?.id;
    const statusAuditCount = async (smId) =>
      (await pool.query("select count(*)::int as n from audit_log where action = 'workforce.member_status_changed' and target_id = $1", [smId])).rows[0].n;

    asUser(adminUserId);

    // R2DB-i. ACTIVE MANAGER: suspend wrapper -> SUSPENDED, one truthful audit, revalidate recorded.
    revalidateCalls = [];
    const mgrSmId = await smIdOf(r2dbActiveMgrId);
    const suspRes = await suspendWorkforceMemberAction(r2dbActiveMgrId);
    assert.equal(suspRes, undefined, `expected success, got ${JSON.stringify(suspRes)}`);
    assert.equal(await statusOf(r2dbActiveMgrId), "SUSPENDED");
    assert.deepEqual(revalidateCalls, ["/admin/workforce"]);
    assert.equal(await statusAuditCount(mgrSmId), 1, "exactly one workforce.member_status_changed audit");
    const [suspAudit] = (
      await pool.query("select actor_user_id, organization_id, metadata from audit_log where action = 'workforce.member_status_changed' and target_id = $1", [mgrSmId])
    ).rows;
    assert.equal(suspAudit.actor_user_id, adminUserId);
    assert.equal(suspAudit.organization_id, orgId);
    assert.deepEqual(suspAudit.metadata, { targetUserId: r2dbActiveMgrId, previousStatus: "ACTIVE", newStatus: "SUSPENDED" });

    // R2DB-ii. then reactivate wrapper -> ACTIVE.
    revalidateCalls = [];
    assert.equal(await reactivateWorkforceMemberAction(r2dbActiveMgrId), undefined);
    assert.equal(await statusOf(r2dbActiveMgrId), "ACTIVE");
    assert.deepEqual(revalidateCalls, ["/admin/workforce"]);

    // R2DB-iii. ACTIVE EMPLOYEE: offboard wrapper -> OFFBOARDING (terminal).
    revalidateCalls = [];
    assert.equal(await offboardWorkforceMemberAction(r2dbActiveEmpId), undefined);
    assert.equal(await statusOf(r2dbActiveEmpId), "OFFBOARDING");
    assert.deepEqual(revalidateCalls, ["/admin/workforce"]);

    // R2DB-iv. OFFBOARDING is terminal — reactivate/suspend -> INVALID_STATUS_TRANSITION, no write, no audit, no revalidate.
    const offSmId = await smIdOf(r2dbOffboardedId);
    for (const act of [reactivateWorkforceMemberAction, suspendWorkforceMemberAction]) {
      revalidateCalls = [];
      assert.deepEqual(await act(r2dbOffboardedId), { error: "INVALID_STATUS_TRANSITION" });
      assert.deepEqual(revalidateCalls, []);
    }
    assert.equal(await statusOf(r2dbOffboardedId), "OFFBOARDING");
    assert.equal(await statusAuditCount(offSmId), 0);

    // R2DB-v. no-op: suspend a SUSPENDED / reactivate an ACTIVE -> STATUS_UNCHANGED, no write, no revalidate.
    revalidateCalls = [];
    assert.deepEqual(await suspendWorkforceMemberAction(r2dbSuspMgrId), { error: "STATUS_UNCHANGED" });
    assert.deepEqual(await reactivateWorkforceMemberAction(r2dbActiveMgrId), { error: "STATUS_UNCHANGED" });
    assert.deepEqual(revalidateCalls, []);
    assert.equal(await statusOf(r2dbSuspMgrId), "SUSPENDED");

    // R2DB-vi. an ADMIN target -> ADMIN_TIER_PROTECTED for every wrapper; no write, no audit.
    const admin2SmId = await smIdOf(r2dbAdmin2Id);
    for (const act of [suspendWorkforceMemberAction, reactivateWorkforceMemberAction, offboardWorkforceMemberAction]) {
      revalidateCalls = [];
      assert.deepEqual(await act(r2dbAdmin2Id), { error: "ADMIN_TIER_PROTECTED" });
      assert.deepEqual(revalidateCalls, []);
    }
    assert.equal(await statusOf(r2dbAdmin2Id), "ACTIVE");
    assert.equal(await statusAuditCount(admin2SmId), 0);

    // R2DB-vii. self target (the acting admin) -> SELF_LIFECYCLE_NOT_ALLOWED.
    revalidateCalls = [];
    assert.deepEqual(await suspendWorkforceMemberAction(adminUserId), { error: "SELF_LIFECYCLE_NOT_ALLOWED" });
    assert.deepEqual(revalidateCalls, []);

    // R2DB-viii. a member of a NON-internal workspace is invisible -> MEMBER_NOT_FOUND; the remote row is untouched.
    revalidateCalls = [];
    assert.deepEqual(await suspendWorkforceMemberAction(r2dbExternalMgrId), { error: "MEMBER_NOT_FOUND" });
    assert.equal(await statusOf(r2dbExternalMgrId, otherOrgId), "ACTIVE", "the external-workspace member was never touched");
    assert.deepEqual(revalidateCalls, []);

    // R2DB-ix. a caller WITHOUT WORKFORCE_MANAGE (ACTIVE MANAGER) is denied before any wrapper effect.
    asUser(r2dbActiveMgrId);
    await assert.rejects(() => suspendWorkforceMemberAction(r2dbActiveEmpId), /NEXT_REDIRECT/);
    asUser(adminUserId);
    assert.equal(await statusOf(r2dbActiveEmpId), "OFFBOARDING", "a denied caller changed nothing");

    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
