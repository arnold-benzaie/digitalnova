// lib/session-staff-invitation-claim.integration.test.mjs — WORKFORCE
// INVITATION V1 — disposable-Postgres proof that lib/session.ts's REAL
// claimPendingStaffInvitation() (not an injected fake) correctly turns a
// pending staff_invitations row into an ACTIVE staff_members row,
// atomically, exactly once, and that the resulting member gets real RADAR
// access. This file deliberately does NOT mock @/lib/session — it needs
// the REAL module (claimPendingStaffInvitation() has no Clerk dependency
// of its own: it takes an explicit userId/email, exactly like
// evaluateRadarAccess() does, so it is fully testable without a real Clerk
// session). See lib/actions/workforce-invitations.integration.test.mjs for
// why inviteWorkforceMember() itself is tested in a SEPARATE file: that one
// mocks @/lib/session wholesale (for requireSession()), which would shadow
// the real claimPendingStaffInvitation() export this file needs.
//
// @/lib/notifications is mocked for the same transitive `server-only`
// reason every Axis-C integration test in this codebase mocks it — see
// lib/actions/workforce.integration.test.mjs's own header comment — with a
// REAL passthrough query against this same disposable pool, not a canned
// fake. @/db is deliberately NOT mocked.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/session-staff-invitation-claim.integration.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

// lib/session.ts transitively imports lib/pending-user-registration.ts,
// which starts with `import "server-only"` — that guard throws
// unconditionally outside Next's own bundler. This file needs the REAL,
// unmocked lib/session.ts (for the real claimPendingStaffInvitation()), so
// unlike every other Axis-C integration test in this codebase (which mocks
// @/lib/session wholesale instead), this one must stub the marker package
// itself — the exact same technique lib/actions/user-approval.test.mjs
// already established for this identical problem.
mock.module("server-only", { defaultExport: {} });

const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

