// lib/actions/workforce-admin.integration.test.mjs — disposable-Postgres proof
// of PHASE RBAC-RUNTIME-R2D-C: the OWNER-only ADMIN lifecycle
// (demoteAdmin / suspendAdmin / reactivateAdmin / offboardAdmin) in
// lib/actions/workforce-admin.ts.
//
// Mirrors lib/actions/workforce.integration.test.mjs exactly: one disposable
// Postgres + one seed inside a single `test()` block (node:test defers
// registered-test execution until the whole module finishes evaluating, so a
// module-level teardown would kill the container before any test runs).
//
// @/lib/session (requireSession) and @/lib/notifications (getInternalOrganizationId)
// are mocked at the module boundary — the same boundaries every RBAC test in
// this repo mocks. @/db and @/lib/rbac/require-staff-member are NOT mocked:
// DATABASE_URL points at this disposable container BEFORE the first import
// that touches @/db, so requireStaffMember("OWNER_MANAGE")'s real
// staff_members lookup AND every workforce-admin transaction run for real
// against real seeded rows — genuinely proving the OWNER-only gate and the
// FOR UPDATE re-check, never trusting an injected fake.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce-admin.integration.test.mjs
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
  const user = "workforce_r2dc";
  const password = "workforce_r2dc_local_only";
  const db = "workforce_r2dc_check";
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

