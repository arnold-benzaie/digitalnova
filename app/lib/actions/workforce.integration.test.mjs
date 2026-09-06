// lib/actions/workforce.integration.test.mjs — disposable-Postgres proof
// that listWorkforceMembers()'s REAL query (not an injected fake) excludes
// OWNER and returns ADMIN/MANAGER/EMPLOYEE correctly, and that the full
// authorization pipeline (requireStaffMember -> WORKFORCE_MANAGE) behaves
// correctly for every caller role. Mirrors the exact disposable-container
// pattern already established by scripts/rbac-owner-invariant.integration.test.mjs
// — one disposable Postgres + one seed per `test()` block (never a shared
// describe/before/after: node:test defers registered-test execution until
// after the whole module finishes evaluating, so a module-level `finally`
// teardown would destroy the container before any test ever runs).
//
// @/lib/session's requireSession() is mocked (the same boundary R1's own
// tests mock — a real Clerk auth() call can't run outside a Next.js
// request), but @/db is deliberately NOT mocked: DATABASE_URL is set to
// this disposable container BEFORE the first import of anything that
// touches @/db, so requireStaffMember's real internal staff_members lookup
// and listWorkforceMembers()'s real query both run for real against real
// seeded rows — genuinely proving the OWNER-exclusion predicate, not merely
// trusting an injected fake.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce.integration.test.mjs
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
  const user = "workforce_r2a";
  const password = "workforce_r2a_local_only";
  const db = "workforce_r2a_check";
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

