// lib/actions/workforce-invitations.integration.test.mjs — WORKFORCE
// INVITATION V1 — disposable-Postgres proof that inviteWorkforceMember()'s
// REAL query/mutation logic (not an injected fake) enforces every rule this
// chantier specifies, against a real staff_invitations row. Mirrors the
// exact disposable-container pattern already established by
// lib/actions/workforce.integration.test.mjs — one disposable Postgres +
// one seed for the whole file (never a shared describe/before/after:
// node:test defers registered-test execution until after the whole module
// finishes evaluating, so a module-level `finally` teardown would destroy
// the container before any test ever runs).
//
// @/lib/session's requireSession() is mocked (the same boundary every
// Axis-C integration test in this codebase mocks — a real Clerk auth()
// call can't run outside a Next.js request; see lib/actions/
// workforce.integration.test.mjs's own header comment). @/lib/notifications
// is mocked too, for the same "server-only" transitive-import reason that
// file documents — its own getInternalOrganizationId() replacement runs
// the identical real query against this same disposable pool. Real Clerk
// invitation-ticket creation and real Resend sending are both replaced by
// injected fakes passed as inviteWorkforceMember()'s own dependency
// parameters are NOT exposed on the exported function — instead this file
// verifies the OBSERVABLE effect (a `pending` staff_invitations row +
// exactly one `workforce.member_invited` audit row) rather than the
// Clerk/Resend side effects, which lib/actions/workforce-invitations.ts's
// own header comment documents as best-effort and never required for
// correctness. @/db is deliberately NOT mocked.
//
// claimPendingStaffInvitation() (lib/session.ts) is intentionally NOT
// exercised here — it needs the REAL, unmocked lib/session.ts, which is
// impossible in the same test file once @/lib/session is mocked for
// requireSession(). See lib/session-staff-invitation-claim.integration.test.mjs
// for its own dedicated disposable-Postgres coverage.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/workforce-invitations.integration.test.mjs
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
  const user = "workforce_invite";
  const password = "workforce_invite_local_only";
  const db = "workforce_invite_check";
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