test("R2D-C integration: OWNER-only ADMIN lifecycle against one disposable Postgres", async () => {
  const { url, pool, stop } = await startDisposablePostgres("workforce-r2dc");
  try {
    // ---- apply the full real migrations folder (0000..0035) --------------
    const dbMigrate = await import(`${APP_DIR}/scripts/db-migrate.mjs`);
    const applied = await dbMigrate.run({
      argv: ["--apply", "--db-url", url],
      env: TEST_ENV,
      promptFn: async () => "MIGRATE",
      ...silent,
    });
    assert.equal(applied.ok, true, `migration apply failed: ${JSON.stringify(applied)}`);

    // ---- seed: internal org + users + staff_members ------------------
    const orgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);
    const nonInternalOrgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'Other org (non-internal)', false)", [nonInternalOrgId]);

    async function seedUser(email) {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [id, `clerk_${id}`, email]);
      return id;
    }

    const FIXED_OWNER_ID = "6a615714-4eb7-44f3-993b-f113292f0aa2";
    const roleRows = (await pool.query("select id, name from staff_roles order by name")).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    assert.equal(roleId.OWNER, FIXED_OWNER_ID, "0035 must have normalized OWNER to the fixed id");

    const ownerUserId = await seedUser("owner@example.com");
    const callerAdminId = await seedUser("caller-admin@example.com");
    const callerManagerId = await seedUser("caller-manager@example.com");
    const callerEmployeeId = await seedUser("caller-employee@example.com");
    const noMembershipUserId = await seedUser("nomembership@example.com");

    const seedStaff = (uid, rid, status, org = orgId) =>
      pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,$4)", [uid, org, rid, status]);

    await seedStaff(ownerUserId, roleId.OWNER, "ACTIVE");
    await seedStaff(callerAdminId, roleId.ADMIN, "ACTIVE");
    await seedStaff(callerManagerId, roleId.MANAGER, "ACTIVE");
    await seedStaff(callerEmployeeId, roleId.EMPLOYEE, "ACTIVE");
    // noMembershipUserId: zero staff_members rows.

    // ---- point @/db at the disposable container, mock the auth boundary --
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
        getInternalOrganizationId: async () => {
          const [org] = (await pool.query("select id from organizations where is_internal = true limit 1")).rows;
          return org?.id ?? null;
        },
      },
    });

    const { demoteAdmin, suspendAdmin, reactivateAdmin, offboardAdmin } = await import(`${APP_DIR}/lib/actions/workforce-admin.ts`);
    const { addWorkforceMember } = await import(`${APP_DIR}/lib/actions/workforce.ts`);

    const asUser = (userId) => { sessionMockState = { kind: "session", userId }; };
    const roleIdOf = async (uid, org = orgId) =>
      (await pool.query("select role_id from staff_members where user_id=$1 and workspace_org_id=$2", [uid, org])).rows[0]?.role_id;
    const statusOf = async (uid, org = orgId) =>
      (await pool.query("select status from staff_members where user_id=$1 and workspace_org_id=$2", [uid, org])).rows[0]?.status;
    const smIdOf = async (uid, org = orgId) =>
      (await pool.query("select id from staff_members where user_id=$1 and workspace_org_id=$2", [uid, org])).rows[0]?.id;
    const auditRows = async (action, staffMemberId) =>
      (await pool.query("select actor_user_id, organization_id, metadata from audit_log where action=$1 and target_id=$2", [action, staffMemberId])).rows;
    const activeAdminCount = async () =>
      (
        await pool.query(
          "select count(*)::int n from staff_members sm join staff_roles sr on sr.id=sm.role_id where sm.workspace_org_id=$1 and sr.name='ADMIN' and sm.status='ACTIVE'",
          [orgId],
        )
      ).rows[0].n;
    /** seed a fresh ADMIN target and return its users.id */
    const freshAdmin = async (label, status = "ACTIVE") => {
      const uid = await seedUser(`admin-${label}-${randomUUID().slice(0, 6)}@example.com`);
      await seedStaff(uid, roleId.ADMIN, status);
      return uid;
    };

    // ================================================================
    // 1. AUTHORIZATION — only OWNER may call any of the four actions.
    // ================================================================
    {
      const tDemote = await freshAdmin("auth-demote");
      const tSuspend = await freshAdmin("auth-suspend");
      const tReact = await freshAdmin("auth-react", "SUSPENDED");
      const tOffb = await freshAdmin("auth-offb");
      for (const [label, caller] of [
        ["ADMIN", callerAdminId],
        ["MANAGER", callerManagerId],
        ["EMPLOYEE", callerEmployeeId],
        ["no-membership", noMembershipUserId],
      ]) {
        asUser(caller);
        await assert.rejects(() => demoteAdmin(tDemote, "MANAGER"), /NEXT_REDIRECT/, `${label} must not demote`);
        await assert.rejects(() => suspendAdmin(tSuspend), /NEXT_REDIRECT/, `${label} must not suspend`);
        await assert.rejects(() => reactivateAdmin(tReact), /NEXT_REDIRECT/, `${label} must not reactivate`);
        await assert.rejects(() => offboardAdmin(tOffb), /NEXT_REDIRECT/, `${label} must not offboard`);
      }
      sessionMockState = { kind: "unauthenticated" };
      await assert.rejects(() => demoteAdmin(tDemote, "MANAGER"), /NEXT_REDIRECT/);
      await assert.rejects(() => suspendAdmin(tSuspend), /NEXT_REDIRECT/);

      assert.equal(await roleIdOf(tDemote), roleId.ADMIN, "denied demote changed nothing");
      assert.equal(await statusOf(tSuspend), "ACTIVE", "denied suspend changed nothing");
      assert.equal(await statusOf(tReact), "SUSPENDED", "denied reactivate changed nothing");
      assert.equal(await statusOf(tOffb), "ACTIVE", "denied offboard changed nothing");
    }

    // ================================================================
    // 2. OWNER caller — happy paths + correct transactional audit.
    // ================================================================
    asUser(ownerUserId);

    {
      const t = await freshAdmin("demote-mgr");
      const smId = await smIdOf(t);
      const res = await demoteAdmin(t, "MANAGER");
      assert.deepEqual(res, { userId: t, email: (await pool.query("select email from users where id=$1", [t])).rows[0].email, role: "MANAGER", status: "ACTIVE" });
      assert.equal(await roleIdOf(t), roleId.MANAGER);
      const rows = await auditRows("owner.admin_demoted", smId);
      assert.equal(rows.length, 1, "exactly one owner.admin_demoted audit");
      assert.equal(rows[0].actor_user_id, ownerUserId);
      assert.equal(rows[0].organization_id, orgId);
      assert.deepEqual(rows[0].metadata, { targetUserId: t, previousRole: "ADMIN", newRole: "MANAGER" });
    }
    {
      const t = await freshAdmin("demote-emp");
      const res = await demoteAdmin(t, "EMPLOYEE");
      assert.equal(res.role, "EMPLOYEE");
      assert.equal(await roleIdOf(t), roleId.EMPLOYEE);
      assert.deepEqual((await auditRows("owner.admin_demoted", await smIdOf(t)))[0].metadata, { targetUserId: t, previousRole: "ADMIN", newRole: "EMPLOYEE" });
    }
    {
      const t = await freshAdmin("suspend");
      const smId = await smIdOf(t);
      const res = await suspendAdmin(t);
      assert.deepEqual(res, { userId: t, email: (await pool.query("select email from users where id=$1", [t])).rows[0].email, role: "ADMIN", status: "SUSPENDED" });
      assert.equal(await statusOf(t), "SUSPENDED");
      assert.deepEqual((await auditRows("owner.admin_suspended", smId))[0].metadata, { targetUserId: t, previousStatus: "ACTIVE", newStatus: "SUSPENDED" });
    }
    {
      const t = await freshAdmin("react", "SUSPENDED");
      const res = await reactivateAdmin(t);
      assert.equal(res.status, "ACTIVE");
      assert.equal(await statusOf(t), "ACTIVE");
      assert.deepEqual((await auditRows("owner.admin_reactivated", await smIdOf(t)))[0].metadata, { targetUserId: t, previousStatus: "SUSPENDED", newStatus: "ACTIVE" });
    }
    {
      const t = await freshAdmin("offboard");
      const res = await offboardAdmin(t);
      assert.equal(res.status, "OFFBOARDING");
      assert.equal(await statusOf(t), "OFFBOARDING");
      assert.deepEqual((await auditRows("owner.admin_offboarded", await smIdOf(t)))[0].metadata, { targetUserId: t, previousStatus: "ACTIVE", newStatus: "OFFBOARDING" });
    }
    {
      const t = await freshAdmin("offboard-from-suspended", "SUSPENDED");
      const res = await offboardAdmin(t);
      assert.equal(res.status, "OFFBOARDING");
      assert.deepEqual((await auditRows("owner.admin_offboarded", await smIdOf(t)))[0].metadata, { targetUserId: t, previousStatus: "SUSPENDED", newStatus: "OFFBOARDING" });
    }

    // ================================================================
    // 3. OWNER may remove the FINAL ACTIVE ADMIN — NO last-active-admin floor.
    //    Offboard every currently-ACTIVE ADMIN; the very last one must still
    //    succeed and leave zero ACTIVE ADMIN.
    // ================================================================
    {
      // ensure at least two ACTIVE admins exist so "the last one" is meaningful
      await freshAdmin("final-a");
      await freshAdmin("final-b");
      const activeAdminIds = (
        await pool.query(
          "select sm.user_id from staff_members sm join staff_roles sr on sr.id=sm.role_id where sm.workspace_org_id=$1 and sr.name='ADMIN' and sm.status='ACTIVE'",
          [orgId],
        )
      ).rows.map((r) => r.user_id);
      assert.ok(activeAdminIds.length >= 2, "need >=2 ACTIVE admins to prove the last removal");
      for (const uid of activeAdminIds) {
        const res = await offboardAdmin(uid);
        assert.equal(res.status, "OFFBOARDING");
      }
      assert.equal(await activeAdminCount(), 0, "OWNER is allowed to leave zero ACTIVE ADMIN");
    }

    // ================================================================
    // 4. Target protection.
    //    OWNER row: with exactly one OWNER, "OWNER target" == "self target",
    //    so the wrapper self-guard is the reachable rejection. The OWNER
    //    branch of assertAdminTierTargetRole() + `role_id <>
    //    OWNER_STAFF_ROLE_ID` remain as defense-in-depth for a hypothetical
    //    multi-OWNER model (not constructible here).
    //    MANAGER / EMPLOYEE targets: rejected as non-ADMIN.
    // ================================================================
    await assert.rejects(() => demoteAdmin(ownerUserId, "MANAGER"), /owners cannot demote their own membership/);
    await assert.rejects(() => suspendAdmin(ownerUserId), /owners cannot change their own lifecycle status/);
    await assert.rejects(() => reactivateAdmin(ownerUserId), /owners cannot change their own lifecycle status/);
    await assert.rejects(() => offboardAdmin(ownerUserId), /owners cannot change their own lifecycle status/);
    assert.equal(await roleIdOf(ownerUserId), roleId.OWNER);
    assert.equal(await statusOf(ownerUserId), "ACTIVE");
    assert.equal((await auditRows("owner.admin_demoted", await smIdOf(ownerUserId))).length, 0);

    await assert.rejects(() => demoteAdmin(callerManagerId, "EMPLOYEE"), /this action only applies to administrators/);
    await assert.rejects(() => suspendAdmin(callerManagerId), /this action only applies to administrators/);
    await assert.rejects(() => offboardAdmin(callerEmployeeId), /this action only applies to administrators/);
    assert.equal(await roleIdOf(callerManagerId), roleId.MANAGER);
    assert.equal(await statusOf(callerManagerId), "ACTIVE");
    assert.equal(await statusOf(callerEmployeeId), "ACTIVE");

    // ================================================================
    // 5. Input / not-found / transition validation.
    // ================================================================
    await assert.rejects(() => demoteAdmin("not-a-uuid", "MANAGER"), /must be a valid UUID/);
    await assert.rejects(() => suspendAdmin("not-a-uuid"), /must be a valid UUID/);

    {
      const t = await freshAdmin("bad-role");
      await assert.rejects(() => demoteAdmin(t, "ADMIN"), /demotion role must be one of/);
      await assert.rejects(() => demoteAdmin(t, "OWNER"), /demotion role must be one of/);
      await assert.rejects(() => demoteAdmin(t, "nope"), /demotion role must be one of/);
      assert.equal(await roleIdOf(t), roleId.ADMIN, "a rejected demotion role changes nothing");
    }

    // not found: user with no staff_members row in the internal workspace
    await assert.rejects(() => suspendAdmin(noMembershipUserId), /administrator not found/);
    {
      const nonInternalAdmin = await freshAdmin("noninternal", "ACTIVE");
      // move it to the non-internal org
      await pool.query("update staff_members set workspace_org_id=$1 where user_id=$2", [nonInternalOrgId, nonInternalAdmin]);
      await assert.rejects(() => suspendAdmin(nonInternalAdmin), /administrator not found/);
      assert.equal(await statusOf(nonInternalAdmin, nonInternalOrgId), "ACTIVE", "non-internal admin untouched");
    }

    // invalid status transitions
    {
      const active = await freshAdmin("txn-active");
      await assert.rejects(() => reactivateAdmin(active), /already has this status/);

      const offb = await freshAdmin("txn-offb", "OFFBOARDING");
      await assert.rejects(() => reactivateAdmin(offb), /this lifecycle transition is not allowed/);
      await assert.rejects(() => suspendAdmin(offb), /this lifecycle transition is not allowed/);
      await assert.rejects(() => offboardAdmin(offb), /already has this status/);
      assert.equal(await statusOf(offb), "OFFBOARDING", "terminal offboarded admin unchanged");

      const susp = await freshAdmin("txn-susp", "SUSPENDED");
      await assert.rejects(() => suspendAdmin(susp), /already has this status/);
      await assert.rejects(() => demoteAdmin(susp, "MANAGER"), /not active and cannot be demoted/);
      assert.equal(await roleIdOf(susp), roleId.ADMIN);
    }

    // ================================================================
    // 6. Concurrency — two demotes on the same ADMIN: one wins, one fails,
    //    exactly one audit per fulfilled, final role is a demotion target.
    // ================================================================
    {
      const t = await freshAdmin("race");
      const smId = await smIdOf(t);
      const race = await Promise.allSettled([demoteAdmin(t, "MANAGER"), demoteAdmin(t, "EMPLOYEE")]);
      const fulfilled = race.filter((r) => r.status === "fulfilled");
      assert.ok(fulfilled.length >= 1, "at least one concurrent demote fulfils");
      for (const r of race.filter((x) => x.status === "rejected")) {
        assert.doesNotMatch(String(r.reason), /NEXT_REDIRECT/, "a concurrent demote never fails authorization");
      }
      const audits = await auditRows("owner.admin_demoted", smId);
      assert.equal(audits.length, fulfilled.length, "one demote audit per fulfilled call");
      assert.ok([roleId.MANAGER, roleId.EMPLOYEE].includes(await roleIdOf(t)), "final role is a demotion target");
      // at least one audit leaves the seeded ADMIN role
      assert.ok(audits.some((a) => a.metadata.previousRole === "ADMIN"), "an audit records leaving the seeded ADMIN role");
    }

    // ================================================================
    // 7. ADMIN-create-ADMIN behavior is UNCHANGED — this module never
    //    touched addWorkforceMember(). An ACTIVE ADMIN caller may still
    //    mint another ADMIN through the existing WORKFORCE_MANAGE flow.
    // ================================================================
    {
      const adminCaller = await freshAdmin("create-caller"); // fresh ACTIVE ADMIN
      asUser(adminCaller);
      const brandNew = await seedUser(`brand-new-admin-${randomUUID().slice(0, 6)}@example.com`);
      const created = await addWorkforceMember(brandNew, "ADMIN");
      assert.deepEqual(created, {
        userId: brandNew,
        email: (await pool.query("select email from users where id=$1", [brandNew])).rows[0].email,
        role: "ADMIN",
        status: "ACTIVE",
      });
      assert.equal(await roleIdOf(brandNew), roleId.ADMIN, "ADMIN may still create another ADMIN (unchanged policy)");
    }

    // close @/db's module Pool before the container dies
    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
