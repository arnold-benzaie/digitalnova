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

    // listWorkforceMembers/addWorkforceMember are the ONLY runtime-capable
    // exports of this module (see RBAC-RUNTIME-R2A-API-SURFACE-HARDENING-1
    // and RBAC-RUNTIME-R2B-WORKFORCE-MUTATION-FOUNDATION-1) — every
    // assertion below goes through them, exactly as any real caller must.
    const { listWorkforceMembers, addWorkforceMember } = await import(
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