test("WORKFORCE INVITATION V1 integration: inviteWorkforceMember() full authorization + validation pipeline against real Postgres", async () => {
  const { url, pool, stop } = await startDisposablePostgres("workforce-invite");
  try {
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

    const orgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);

    async function seedUser(email) {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [id, `clerk_${id}`, email]);
      return id;
    }

    const ownerUserId = await seedUser("owner@example.com");
    const adminUserId = await seedUser("admin@example.com");
    const admin2UserId = await seedUser("admin2@example.com");
    const managerUserId = await seedUser("manager@example.com");
    const employeeUserId = await seedUser("employee@example.com");
    const noMembershipUserId = await seedUser("nomembership@example.com");
    await seedUser("existing-no-staff@example.com");

    const roleRows = (await pool.query("select id, name from staff_roles order by name")).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));

    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [ownerUserId, orgId, roleId.OWNER]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [adminUserId, orgId, roleId.ADMIN]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [admin2UserId, orgId, roleId.ADMIN]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [managerUserId, orgId, roleId.MANAGER]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [employeeUserId, orgId, roleId.EMPLOYEE]);
    // noMembershipUserId and existingNoStaffUserId deliberately get zero staff_members rows.

    process.env.DATABASE_URL = url;

    /** @type {{ kind: "unauthenticated" } | { kind: "session"; userId: string; email: string }} */
    let sessionMockState = { kind: "unauthenticated" };
    mock.module("@/lib/session", {
      namedExports: {
        requireSession: async () => {
          if (sessionMockState.kind === "unauthenticated") {
            const err = new Error("NEXT_REDIRECT");
            err.digest = "NEXT_REDIRECT;replace;/sign-in;307;";
            throw err;
          }
          return { userId: sessionMockState.userId, email: sessionMockState.email };
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

    const { inviteWorkforceMember } = await import(
      "/Users/arnoldbenzaie/Documents/projects.md/digitalnova/.claude/worktrees/chantier1-phase2-quote-public-page/app/lib/actions/workforce-invitations.ts"
    );

    const emailsByUser = {
      [ownerUserId]: "owner@example.com",
      [adminUserId]: "admin@example.com",
      [admin2UserId]: "admin2@example.com",
      [managerUserId]: "manager@example.com",
      [employeeUserId]: "employee@example.com",
      [noMembershipUserId]: "nomembership@example.com",
    };
    const asUser = (userId) => { sessionMockState = { kind: "session", userId, email: emailsByUser[userId] }; };

    async function countInvitations(email) {
      const r = await pool.query("select status, role_id, invited_by_user_id from staff_invitations where email = $1", [email.toLowerCase()]);
      return r.rows;
    }
    async function countAudit(action, targetId) {
      const r = await pool.query("select actor_user_id, metadata from audit_log where action = $1 and target_id = $2", [action, targetId]);
      return r.rows;
    }

    // ---- 1. OWNER can invite EMPLOYEE (brand-new email, not in `users`) ----
    asUser(ownerUserId);
    const r1 = await inviteWorkforceMember("Jean.Dupont@Example.com", "EMPLOYEE");
    assert.deepEqual(r1, { id: r1.id, email: "jean.dupont@example.com", role: "EMPLOYEE", status: "pending", emailSent: false }, "normalized (trim+lowercase); emailSent:false since RESEND_API_KEY is unset in this test process");
    const invited1 = await countInvitations("jean.dupont@example.com");
    assert.equal(invited1.length, 1);
    assert.equal(invited1[0].status, "pending");
    assert.equal(invited1[0].role_id, roleId.EMPLOYEE);
    assert.equal(invited1[0].invited_by_user_id, ownerUserId);
    const auditRows1 = await countAudit("workforce.member_invited", r1.id);
    assert.equal(auditRows1.length, 1);
    assert.equal(auditRows1[0].actor_user_id, ownerUserId);
    assert.deepEqual(auditRows1[0].metadata, { email: "jean.dupont@example.com", role: "EMPLOYEE" });
    // No users / staff_members / memberships row was created by inviting alone.
    assert.equal((await pool.query("select 1 from users where email = $1", ["jean.dupont@example.com"])).rowCount, 0);

    // ---- 2. OWNER can invite MANAGER, ADMIN ----
    asUser(ownerUserId);
    const r2 = await inviteWorkforceMember("new-manager@example.com", "MANAGER");
    assert.equal(r2.role, "MANAGER");
    const r3 = await inviteWorkforceMember("new-admin@example.com", "ADMIN");
    assert.equal(r3.role, "ADMIN");

    // ---- 3. OWNER cannot invite OWNER (role rejected before any write) ----
    asUser(ownerUserId);
    await assert.rejects(() => inviteWorkforceMember("someone@example.com", "OWNER"), /workforce role must be one of/);
    assert.equal((await countInvitations("someone@example.com")).length, 0);

    // ---- 4. ADMIN can invite EMPLOYEE, MANAGER, and ANOTHER ADMIN ----
    asUser(adminUserId);
    const r4 = await inviteWorkforceMember("admin-invited-employee@example.com", "EMPLOYEE");
    assert.equal(r4.role, "EMPLOYEE");
    const r5 = await inviteWorkforceMember("admin-invited-manager@example.com", "MANAGER");
    assert.equal(r5.role, "MANAGER");
    const r6 = await inviteWorkforceMember("admin-invited-admin@example.com", "ADMIN");
    assert.equal(r6.role, "ADMIN");
    assert.equal((await countAudit("workforce.member_invited", r6.id))[0].actor_user_id, adminUserId);

    // ---- 5. MANAGER / EMPLOYEE / no-membership (CLIENT-equivalent) callers -> DENY ----
    for (const denied of [managerUserId, employeeUserId, noMembershipUserId]) {
      asUser(denied);
      await assert.rejects(() => inviteWorkforceMember("blocked-target@example.com", "EMPLOYEE"), /NEXT_REDIRECT/);
    }
    assert.equal((await countInvitations("blocked-target@example.com")).length, 0, "a denied caller writes nothing");

    // ---- 6. existing `users` row with NO staff_members -> invite still works normally ----
    asUser(ownerUserId);
    const r7 = await inviteWorkforceMember("existing-no-staff@example.com", "EMPLOYEE");
    assert.equal(r7.email, "existing-no-staff@example.com");
    assert.equal((await countInvitations("existing-no-staff@example.com")).length, 1);

    // ---- 7. existing OWNER's email -> DENY, distinct reason, no write ----
    asUser(adminUserId);
    await assert.rejects(() => inviteWorkforceMember("owner@example.com", "EMPLOYEE"), /target is the workspace owner and cannot be invited/);
    assert.equal((await countInvitations("owner@example.com")).length, 0);

    // ---- 8. existing ADMIN's email (already a workforce member) -> DENY ----
    asUser(ownerUserId);
    await assert.rejects(() => inviteWorkforceMember("admin2@example.com", "EMPLOYEE"), /target is already a workforce member of this workspace/);

    // ---- 9. duplicate pending invitation for the same email -> DENY, no second row ----
    asUser(ownerUserId);
    await assert.rejects(() => inviteWorkforceMember("jean.dupont@example.com", "MANAGER"), /a pending workforce invitation already exists for this email/);
    assert.equal((await countInvitations("jean.dupont@example.com")).length, 1, "still exactly one row — no duplicate, no silent resend");

    // ---- 10. self-invitation -> DENY ----
    asUser(adminUserId);
    await assert.rejects(() => inviteWorkforceMember("admin@example.com", "EMPLOYEE"), /you cannot invite yourself/);

    // ---- 11. invalid email shape -> DENY before any DB write ----
    asUser(ownerUserId);
    await assert.rejects(() => inviteWorkforceMember("not-an-email", "EMPLOYEE"), /invitation email must be a valid e-mail address/);
    await assert.rejects(() => inviteWorkforceMember("", "EMPLOYEE"), /invitation email must be a valid e-mail address/);

    // ---- 12. case-insensitive duplicate detection ----
    asUser(ownerUserId);
    await assert.rejects(() => inviteWorkforceMember("JEAN.DUPONT@EXAMPLE.COM", "EMPLOYEE"), /a pending workforce invitation already exists for this email/);

    // ---- 13. workspace correctness: every invitation row belongs to the one internal org ----
    const allPending = await pool.query("select distinct workspace_org_id from staff_invitations");
    assert.deepEqual(allPending.rows.map((r) => r.workspace_org_id), [orgId]);

    // @/db's own module-scoped Pool (db/index.ts caches it on
    // globalThis.pgPool) was opened as a side effect of importing
    // workforce-invitations.ts above and is never otherwise closed — end it
    // BEFORE destroying the container, or its idle connections get
    // abruptly severed by the container's death and surface as an async
    // "unexpected postmaster exit" error after this test has already
    // finished (same fix as lib/actions/workforce.integration.test.mjs).
    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