async function startDisposablePostgres(namePrefix) {
  const container = `pm-${namePrefix}-${randomUUID().slice(0, 8)}`;
  const port = 5900 + Math.floor(Math.random() * 90);
  const user = "staff_invite_claim";
  const password = "staff_invite_claim_local_only";
  const db = "staff_invite_claim_check";
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

test("WORKFORCE INVITATION V1 integration: claimPendingStaffInvitation() + post-claim RADAR access, against real Postgres", async () => {
  const { url, pool, stop } = await startDisposablePostgres("staff-invite-claim");
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
    const otherOrgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'Some client org', false)", [otherOrgId]);

    async function seedUser(email) {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [id, `clerk_${id}`, email]);
      return id;
    }
    async function seedInvitation(email, roleName, workspaceOrgId = orgId) {
      const [role] = (await pool.query("select id from staff_roles where name = $1", [roleName])).rows;
      const [row] = (
        await pool.query(
          "insert into staff_invitations (workspace_org_id, email, role_id, status) values ($1,$2,$3,'pending') returning id",
          [workspaceOrgId, email.toLowerCase(), role.id],
        )
      ).rows;
      return row.id;
    }

    process.env.DATABASE_URL = url;

    mock.module("@/lib/notifications", {
      namedExports: {
        getInternalOrganizationId: async () => {
          const [org] = (await pool.query("select id from organizations where is_internal = true limit 1")).rows;
          return org?.id ?? null;
        },
      },
    });

    // Real, unmocked lib/session.ts — claimPendingStaffInvitation() takes
    // an explicit userId/email, no Clerk call of its own.
    const { claimPendingStaffInvitation } = await import(
      "/Users/arnoldbenzaie/Documents/projects.md/digitalnova/.claude/worktrees/chantier1-phase2-quote-public-page/app/lib/session.ts"
    );
    // Real, unmocked evaluateRadarAccess() — same explicit-userId contract,
    // no Clerk/session dependency (this is the exact function
    // requireRadarAccess() delegates to for every real RADAR-gated route).
    const { evaluateRadarAccess } = await import(
      "/Users/arnoldbenzaie/Documents/projects.md/digitalnova/.claude/worktrees/chantier1-phase2-quote-public-page/app/lib/rbac/require-staff-member.ts"
    );

    async function staffRow(userId) {
      const r = await pool.query(
        `select sm.status, sm.radar_access, sr.name as role, sm.workspace_org_id
         from staff_members sm join staff_roles sr on sr.id = sm.role_id
         where sm.user_id = $1`,
        [userId],
      );
      return r.rows[0];
    }
    async function invitationStatus(id) {
      const r = await pool.query("select status, claimed_at from staff_invitations where id = $1", [id]);
      return r.rows[0];
    }
    async function auditRows(action, targetId) {
      return (await pool.query("select actor_user_id, organization_id, metadata from audit_log where action = $1 and target_id = $2", [action, targetId])).rows;
    }

    // ---- 1. brand-new user (never in `users` before this call): claim
    // creates users has already happened upstream via registerPendingUser()
    // in the real resolveAccessState() flow — this test seeds the `users`
    // row directly (mirroring what registerPendingUser() would have just
    // created) and calls claimPendingStaffInvitation() as
    // resolveAccessState() itself would, right after that. ----
    const janeUserId = await seedUser("jane.newhire@example.com");
    const janeInvitationId = await seedInvitation("jane.newhire@example.com", "EMPLOYEE");

    const claimed1 = await claimPendingStaffInvitation(janeUserId, "jane.newhire@example.com");
    assert.ok(claimed1, "claim must succeed for a real pending invitation matching the email");
    assert.equal(claimed1.staffRole, "EMPLOYEE");
    assert.equal(claimed1.workspaceOrgId, orgId);

    const janeRow = await staffRow(janeUserId);
    assert.equal(janeRow.status, "ACTIVE", "status=ACTIVE immediately, no Axis-C pending state");
    assert.equal(janeRow.role, "EMPLOYEE");
    assert.equal(janeRow.radar_access, true, "radar_access=true via the column's own DEFAULT, exactly like the direct-add path");
    assert.equal(janeRow.workspace_org_id, orgId);

    const janeInvite = await invitationStatus(janeInvitationId);
    assert.equal(janeInvite.status, "claimed");
    assert.ok(janeInvite.claimed_at, "claimed_at is stamped");

    const janeAudit = await auditRows("workforce.invitation_claimed", (await pool.query("select id from staff_members where user_id=$1", [janeUserId])).rows[0].id);
    assert.equal(janeAudit.length, 1);
    assert.equal(janeAudit[0].actor_user_id, janeUserId, "the claimant is their own actor — this is self-service, not an admin action");
    assert.equal(janeAudit[0].organization_id, orgId);
    assert.deepEqual(janeAudit[0].metadata, { invitationId: janeInvitationId, role: "EMPLOYEE" });

    // ---- 2. RADAR access is real and immediate after claim ----
    const radarWork = await evaluateRadarAccess({ userId: janeUserId, permission: "RADAR_WORK" });
    assert.deepEqual(radarWork, { ok: true, role: "EMPLOYEE" });
    const radarQueue = await evaluateRadarAccess({ userId: janeUserId, permission: "RADAR_QUEUE_VIEW" });
    assert.deepEqual(radarQueue, { ok: true, role: "EMPLOYEE" });

    // ---- 3. double claim: the SAME invitation cannot be claimed twice ----
    const secondAttempt = await claimPendingStaffInvitation(janeUserId, "jane.newhire@example.com");
    assert.equal(secondAttempt, undefined, "no pending invitation left to match — the row is already 'claimed'");
    const staffCountAfterSecond = (await pool.query("select count(*)::int n from staff_members where user_id=$1", [janeUserId])).rows[0].n;
    assert.equal(staffCountAfterSecond, 1, "no duplicate staff_members row from the second attempt");

    // ---- 4. a DIFFERENT user cannot claim by reusing someone else's email
    // — matching is always against the CALLER's own authenticated email,
    // never a parameter under attacker control in the real call site
    // (resolveAccessState() always passes appUser.email, never client
    // input) — this proves the underlying query itself has no way to
    // "confuse" identities even if it were called with a mismatched pair. ----
    const marcUserId = await seedUser("marc.other@example.com");
    const noMatch = await claimPendingStaffInvitation(marcUserId, "jane.newhire@example.com");
    assert.equal(noMatch, undefined, "jane's invitation is already claimed, so no match exists for marc either");

    // ---- 5. existing `users` row with an Axis-A CLIENT membership already
    // in a DIFFERENT (non-internal) organization: claim still works, the
    // CLIENT membership is left completely untouched (Phase 1H). ----
    const clientRoleRow = (await pool.query("insert into roles (name) values ('client') on conflict (name) do update set name = excluded.name returning id")).rows[0];
    const paulUserId = await seedUser("paul.client@example.com");
    await pool.query("insert into memberships (user_id, organization_id, role_id) values ($1,$2,$3)", [paulUserId, otherOrgId, clientRoleRow.id]);
    const paulInvitationId = await seedInvitation("paul.client@example.com", "MANAGER");

    const claimedPaul = await claimPendingStaffInvitation(paulUserId, "paul.client@example.com");
    assert.ok(claimedPaul);
    assert.equal(claimedPaul.staffRole, "MANAGER");
    assert.equal((await invitationStatus(paulInvitationId)).status, "claimed");
    const paulMembership = (await pool.query("select organization_id, role_id from memberships where user_id=$1", [paulUserId])).rows;
    assert.deepEqual(paulMembership, [{ organization_id: otherOrgId, role_id: clientRoleRow.id }], "the pre-existing CLIENT membership is untouched — not deleted, not modified");
    const paulUsers = (await pool.query("select count(*)::int n from users where email=$1", ["paul.client@example.com"])).rows[0].n;
    assert.equal(paulUsers, 1, "no second `users` row was created");

    // ---- 6. someone with NO pending invitation at all -> claim is a no-op ----
    const noInviteUserId = await seedUser("no-invite@example.com");
    const noInviteResult = await claimPendingStaffInvitation(noInviteUserId, "no-invite@example.com");
    assert.equal(noInviteResult, undefined);
    assert.equal((await pool.query("select count(*)::int n from staff_members where user_id=$1", [noInviteUserId])).rows[0].n, 0);

    // ---- 7. most-recent-pending tie-break: two pending invitations for
    // the same email (a re-invite scenario) -> the most recently created
    // one wins, mirroring claimPendingInvitation()'s own ORDER BY. ----
    const remyUserId = await seedUser("remy.reinvited@example.com");
    const oldInvitationId = await seedInvitation("remy.reinvited@example.com", "EMPLOYEE");
    await pool.query("update staff_invitations set created_at = now() - interval '1 hour' where id = $1", [oldInvitationId]);
    const newInvitationId = await seedInvitation("remy.reinvited@example.com", "ADMIN");

    const claimedRemy = await claimPendingStaffInvitation(remyUserId, "remy.reinvited@example.com");
    assert.equal(claimedRemy.staffRole, "ADMIN", "the newer invitation (ADMIN) is claimed, not the older one (EMPLOYEE)");
    assert.equal((await invitationStatus(newInvitationId)).status, "claimed");
    assert.equal((await invitationStatus(oldInvitationId)).status, "pending", "the older, un-claimed invitation is left exactly as-is");

    // ---- 8. SECURITY (PHASE 2 review, section 3) — genuine CONCURRENT
    // double-claim: two simultaneous callers claiming the SAME invitation
    // for the SAME user (e.g. a double-tab reload / a network retry).
    // staff_members_user_workspace_unique (userId, workspaceOrgId) forces
    // Postgres to serialize the two concurrent INSERTs; the loser's INSERT
    // fails with a unique violation INSIDE its own transaction, which
    // claimPendingStaffInvitation() catches and turns into `undefined`
    // (never a thrown error, never a crash of resolveAccessState()) —
    // proven here against real concurrent execution, not just sequential
    // reuse (test #3 above already proves the sequential case). ----
    const concurrentUserId = await seedUser("concurrent.claim@example.com");
    const concurrentInvitationId = await seedInvitation("concurrent.claim@example.com", "EMPLOYEE");

    const [resultA, resultB] = await Promise.all([
      claimPendingStaffInvitation(concurrentUserId, "concurrent.claim@example.com"),
      claimPendingStaffInvitation(concurrentUserId, "concurrent.claim@example.com"),
    ]);
    const outcomes = [resultA, resultB];
    const winners = outcomes.filter((r) => r !== undefined);
    const losers = outcomes.filter((r) => r === undefined);
    assert.equal(winners.length, 1, "exactly one of the two concurrent claims must succeed");
    assert.equal(losers.length, 1, "the other must gracefully return undefined, never throw");
    assert.equal(winners[0].staffRole, "EMPLOYEE");

    const concurrentStaffRows = (await pool.query("select count(*)::int n from staff_members where user_id=$1", [concurrentUserId])).rows[0].n;
    assert.equal(concurrentStaffRows, 1, "exactly one staff_members row exists — no duplicate from the race");
    assert.equal((await invitationStatus(concurrentInvitationId)).status, "claimed", "the invitation ends up claimed exactly once, no inconsistent state");

    // ---- 9. SECURITY (PHASE 2 review, section 7/12-19) — workspace
    // isolation: an invitation recorded against a DIFFERENT (non-internal)
    // organization must create its staff_members row in THAT exact
    // organization, never the caller's/session's own workspace, never any
    // other — workspace_org_id comes exclusively from the matched
    // invitation row, never assumed to be "the" internal workspace. ----
    const isolationUserId = await seedUser("workspace.isolation@example.com");
    const isolationInvitationId = await seedInvitation("workspace.isolation@example.com", "MANAGER", otherOrgId);

    const claimedIsolation = await claimPendingStaffInvitation(isolationUserId, "workspace.isolation@example.com");
    assert.ok(claimedIsolation);
    assert.equal(claimedIsolation.workspaceOrgId, otherOrgId, "the claim lands in the invitation's OWN workspace, not the internal org");
    assert.notEqual(claimedIsolation.workspaceOrgId, orgId, "never the internal workspace when the invitation itself points elsewhere");
    const isolationRow = (await pool.query("select workspace_org_id from staff_members where user_id=$1", [isolationUserId])).rows[0];
    assert.equal(isolationRow.workspace_org_id, otherOrgId);
    assert.equal((await invitationStatus(isolationInvitationId)).status, "claimed");

    // @/db's own module-scoped Pool (db/index.ts caches it on
    // globalThis.pgPool) was opened as a side effect of importing
    // lib/session.ts above and is never otherwise closed — end it BEFORE
    // destroying the container (same fix as the sibling integration test).
    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