test("R2A integration: full authorization pipeline + real OWNER-exclusion query, seeded once against one disposable Postgres", async () => {
  const { url, pool, stop } = await startDisposablePostgres("workforce-r2a");
  try {
    // ---- apply the full real migrations folder (0000..0035) ----------
    const dbMigrate = await import(
      "/Users/arnoldbenzaie/Documents/projects.md/digitalnova/.claude/worktrees/chantier1-phase2-quote-public-page/app/scripts/db-migrate.mjs"
    );
    const applied = await dbMigrate.run({
      argv: ["--apply", "--db-url", url],
      env: TEST_ENV,
      promptFn: async () => "MIGRATE",
      ...silent,
    });
    assert.equal(applied.ok, true, `migration apply failed: ${JSON.stringify(applied)}`);

    // ---- seed fixtures: internal org, 5 users, 4 staff_members rows --
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
    const noMembershipUserId = await seedUser("nomembership@example.com");

    const FIXED_OWNER_ID = "6a615714-4eb7-44f3-993b-f113292f0aa2";
    const roleRows = (await pool.query("select id, name from staff_roles order by name")).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    assert.equal(roleId.OWNER, FIXED_OWNER_ID, "0035 must have already normalized OWNER to the fixed id");

    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [ownerUserId, orgId, roleId.OWNER]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [adminUserId, orgId, roleId.ADMIN]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'SUSPENDED')", [managerUserId, orgId, roleId.MANAGER]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'OFFBOARDING')", [employeeUserId, orgId, roleId.EMPLOYEE]);
    // noMembershipUserId deliberately gets zero staff_members rows.

    // ---- point @/db at this disposable Postgres BEFORE any import that
    // touches it, then mock @/lib/session (the Clerk-auth boundary) and
    // @/lib/notifications ----------------------------------------------
    // @/lib/notifications is mocked too — not because its own logic is
    // untrusted, but because it transitively imports lib/integrations/
    // contracts.ts, which is guarded by the `server-only` package: that
    // guard throws unconditionally outside Next's own bundler, regardless
    // of DB connectivity, so no test in this codebase can import the real
    // module via plain tsx/node (the same reason every other test file
    // mocks @/lib/session rather than using it directly). The mock below
    // is NOT a canned fake — it runs the identical one-line query
    // (`select id from organizations where is_internal = true`) directly
    // against this same disposable pool, so both requireStaffMember's
    // internal permission check AND listWorkforceMembers()'s own workspace
    // resolution still resolve the REAL seeded internal workspace for real.
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

    // listWorkforceMembers/addWorkforceMember/changeWorkforceMemberRole plus
    // the R2D-A lifecycle trio are the ONLY runtime-capable exports of this
    // module (see RBAC-RUNTIME-R2A-API-SURFACE-HARDENING-1,
    // RBAC-RUNTIME-R2B-WORKFORCE-MUTATION-FOUNDATION-1,
    // RBAC-RUNTIME-R2C-WORKFORCE-ROLE-CHANGE and
    // RBAC-RUNTIME-R2D-A-WORKFORCE-LIFECYCLE) — every assertion below goes
    // through them, exactly as any real caller must.
    const {
      listWorkforceMembers,
      addWorkforceMember,
      changeWorkforceMemberRole,
      suspendWorkforceMember,
      reactivateWorkforceMember,
      offboardWorkforceMember,
    } = await import(
      "/Users/arnoldbenzaie/Documents/projects.md/digitalnova/.claude/worktrees/chantier1-phase2-quote-public-page/app/lib/actions/workforce.ts"
    );

    const asUser = (userId) => { sessionMockState = { kind: "session", userId }; };

    // 1. OWNER caller + WORKFORCE_MANAGE -> list allowed
    asUser(ownerUserId);
    const ownerRows = await listWorkforceMembers();
    assert.equal(ownerRows.length, 3, `expected 3 rows, got ${JSON.stringify(ownerRows)}`);

    // 2. ADMIN caller + WORKFORCE_MANAGE -> list allowed
    asUser(adminUserId);
    const adminRows = await listWorkforceMembers();
    assert.equal(adminRows.length, 3);

    // 3. MANAGER caller -> denied
    asUser(managerUserId);
    await assert.rejects(() => listWorkforceMembers(), /NEXT_REDIRECT/);

    // 4. EMPLOYEE caller -> denied
    asUser(employeeUserId);
    await assert.rejects(() => listWorkforceMembers(), /NEXT_REDIRECT/);

    // 5. no staff membership -> denied
    asUser(noMembershipUserId);
    await assert.rejects(() => listWorkforceMembers(), /NEXT_REDIRECT/);

    // 6. OWNER row present in DB alongside ADMIN/MANAGER/EMPLOYEE -> the
    // REAL query (not a fake) never returns it.
    asUser(adminUserId);
    const rows = await listWorkforceMembers();
    assert.ok(!rows.some((r) => r.role === "OWNER"), `OWNER leaked into the response: ${JSON.stringify(rows)}`);
    assert.ok(!rows.some((r) => r.userId === ownerUserId), `OWNER's userId leaked into the response: ${JSON.stringify(rows)}`);

    // 7-12. ADMIN/MANAGER/EMPLOYEE rows and their TRUE statuses
    // (ACTIVE/SUSPENDED/OFFBOARDING) returned correctly by the real query.
    const byRole = Object.fromEntries(rows.map((r) => [r.role, r]));
    assert.equal(byRole.ADMIN.userId, adminUserId);
    assert.equal(byRole.ADMIN.status, "ACTIVE");
    assert.equal(byRole.MANAGER.userId, managerUserId);
    assert.equal(byRole.MANAGER.status, "SUSPENDED");
    assert.equal(byRole.EMPLOYEE.userId, employeeUserId);
    assert.equal(byRole.EMPLOYEE.status, "OFFBOARDING");

    // 22. deterministic ordering, from the real query's ORDER BY.
    const rowsAgain = await listWorkforceMembers();
    assert.deepEqual(rows, rowsAgain, "two consecutive calls must return the exact same order");
    const emails = rows.map((r) => r.email);
    assert.deepEqual(emails, [...emails].sort(), "rows must be ordered by email ascending");

    // Workspace isolation: listWorkforceMembers() takes zero arguments —
    // every call above already demonstrates there is no parameter through
    // which a second workspace could ever be requested.

    // ================================================================
    // R2B: addWorkforceMember() — real mutation against real Postgres,
    // reusing this same disposable container/seed (a fresh `@/db` Pool
    // cannot be opened a second time in this process — db/index.ts caches
    // its Pool on globalThis for the life of the module, so every
    // real-@/db scenario in this file must share the one container/test()
    // body established above, exactly like the read-only assertions).
    // ================================================================
    const freshTargetId = await seedUser("fresh-target@example.com");
    const ownerAttemptTargetId = await seedUser("owner-attempt-target@example.com");
    const raceTargetId = await seedUser("race-target@example.com");
    const nonInternalOrgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'Other org (non-internal)', false)", [nonInternalOrgId]);

    // 1. authorized ADMIN caller creates the expected normal membership.
    asUser(adminUserId);
    const added = await addWorkforceMember(freshTargetId, "EMPLOYEE");
    assert.deepEqual(added, { userId: freshTargetId, email: "fresh-target@example.com", role: "EMPLOYEE", status: "ACTIVE" });

    // It lands only in the internal workspace (never the non-internal one
    // seeded above), with the correct role and inviter recorded.
    const [freshRow] = (
      await pool.query("select id, workspace_org_id, role_id, status, invited_by_user_id from staff_members where user_id = $1", [freshTargetId])
    ).rows;
    assert.equal(freshRow.workspace_org_id, orgId);
    assert.notEqual(freshRow.workspace_org_id, nonInternalOrgId);
    assert.equal(freshRow.role_id, roleId.EMPLOYEE);
    assert.equal(freshRow.status, "ACTIVE");
    assert.equal(freshRow.invited_by_user_id, adminUserId);

    // The real logAudit() write path was used (lib/audit.ts) — no parallel
    // audit subsystem, real actor/workspace/target/role/timestamp.
    const [auditRow] = (
      await pool.query("select action, actor_user_id, organization_id, metadata from audit_log where target_type = 'staff_member' and target_id = $1", [
        freshRow.id,
      ])
    ).rows;
    assert.equal(auditRow.action, "workforce.member_added");
    assert.equal(auditRow.actor_user_id, adminUserId);
    assert.equal(auditRow.organization_id, orgId);
    assert.equal(auditRow.metadata.role, "EMPLOYEE");

    // 2. an unauthorized caller (MANAGER — no WORKFORCE_MANAGE permission)
    // cannot reach the write at all.
    asUser(managerUserId);
    await assert.rejects(() => addWorkforceMember(raceTargetId, "EMPLOYEE"), /NEXT_REDIRECT/);
    const [noRowForUnauthorized] = (await pool.query("select 1 from staff_members where user_id = $1", [raceTargetId])).rows;
    assert.equal(noRowForUnauthorized, undefined, "an unauthorized caller must never create a row");

    // 3. duplicate membership is rejected deterministically, and never
    // changes the existing member's role as a side effect.
    asUser(adminUserId);
    await assert.rejects(() => addWorkforceMember(freshTargetId, "MANAGER"), /already a workforce member/);
    const [freshRowAfterDuplicate] = (await pool.query("select role_id from staff_members where user_id = $1", [freshTargetId])).rows;
    assert.equal(freshRowAfterDuplicate.role_id, roleId.EMPLOYEE, "a duplicate add must never change the existing role");

    // 4. OWNER can never be created through this action.
    await assert.rejects(() => addWorkforceMember(ownerAttemptTargetId, "OWNER"), /workforce role must be one of/);
    const [noOwnerRow] = (await pool.query("select 1 from staff_members where user_id = $1", [ownerAttemptTargetId])).rows;
    assert.equal(noOwnerRow, undefined, "OWNER must never be creatable through R2B");

    // 5. an EXISTING OWNER cannot be mutated through this action — the
    // insert collides with staff_members_one_owner_per_workspace/
    // staff_members_user_workspace_unique exactly like any other
    // duplicate, and the OWNER's row is left untouched.
    await assert.rejects(() => addWorkforceMember(ownerUserId, "ADMIN"), /already a workforce member/);
    const [ownerRowAfter] = (await pool.query("select role_id from staff_members where user_id = $1", [ownerUserId])).rows;
    assert.equal(ownerRowAfter.role_id, roleId.OWNER, "an existing OWNER must never be mutated through this action");

    // 6. concurrency: two simultaneous adds for the same brand-new target
    // race against the real staff_members_user_workspace_unique index —
    // exactly one must win, the other must fail closed, and only one row
    // may ever exist.
    const raceResults = await Promise.allSettled([addWorkforceMember(raceTargetId, "EMPLOYEE"), addWorkforceMember(raceTargetId, "MANAGER")]);
    const raceFulfilled = raceResults.filter((r) => r.status === "fulfilled");
    const raceRejected = raceResults.filter((r) => r.status === "rejected");
    assert.equal(raceFulfilled.length, 1, "exactly one concurrent add must win");
    assert.equal(raceRejected.length, 1, "the other concurrent add must fail closed, never silently merge");
    assert.match(String(raceRejected[0].reason), /already a workforce member/);
    const raceRows = (await pool.query("select role_id from staff_members where user_id = $1", [raceTargetId])).rows;
    assert.equal(raceRows.length, 1, "no duplicate row may ever be created under concurrency");

    // 7. cross-workspace isolation: no staff_members row created by any of
    // the above ever references the non-internal workspace.
    const [{ count: nonInternalStaffCount }] = (
      await pool.query("select count(*)::int as count from staff_members where workspace_org_id = $1", [nonInternalOrgId])
    ).rows;
    assert.equal(nonInternalStaffCount, 0, "no staff_members row may ever be created in a non-internal workspace");

    // ================================================================
    // R2C: changeWorkforceMemberRole() — MANAGER <-> EMPLOYEE only, real
    // SELECT ... FOR UPDATE + same-transaction audit against real Postgres.
    // ================================================================
    const auditCount = async (staffMemberId) =>
      (
        await pool.query(
          "select count(*)::int as n from audit_log where action = 'workforce.member_role_changed' and target_id = $1",
          [staffMemberId],
        )
      ).rows[0].n;
    const smIdOf = async (userId) => (await pool.query("select id from staff_members where user_id = $1 and workspace_org_id = $2", [userId, orgId])).rows[0]?.id;
    const roleIdOf = async (userId, workspace = orgId) =>
      (await pool.query("select role_id from staff_members where user_id = $1 and workspace_org_id = $2", [userId, workspace])).rows[0]?.role_id;

    const r2cAdmin2Id = await seedUser("r2c-admin2@example.com");
    const r2cManagerId = await seedUser("r2c-manager@example.com");
    const r2cEmployeeId = await seedUser("r2c-employee@example.com");
    const r2cRaceSameId = await seedUser("r2c-race-same@example.com");
    const r2cRaceOppId = await seedUser("r2c-race-opp@example.com");
    const r2cNonInternalId = await seedUser("r2c-noninternal@example.com");
    for (const [uid, rid] of [
      [r2cAdmin2Id, roleId.ADMIN],
      [r2cManagerId, roleId.MANAGER],
      [r2cEmployeeId, roleId.EMPLOYEE],
      [r2cRaceSameId, roleId.MANAGER],
      [r2cRaceOppId, roleId.MANAGER],
    ]) {
      await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [uid, orgId, rid]);
    }
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [
      r2cNonInternalId,
      nonInternalOrgId,
      roleId.MANAGER,
    ]);

    asUser(adminUserId);

    // R2C-i. MANAGER (non-WORKFORCE_MANAGE) caller cannot reach the mutation.
    asUser(managerUserId);
    await assert.rejects(() => changeWorkforceMemberRole(r2cEmployeeId, "MANAGER"), /NEXT_REDIRECT/);
    asUser(adminUserId);

    // R2C-ii. the seeded OWNER cannot be changed (advisory + under-lock).
    await assert.rejects(() => changeWorkforceMemberRole(ownerUserId, "MANAGER"), /workspace owner and cannot be modified here/);
    assert.equal(await roleIdOf(ownerUserId), roleId.OWNER, "OWNER role_id must be unchanged");
    assert.equal(await auditCount(await smIdOf(ownerUserId)), 0, "no role-change audit for the OWNER");

    // R2C-iii. an ADMIN target cannot be changed through R2C (ADMIN tier reserved for OWNER_MANAGE).
    await assert.rejects(
      () => changeWorkforceMemberRole(r2cAdmin2Id, "MANAGER"),
      /changing an administrator's role requires owner privileges/,
    );
    assert.equal(await roleIdOf(r2cAdmin2Id), roleId.ADMIN, "ADMIN role_id must be unchanged");
    assert.equal(await auditCount(await smIdOf(r2cAdmin2Id)), 0);

    // R2C-iv. self-role change rejected (admin caller targeting themselves).
    await assert.rejects(() => changeWorkforceMemberRole(adminUserId, "MANAGER"), /cannot change their own role/);
    assert.equal(await roleIdOf(adminUserId), roleId.ADMIN);

    // R2C-v. a member of a NON-internal workspace is invisible to R2C.
    await assert.rejects(() => changeWorkforceMemberRole(r2cNonInternalId, "EMPLOYEE"), /workforce member not found/);
    assert.equal(await roleIdOf(r2cNonInternalId, nonInternalOrgId), roleId.MANAGER, "non-internal member untouched");

    // R2C-vi. MANAGER -> EMPLOYEE: only role_id + updated_at change; exactly one truthful audit.
    const beforeMgr = (
      await pool.query(
        "select id, role_id, workspace_org_id, user_id, status, invited_by_user_id, updated_at from staff_members where user_id = $1",
        [r2cManagerId],
      )
    ).rows[0];
    await new Promise((r) => setTimeout(r, 5)); // ensure updated_at can strictly advance
    const mgrResult = await changeWorkforceMemberRole(r2cManagerId, "EMPLOYEE");
    assert.deepEqual(mgrResult, { userId: r2cManagerId, email: "r2c-manager@example.com", role: "EMPLOYEE", status: "ACTIVE" });
    const afterMgr = (
      await pool.query(
        "select role_id, workspace_org_id, user_id, status, invited_by_user_id, updated_at from staff_members where user_id = $1",
        [r2cManagerId],
      )
    ).rows[0];
    assert.equal(afterMgr.role_id, roleId.EMPLOYEE);
    assert.equal(afterMgr.workspace_org_id, beforeMgr.workspace_org_id);
    assert.equal(afterMgr.user_id, beforeMgr.user_id);
    assert.equal(afterMgr.status, "ACTIVE");
    assert.equal(afterMgr.invited_by_user_id, beforeMgr.invited_by_user_id);
    assert.ok(new Date(afterMgr.updated_at) > new Date(beforeMgr.updated_at), "updated_at must strictly advance");
    const [mgrAudit] = (
      await pool.query(
        "select action, actor_user_id, organization_id, metadata from audit_log where action = 'workforce.member_role_changed' and target_id = $1",
        [beforeMgr.id],
      )
    ).rows;
    assert.equal(await auditCount(beforeMgr.id), 1, "exactly one role-change audit");
    assert.equal(mgrAudit.actor_user_id, adminUserId);
    assert.equal(mgrAudit.organization_id, orgId);
    assert.deepEqual(mgrAudit.metadata, { targetUserId: r2cManagerId, previousRole: "MANAGER", newRole: "EMPLOYEE" });

    // R2C-vii. EMPLOYEE -> MANAGER (symmetric).
    const empSmId = await smIdOf(r2cEmployeeId);
    const empResult = await changeWorkforceMemberRole(r2cEmployeeId, "MANAGER");
    assert.equal(empResult.role, "MANAGER");
    assert.equal(await roleIdOf(r2cEmployeeId), roleId.MANAGER);
    const [empAudit] = (
      await pool.query(
        "select metadata from audit_log where action = 'workforce.member_role_changed' and target_id = $1",
        [empSmId],
      )
    ).rows;
    assert.deepEqual(empAudit.metadata, { targetUserId: r2cEmployeeId, previousRole: "EMPLOYEE", newRole: "MANAGER" });

    // R2C-viii. no-op (already the target role) -> ROLE_UNCHANGED, no new audit.
    await assert.rejects(() => changeWorkforceMemberRole(r2cManagerId, "EMPLOYEE"), /already has this role/);
    assert.equal(await auditCount(beforeMgr.id), 1, "a no-op writes no audit");

    // R2C-ix. SUSPENDED / OFFBOARDING targets rejected, unchanged.
    await assert.rejects(() => changeWorkforceMemberRole(managerUserId, "EMPLOYEE"), /not active and cannot be modified/);
    assert.equal(await roleIdOf(managerUserId), roleId.MANAGER);
    await assert.rejects(() => changeWorkforceMemberRole(employeeUserId, "MANAGER"), /not active and cannot be modified/);
    assert.equal(await roleIdOf(employeeUserId), roleId.EMPLOYEE);

    // R2C-x. concurrency, SAME desired role: deterministic one-winner.
    const sameSmId = await smIdOf(r2cRaceSameId);
    const sameResults = await Promise.allSettled([
      changeWorkforceMemberRole(r2cRaceSameId, "EMPLOYEE"),
      changeWorkforceMemberRole(r2cRaceSameId, "EMPLOYEE"),
    ]);
    assert.equal(sameResults.filter((r) => r.status === "fulfilled").length, 1, "exactly one fulfilled");
    const sameRejected = sameResults.filter((r) => r.status === "rejected");
    assert.equal(sameRejected.length, 1);
    assert.match(String(sameRejected[0].reason), /already has this role/);
    assert.equal(await roleIdOf(r2cRaceSameId), roleId.EMPLOYEE, "final role EMPLOYEE");
    assert.equal(await auditCount(sameSmId), 1, "exactly one role-change audit under same-role concurrency");

    // R2C-xi. concurrency, OPPOSITE desired roles: ORDER-INDEPENDENT invariants.
    // Initial role MANAGER; one caller -> EMPLOYEE, one caller -> MANAGER.
    // Only two legal outcome classes exist (SET-TO-ROLE, serialized by the
    // row lock); which one occurs depends on lock-acquisition order:
    //   A) fulfilled === 1  -> the "-> MANAGER" caller locked first, saw
    //      MANAGER, got ROLE_UNCHANGED; the "-> EMPLOYEE" caller then did
    //      MANAGER -> EMPLOYEE. Final role EMPLOYEE, one audit {M -> E}.
    //   B) fulfilled === 2  -> the "-> EMPLOYEE" caller locked first
    //      (MANAGER -> EMPLOYEE), then the "-> MANAGER" caller (EMPLOYEE ->
    //      MANAGER). Final role MANAGER, two audits {M -> E, E -> M}.
    // NOTHING here relies on audit_log row order: audit_log has no monotonic
    // column, created_at is DEFAULT now() (transaction-start time), and two
    // concurrent transactions can carry equal or inverted created_at
    // relative to their commit order. Assertions are multiset / count based.
    const oppSmId = await smIdOf(r2cRaceOppId);
    const oppResults = await Promise.allSettled([
      changeWorkforceMemberRole(r2cRaceOppId, "EMPLOYEE"),
      changeWorkforceMemberRole(r2cRaceOppId, "MANAGER"),
    ]);
    const oppFulfilled = oppResults.filter((r) => r.status === "fulfilled");
    const oppRejected = oppResults.filter((r) => r.status === "rejected");
    assert.equal(oppFulfilled.length + oppRejected.length, 2);
    for (const r of oppRejected) {
      assert.match(String(r.reason), /already has this role/, "the only allowed rejection is ROLE_UNCHANGED");
      assert.doesNotMatch(String(r.reason), /state changed/, "opposite serialized transitions are never MEMBER_STATE_CHANGED");
    }
    assert.ok(oppFulfilled.length === 1 || oppFulfilled.length === 2, `unexpected fulfilled count: ${oppFulfilled.length}`);

    const oppAudits = (
      await pool.query(
        "select actor_user_id, organization_id, metadata from audit_log where action = 'workforce.member_role_changed' and target_id = $1",
        [oppSmId],
      )
    ).rows;
    assert.equal(oppAudits.length, oppFulfilled.length, "exactly one role-change audit per fulfilled call");

    // Per-row invariants (order-independent).
    for (const a of oppAudits) {
      assert.equal(a.actor_user_id, adminUserId);
      assert.equal(a.organization_id, orgId);
      assert.ok(["MANAGER", "EMPLOYEE"].includes(a.metadata.previousRole), `previousRole not ordinary: ${a.metadata.previousRole}`);
      assert.ok(["MANAGER", "EMPLOYEE"].includes(a.metadata.newRole), `newRole not ordinary: ${a.metadata.newRole}`);
      assert.notEqual(a.metadata.previousRole, a.metadata.newRole);
      assert.equal(a.metadata.targetUserId, r2cRaceOppId);
    }

    // Exactly one audit records departing from the seeded initial role.
    assert.equal(
      oppAudits.filter((a) => a.metadata.previousRole === "MANAGER").length,
      1,
      "exactly one audit leaves the seeded MANAGER role",
    );

    // Multiset of transitions must match one of the two legal shapes exactly.
    const oppTransitions = oppAudits.map((a) => `${a.metadata.previousRole}->${a.metadata.newRole}`).sort();
    const oppFinalRoleId = await roleIdOf(r2cRaceOppId);
    if (oppFulfilled.length === 1) {
      assert.deepEqual(oppTransitions, ["MANAGER->EMPLOYEE"], "Case A: the sole transition is MANAGER -> EMPLOYEE");
      assert.equal(oppFinalRoleId, roleId.EMPLOYEE, "Case A: final role EMPLOYEE");
    } else {
      assert.deepEqual(
        oppTransitions,
        ["EMPLOYEE->MANAGER", "MANAGER->EMPLOYEE"],
        "Case B: transitions are exactly {MANAGER -> EMPLOYEE, EMPLOYEE -> MANAGER}",
      );
      assert.equal(new Set(oppTransitions).size, 2, "Case B: no duplicated transition");
      assert.equal(oppFinalRoleId, roleId.MANAGER, "Case B: final role MANAGER");
    }

    // R2C-xii. OWNER race: concurrent attempts both rejected, OWNER untouched, no audit.
    const ownerSmId = await smIdOf(ownerUserId);
    const ownerRace = await Promise.allSettled([
      changeWorkforceMemberRole(ownerUserId, "MANAGER"),
      changeWorkforceMemberRole(ownerUserId, "EMPLOYEE"),
    ]);
    assert.equal(ownerRace.filter((r) => r.status === "fulfilled").length, 0, "no OWNER change may ever fulfil");
    for (const r of ownerRace) assert.match(String(r.reason), /workspace owner and cannot be modified here/);
    assert.equal(await roleIdOf(ownerUserId), roleId.OWNER);
    assert.equal(await auditCount(ownerSmId), 0);

    // R2C-xiii. cross-workspace isolation held throughout R2C.
    assert.equal(await roleIdOf(r2cNonInternalId, nonInternalOrgId), roleId.MANAGER, "the non-internal member's role never changed");

    // ================================================================
    // R2D-A: suspend / reactivate / offboard — MANAGER/EMPLOYEE only,
    // OFFBOARDING terminal, real SELECT ... FOR UPDATE + same-tx audit.
    // ================================================================
    const statusOf = async (userId, workspace = orgId) =>
      (await pool.query("select status from staff_members where user_id = $1 and workspace_org_id = $2", [userId, workspace])).rows[0]?.status;
    const statusAuditCount = async (staffMemberId) =>
      (
        await pool.query(
          "select count(*)::int as n from audit_log where action = 'workforce.member_status_changed' and target_id = $1",
          [staffMemberId],
        )
      ).rows[0].n;

    const r2dActiveMgrId = await seedUser("r2d-active-mgr@example.com");
    const r2dActiveEmpId = await seedUser("r2d-active-emp@example.com");
    const r2dSuspMgrId = await seedUser("r2d-susp-mgr@example.com");
    const r2dOffboardedId = await seedUser("r2d-offboarded@example.com");
    const r2dAdmin2Id = await seedUser("r2d-admin2@example.com");
    const r2dRaceSameId = await seedUser("r2d-race-same@example.com");
    const r2dRaceSuspOffId = await seedUser("r2d-race-suspoff@example.com");
    const r2dRaceReactOffId = await seedUser("r2d-race-reactoff@example.com");
    const r2dRaceR2cId = await seedUser("r2d-race-r2c@example.com");
    const r2dNonInternalId = await seedUser("r2d-noninternal@example.com");
    for (const [uid, rid, st] of [
      [r2dActiveMgrId, roleId.MANAGER, "ACTIVE"],
      [r2dActiveEmpId, roleId.EMPLOYEE, "ACTIVE"],
      [r2dSuspMgrId, roleId.MANAGER, "SUSPENDED"],
      [r2dOffboardedId, roleId.MANAGER, "OFFBOARDING"],
      [r2dAdmin2Id, roleId.ADMIN, "ACTIVE"],
      [r2dRaceSameId, roleId.MANAGER, "ACTIVE"],
      [r2dRaceSuspOffId, roleId.MANAGER, "ACTIVE"],
      [r2dRaceReactOffId, roleId.MANAGER, "SUSPENDED"],
      [r2dRaceR2cId, roleId.MANAGER, "ACTIVE"],
    ]) {
      await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,$4)", [uid, orgId, rid, st]);
    }
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [
      r2dNonInternalId,
      nonInternalOrgId,
      roleId.MANAGER,
    ]);

    asUser(adminUserId);

    // R2D-i. MANAGER (non-WORKFORCE_MANAGE) caller cannot reach lifecycle mutations.
    asUser(managerUserId);
    await assert.rejects(() => suspendWorkforceMember(r2dActiveEmpId), /NEXT_REDIRECT/);
    asUser(adminUserId);

    // R2D-ii. the seeded OWNER cannot be lifecycle-changed (advisory + under-lock).
    for (const fn of [suspendWorkforceMember, reactivateWorkforceMember, offboardWorkforceMember]) {
      await assert.rejects(() => fn(ownerUserId), /target is the workspace owner and cannot be modified here/);
    }
    assert.equal(await statusOf(ownerUserId), "ACTIVE", "OWNER status unchanged");
    assert.equal(await statusAuditCount(await smIdOf(ownerUserId)), 0, "no status audit for the OWNER");

    // R2D-iii. an ADMIN target cannot be lifecycle-changed through ordinary R2D-A.
    for (const fn of [suspendWorkforceMember, offboardWorkforceMember]) {
      await assert.rejects(() => fn(r2dAdmin2Id), /an administrator's lifecycle requires owner privileges/);
    }
    assert.equal(await statusOf(r2dAdmin2Id), "ACTIVE", "ADMIN status unchanged");
    assert.equal(await statusAuditCount(await smIdOf(r2dAdmin2Id)), 0);

    // R2D-iv. self lifecycle change rejected (admin caller targeting themselves).
    await assert.rejects(() => suspendWorkforceMember(adminUserId), /cannot change their own lifecycle status/);
    assert.equal(await statusOf(adminUserId), "ACTIVE");

    // R2D-v. a member of a NON-internal workspace is invisible to R2D.
    await assert.rejects(() => suspendWorkforceMember(r2dNonInternalId), /workforce member not found/);
    assert.equal(await statusOf(r2dNonInternalId, nonInternalOrgId), "ACTIVE", "non-internal member untouched");

    // R2D-vi. ACTIVE -> SUSPENDED: only status + updated_at change; one truthful audit.
    const beforeSusp = (
      await pool.query(
        "select id, role_id, workspace_org_id, user_id, invited_by_user_id, updated_at from staff_members where user_id = $1",
        [r2dActiveMgrId],
      )
    ).rows[0];
    await new Promise((r) => setTimeout(r, 5));
    const suspResult = await suspendWorkforceMember(r2dActiveMgrId);
    assert.deepEqual(suspResult, { userId: r2dActiveMgrId, email: "r2d-active-mgr@example.com", role: "MANAGER", status: "SUSPENDED" });
    const afterSusp = (
      await pool.query(
        "select role_id, workspace_org_id, user_id, invited_by_user_id, status, updated_at from staff_members where user_id = $1",
        [r2dActiveMgrId],
      )
    ).rows[0];
    assert.equal(afterSusp.status, "SUSPENDED");
    assert.equal(afterSusp.role_id, beforeSusp.role_id, "role_id unchanged");
    assert.equal(afterSusp.workspace_org_id, beforeSusp.workspace_org_id, "workspace_org_id unchanged");
    assert.equal(afterSusp.user_id, beforeSusp.user_id, "user_id unchanged");
    assert.equal(afterSusp.invited_by_user_id, beforeSusp.invited_by_user_id, "invited_by_user_id unchanged");
    assert.ok(new Date(afterSusp.updated_at) > new Date(beforeSusp.updated_at), "updated_at must strictly advance");
    assert.equal(await statusAuditCount(beforeSusp.id), 1, "exactly one status-change audit");
    const [suspAudit] = (
      await pool.query(
        "select actor_user_id, organization_id, metadata from audit_log where action = 'workforce.member_status_changed' and target_id = $1",
        [beforeSusp.id],
      )
    ).rows;
    assert.equal(suspAudit.actor_user_id, adminUserId);
    assert.equal(suspAudit.organization_id, orgId);
    assert.deepEqual(suspAudit.metadata, { targetUserId: r2dActiveMgrId, previousStatus: "ACTIVE", newStatus: "SUSPENDED" });

    // R2D-vii. SUSPENDED -> ACTIVE (reactivate), symmetric.
    const reactResult = await reactivateWorkforceMember(r2dActiveMgrId);
    assert.equal(reactResult.status, "ACTIVE");
    assert.equal(await statusOf(r2dActiveMgrId), "ACTIVE");
    const reactAudits = (
      await pool.query(
        "select metadata from audit_log where action = 'workforce.member_status_changed' and target_id = $1 order by (metadata->>'newStatus')",
        [beforeSusp.id],
      )
    ).rows.map((r) => r.metadata);
    assert.ok(
      reactAudits.some((m) => m.previousStatus === "SUSPENDED" && m.newStatus === "ACTIVE"),
      "a SUSPENDED->ACTIVE audit row exists",
    );

    // R2D-viii. ACTIVE -> OFFBOARDING and SUSPENDED -> OFFBOARDING.
    const offA = await offboardWorkforceMember(r2dActiveEmpId);
    assert.equal(offA.status, "OFFBOARDING");
    assert.equal(await statusOf(r2dActiveEmpId), "OFFBOARDING");
    const offS = await offboardWorkforceMember(r2dSuspMgrId);
    assert.equal(offS.status, "OFFBOARDING");
    assert.equal(await statusOf(r2dSuspMgrId), "OFFBOARDING");
    const [offSAudit] = (
      await pool.query(
        "select metadata from audit_log where action = 'workforce.member_status_changed' and target_id = $1",
        [await smIdOf(r2dSuspMgrId)],
      )
    ).rows;
    assert.deepEqual(offSAudit.metadata, { targetUserId: r2dSuspMgrId, previousStatus: "SUSPENDED", newStatus: "OFFBOARDING" });

    // R2D-ix. OFFBOARDING is terminal — suspend/reactivate on an offboarded member rejected, unchanged, no audit.
    const offSmId = await smIdOf(r2dOffboardedId);
    for (const fn of [suspendWorkforceMember, reactivateWorkforceMember]) {
      await assert.rejects(() => fn(r2dOffboardedId), /this lifecycle transition is not allowed/);
    }
    assert.equal(await statusOf(r2dOffboardedId), "OFFBOARDING", "offboarded member unchanged");
    assert.equal(await statusAuditCount(offSmId), 0, "no audit for a rejected terminal transition");

    // R2D-x. no-op: reactivate an ACTIVE / suspend a SUSPENDED -> STATUS_UNCHANGED, no audit.
    // r2dActiveMgrId is ACTIVE here (SUSPENDED then reactivated above); r2dRaceReactOffId is a seeded SUSPENDED member.
    await assert.rejects(() => reactivateWorkforceMember(r2dActiveMgrId), /already has this status/);
    await assert.rejects(() => suspendWorkforceMember(r2dRaceReactOffId), /already has this status/);
    assert.equal(await statusOf(r2dRaceReactOffId), "SUSPENDED", "a rejected no-op left status untouched");

    // R2D-xi. R2C is blocked once a member is SUSPENDED, and once OFFBOARDING.
    await suspendWorkforceMember(r2dRaceSameId); // ACTIVE -> SUSPENDED (reused below for concurrency; suspend it here first)
    await assert.rejects(() => changeWorkforceMemberRole(r2dRaceSameId, "EMPLOYEE"), /not active and cannot be modified/);
    assert.equal(await roleIdOf(r2dRaceSameId), roleId.MANAGER, "R2C must not have changed the role of a suspended member");
    await reactivateWorkforceMember(r2dRaceSameId); // restore ACTIVE for the concurrency test below
    await offboardWorkforceMember(r2dActiveMgrId); // ACTIVE -> OFFBOARDING
    await assert.rejects(() => changeWorkforceMemberRole(r2dActiveMgrId, "EMPLOYEE"), /not active and cannot be modified/);

    // R2D-xii. concurrency, SAME intent: two suspends on an ACTIVE member.
    const sameSmId2 = await smIdOf(r2dRaceSameId);
    const sameAuditsBefore = await statusAuditCount(sameSmId2);
    const dSame = await Promise.allSettled([suspendWorkforceMember(r2dRaceSameId), suspendWorkforceMember(r2dRaceSameId)]);
    assert.equal(dSame.filter((r) => r.status === "fulfilled").length, 1, "exactly one suspend fulfils");
    const dSameRejected = dSame.filter((r) => r.status === "rejected");
    assert.equal(dSameRejected.length, 1);
    assert.match(String(dSameRejected[0].reason), /already has this status/);
    assert.equal(await statusOf(r2dRaceSameId), "SUSPENDED", "final status SUSPENDED");
    assert.equal((await statusAuditCount(sameSmId2)) - sameAuditsBefore, 1, "exactly one new status audit under same-intent concurrency");

    // R2D-xiii. concurrency, suspend vs offboard from ACTIVE — ORDER-INDEPENDENT invariants.
    const soSmId = await smIdOf(r2dRaceSuspOffId);
    const dSuspOff = await Promise.allSettled([suspendWorkforceMember(r2dRaceSuspOffId), offboardWorkforceMember(r2dRaceSuspOffId)]);
    const soFulfilled = dSuspOff.filter((r) => r.status === "fulfilled");
    const soRejected = dSuspOff.filter((r) => r.status === "rejected");
    assert.equal(soFulfilled.length + soRejected.length, 2);
    for (const r of soRejected) {
      assert.doesNotMatch(String(r.reason), /state changed/, "no MEMBER_STATE_CHANGED for serialized lifecycle concurrency");
      assert.match(String(r.reason), /already has this status|this lifecycle transition is not allowed/);
    }
    const soAudits = (
      await pool.query(
        "select metadata from audit_log where action = 'workforce.member_status_changed' and target_id = $1",
        [soSmId],
      )
    ).rows.map((r) => r.metadata);
    assert.equal(soAudits.length, soFulfilled.length, "one status audit per fulfilled call");
    for (const m of soAudits) {
      assert.ok(["ACTIVE", "SUSPENDED", "OFFBOARDING"].includes(m.previousStatus));
      assert.ok(["ACTIVE", "SUSPENDED", "OFFBOARDING"].includes(m.newStatus));
      assert.notEqual(m.previousStatus, m.newStatus);
      assert.equal(m.targetUserId, r2dRaceSuspOffId);
    }
    // Whatever the interleaving, the member ends OFFBOARDING and a legal chain from ACTIVE explains the audits.
    assert.equal(await statusOf(r2dRaceSuspOffId), "OFFBOARDING", "suspend-vs-offboard always ends OFFBOARDING");
    assert.equal(soAudits.filter((m) => m.newStatus === "OFFBOARDING").length, 1, "exactly one transition into OFFBOARDING");

    // R2D-xiv. concurrency, reactivate vs offboard from SUSPENDED.
    const roSmId = await smIdOf(r2dRaceReactOffId);
    const dReactOff = await Promise.allSettled([reactivateWorkforceMember(r2dRaceReactOffId), offboardWorkforceMember(r2dRaceReactOffId)]);
    const roFulfilled = dReactOff.filter((r) => r.status === "fulfilled");
    for (const r of dReactOff.filter((x) => x.status === "rejected")) {
      assert.doesNotMatch(String(r.reason), /state changed/);
      assert.match(String(r.reason), /already has this status|this lifecycle transition is not allowed/);
    }
    const roAudits = (
      await pool.query("select metadata from audit_log where action = 'workforce.member_status_changed' and target_id = $1", [roSmId])
    ).rows.map((r) => r.metadata);
    assert.equal(roAudits.length, roFulfilled.length);
    assert.equal(await statusOf(r2dRaceReactOffId), "OFFBOARDING", "reactivate-vs-offboard always ends OFFBOARDING");
    assert.equal(roAudits.filter((m) => m.newStatus === "OFFBOARDING").length, 1);

    // R2D-xv. R2C vs R2D race on the same ACTIVE MANAGER — both serialized on the row lock.
    const r2cr2dSmId = await smIdOf(r2dRaceR2cId);
    const dRace = await Promise.allSettled([changeWorkforceMemberRole(r2dRaceR2cId, "EMPLOYEE"), suspendWorkforceMember(r2dRaceR2cId)]);
    for (const r of dRace.filter((x) => x.status === "rejected")) {
      assert.doesNotMatch(String(r.reason), /state changed/, "no MEMBER_STATE_CHANGED in the R2C/R2D race");
      assert.match(String(r.reason), /not active and cannot be modified|already has this|not allowed/);
    }
    const finalRoleId = await roleIdOf(r2dRaceR2cId);
    const finalStatus = await statusOf(r2dRaceR2cId);
    assert.ok([roleId.MANAGER, roleId.EMPLOYEE].includes(finalRoleId), "role_id is coherent");
    assert.ok(["ACTIVE", "SUSPENDED"].includes(finalStatus), "status is coherent");
    // Every audit row for this member (role-change and/or status-change) is truthful.
    const raceRoleAudits = (
      await pool.query("select metadata from audit_log where action = 'workforce.member_role_changed' and target_id = $1", [r2cr2dSmId])
    ).rows.map((r) => r.metadata);
    for (const m of raceRoleAudits) assert.equal(m.previousRole, "MANAGER");
    const raceStatusAudits = (
      await pool.query("select metadata from audit_log where action = 'workforce.member_status_changed' and target_id = $1", [r2cr2dSmId])
    ).rows.map((r) => r.metadata);
    for (const m of raceStatusAudits) assert.equal(m.previousStatus, "ACTIVE");

    // R2D-xvi. cross-workspace isolation held throughout R2D.
    assert.equal(await statusOf(r2dNonInternalId, nonInternalOrgId), "ACTIVE", "the non-internal member's status never changed");
    assert.equal(await roleIdOf(r2dNonInternalId, nonInternalOrgId), roleId.MANAGER);

    // Audit rollback (UPDATE reverts if the in-transaction logAudit throws)
    // is proven by the unit suite (R2C-22) + the single db.transaction()
    // structure: logAudit(..., tx) runs inside the same tx as the UPDATE,
    // so a failure there aborts both — standard Postgres semantics, and the
    // same logAudit(..., tx) pattern R2B already relies on. Forcing that
    // failure against real Postgres here would need either a forbidden
    // test-only runtime seam or an audit_log schema mutation, so it is not
    // reproduced at this layer.

    // @/db's own module-scoped Pool (db/index.ts caches it on
    // globalThis.pgPool) was opened as a side effect of importing
    // workforce.ts above and is never otherwise closed — end it BEFORE
    // destroying the container, or its idle connections get abruptly
    // severed by the container's death and surface as an async
    // "unexpected postmaster exit" error after this test has already
    // finished.
    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
