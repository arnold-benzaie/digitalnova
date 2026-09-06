// PHASE RBAC-OWNER-DB-INVARIANT-IMPLEMENTATION-1 — disposable-container
// integration tests proving migration 0035 (hand-appended after the
// drizzle-kit-generated partial unique index) correctly:
//   - normalizes the OWNER staff_roles row to a fixed, well-known id
//     BEFORE the index is created, repointing every known dependent FK
//     (staff_members.role_id, staff_invitations.role_id);
//   - DB-enforces AT-MOST-ONE OWNER staff_members row per workspace;
//   - fails atomically and closed on any pre-existing multi-OWNER
//     violation, leaving the old OWNER role and all original references
//     completely untouched — never choosing a winner or demoting anyone;
//   - never requires any staff_members row to exist (zero OWNER
//     memberships remains legal both before and immediately after).
//
// Each scenario that needs a specific PRE-migration database state spins
// its OWN ephemeral postgres:16-alpine (random name + port, --rm,
// destroyed in that scenario's own `after`) and first replays a
// 0000..0034 boundary folder (built at runtime by filtering the real
// committed db/migrations/meta/_journal.json to idx<=34 and copying
// those exact .sql files into a temp dir — never editing history) before
// seeding fixtures and applying the REAL db/migrations folder (0000..35)
// on top, which then only has 0035 pending. This mirrors the exact
// pattern already used by scripts/db-migrate.hardening.integration.test.mjs
// and scripts/rbac-mig-tooling.integration.test.mjs. NEVER touches
// Preview/Production or any remote host.
//
// Requires Docker. Run:
//   npx tsx --test scripts/rbac-owner-invariant.integration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

import { run as runMigrate, STRUCTURAL_VERIFIERS } from "./db-migrate.mjs";

const FIXED_OWNER_ID = "6a615714-4eb7-44f3-993b-f113292f0aa2";
const NEW_TAG = "0035_tough_phil_sheldon"; // the migration THIS suite structurally verifies (OWNER normalization + index strength)
const JOURNAL_TIP_TAG = "0038_pink_triton"; // current tip of the real db/migrations journal (RADAR-CORE-3A added the additive tasks.assigned_user_id / created_by_user_id migration on top of 0037; this suite's 0035 assertions are unaffected — only the total count / tip tag move)
const JOURNAL_MIGRATION_COUNT = 39; // 0000..0038 inclusive
const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

/** Build a temp 0000..0034 boundary migrations folder (idx<=34), excluding 0035. Caller must rm it. */
function buildBoundaryFolder() {
  const journal = JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8"));
  const entries = journal.entries.filter((e) => e.idx <= 34);
  const dir = `/tmp/rbac-owner-boundary-${randomUUID().slice(0, 8)}`;
  mkdirSync(`${dir}/meta`, { recursive: true });
  for (const e of entries) cpSync(`db/migrations/${e.tag}.sql`, `${dir}/${e.tag}.sql`);
  writeFileSync(`${dir}/meta/_journal.json`, JSON.stringify({ version: journal.version, dialect: journal.dialect, entries }));
  return dir;
}

/** Start one disposable postgres:16-alpine container; returns { url, stop() }. */
async function startDisposablePostgres(namePrefix) {
  const container = `pm-${namePrefix}-${randomUUID().slice(0, 8)}`;
  const port = 5900 + Math.floor(Math.random() * 90); // 5900-5989 — clear of every other suite's range
  const user = "rbac_owner_invariant";
  const password = "rbac_owner_invariant_local_only";
  const db = "rbac_owner_invariant_check";
  const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${db}`;
  if (/supabase|neon|pooler/i.test(url) || !/@127\.0\.0\.1:/.test(url)) {
    throw new Error("REFUS : cible non locale.");
  }
  if (sh("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker indisponible — demarre Docker et relance.");
  }
  const runc = sh("docker", ["run", "-d", "--rm", "--name", container, "-e", `POSTGRES_USER=${user}`, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${db}`, "-p", `127.0.0.1:${port}:5432`, "postgres:16-alpine"]);
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

/** Replay the 0000..0034 boundary against `url`. */
async function applyThrough0034(url) {
  const dir = buildBoundaryFolder();
  try {
    const r = await runMigrate({ argv: ["--apply", "--db-url", url, "--migrations-folder", dir], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
    assert.equal(r.ok, true, `boundary apply through 0034 failed: ${JSON.stringify(r)}`);
    assert.equal(r.post.recordedCount, 35);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Apply the REAL db/migrations folder — with 0000..0034 already applied, only 0035 is pending. */
function applyNewMigration(url) {
  return runMigrate({ argv: ["--apply", "--db-url", url], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
}

// organizations_is_internal_unique allows at most ONE is_internal=true row
// ever — call this exactly once per disposable database, never per user.
async function seedInternalOrg(pool) {
  const orgId = randomUUID();
  await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);
  return orgId;
}

async function seedUser(pool, email) {
  const userId = randomUUID();
  await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [userId, `clerk_${userId}`, email]);
  return userId;
}

// ---------------------------------------------------------------
// A. Clean replay 0000 -> new migration (whole real db/migrations folder, from scratch).
test("A. clean replay 0000..0035 succeeds; OWNER normalized to fixed id; index present", async () => {
  const { url, pool, stop } = await startDisposablePostgres("owner-a");
  try {
    const r = await runMigrate({ argv: ["--apply", "--db-url", url], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.post.recordedCount, JOURNAL_MIGRATION_COUNT);
    assert.equal(r.post.latestTag, JOURNAL_TIP_TAG);
    const verifier = r.post.structural.find((s) => s.tag === NEW_TAG);
    assert.equal(verifier.ok, true, verifier.detail);

    const owner = (await pool.query("select id from staff_roles where name='OWNER'")).rows[0];
    assert.equal(owner.id, FIXED_OWNER_ID);
  } finally {
    await stop();
  }
});

// ---------------------------------------------------------------
// B. 0034 -> new migration, zero staff_members.
test("B. zero staff_members before 0035 -> migration succeeds; zero OWNER memberships remains legal", async () => {
  const { url, pool, stop } = await startDisposablePostgres("owner-b");
  try {
    await applyThrough0034(url);
    const r = await applyNewMigration(url);
    assert.equal(r.ok, true, JSON.stringify(r));
    const n = (await pool.query("select count(*)::int n from staff_members")).rows[0].n;
    assert.equal(n, 0);
    const verifier = r.post.structural.find((s) => s.tag === NEW_TAG);
    assert.equal(verifier.ok, true, "verifier must not require any OWNER membership to exist");
  } finally {
    await stop();
  }
});

// ---------------------------------------------------------------
// C. non-OWNER memberships preserved.
test("C. pre-existing non-OWNER memberships are preserved untouched", async () => {
  const { url, pool, stop } = await startDisposablePostgres("owner-c");
  try {
    await applyThrough0034(url);
    const orgId = await seedInternalOrg(pool);
    const userId = await seedUser(pool, "admin-fixture@example.com");
    const adminRoleId = (await pool.query("select id from staff_roles where name='ADMIN'")).rows[0].id;
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [userId, orgId, adminRoleId]);

    const r = await applyNewMigration(url);
    assert.equal(r.ok, true, JSON.stringify(r));
    const row = (await pool.query("select role_id, status from staff_members where user_id=$1", [userId])).rows[0];
    assert.equal(row.role_id, adminRoleId, "a non-OWNER row's role_id must never be touched");
    assert.equal(row.status, "ACTIVE");
  } finally {
    await stop();
  }
});

// ---------------------------------------------------------------
// D. exactly one existing OWNER membership correctly repointed.
// E. OWNER-referencing staff_invitation correctly repointed.
test("D+E. an existing OWNER staff_member AND an OWNER-referencing staff_invitation are both repointed to the fixed id", async () => {
  const { url, pool, stop } = await startDisposablePostgres("owner-de");
  try {
    await applyThrough0034(url);
    const orgId = await seedInternalOrg(pool);
    const userId = await seedUser(pool, "existing-owner@example.com");
    const oldOwnerRoleId = (await pool.query("select id from staff_roles where name='OWNER'")).rows[0].id;
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [userId, orgId, oldOwnerRoleId]);
    await pool.query("insert into staff_invitations (workspace_org_id, email, role_id, status) values ($1,$2,$3,'pending')", [orgId, "invited-owner@example.com", oldOwnerRoleId]);

    const r = await applyNewMigration(url);
    assert.equal(r.ok, true, JSON.stringify(r));

    const finalOwner = (await pool.query("select id from staff_roles where name='OWNER'")).rows[0];
    assert.equal(finalOwner.id, FIXED_OWNER_ID);
    const member = (await pool.query("select role_id, status from staff_members where user_id=$1", [userId])).rows[0];
    assert.equal(member.role_id, FIXED_OWNER_ID, "D: existing OWNER staff_member must be repointed");
    assert.equal(member.status, "ACTIVE", "repoint must not touch status");
    const invitation = (await pool.query("select role_id from staff_invitations where email='invited-owner@example.com'")).rows[0];
    assert.equal(invitation.role_id, FIXED_OWNER_ID, "E: OWNER-referencing staff_invitation must be repointed");
    // Old id must have zero remaining references anywhere.
    const staleMembers = (await pool.query("select count(*)::int n from staff_members where role_id=$1", [oldOwnerRoleId])).rows[0].n;
    const staleInvites = (await pool.query("select count(*)::int n from staff_invitations where role_id=$1", [oldOwnerRoleId])).rows[0].n;
    assert.equal(staleMembers, 0);
    assert.equal(staleInvites, 0);
  } finally {
    await stop();
  }
});

// ---------------------------------------------------------------
// F. multiple OWNER memberships SAME workspace: migration fails atomically.
// N. failed migration leaves old OWNER UUID and all original references intact.
test("F+N. pre-existing multi-OWNER in the SAME workspace makes the migration fail atomically, old state fully intact", async () => {
  const { url, pool, stop } = await startDisposablePostgres("owner-fn");
  try {
    await applyThrough0034(url);
    const orgId = await seedInternalOrg(pool);
    const userA = await seedUser(pool, "owner-a@example.com");
    const userB = await seedUser(pool, "owner-b@example.com");
    const oldOwnerRoleId = (await pool.query("select id from staff_roles where name='OWNER'")).rows[0].id;
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [userA, orgId, oldOwnerRoleId]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [userB, orgId, oldOwnerRoleId]);

    const r = await applyNewMigration(url);
    assert.equal(r.ok, false, "migration must fail, not silently succeed");
    assert.equal(r.mutated, false);
    assert.equal(r.migrationFailed, true);

    // Old OWNER role completely unchanged.
    const owner = (await pool.query("select id from staff_roles where name='OWNER'")).rows[0];
    assert.equal(owner.id, oldOwnerRoleId, "old OWNER id must remain intact after a failed migration");

    // Both original memberships untouched — no winner chosen, no demotion, no deletion.
    const members = (await pool.query("select user_id, role_id, status from staff_members where workspace_org_id=$1 order by user_id", [orgId])).rows;
    assert.equal(members.length, 2, "both original memberships must survive a failed migration");
    assert.ok(members.every((m) => m.role_id === oldOwnerRoleId && m.status === "ACTIVE"));

    // No partial artifacts: migration not recorded, no temp role, no index.
    const recorded = (await pool.query("select count(*)::int n from drizzle.__drizzle_migrations")).rows[0].n;
    assert.equal(recorded, 35, "0035 must not be recorded as applied");
    const tempRole = (await pool.query("select count(*)::int n from staff_roles where name like '%migrating%'")).rows[0].n;
    assert.equal(tempRole, 0, "no leftover temporary migrating role");
    const idx = (await pool.query("select count(*)::int n from pg_indexes where indexname='staff_members_one_owner_per_workspace'")).rows[0].n;
    assert.equal(idx, 0, "the partial unique index must not exist after a failed migration");
  } finally {
    await stop();
  }
});

// ---------------------------------------------------------------
// G. OWNER memberships in DIFFERENT workspaces: migration succeeds.
test("G. pre-existing OWNER memberships in DIFFERENT workspaces do not conflict; migration succeeds", async () => {
  const { url, pool, stop } = await startDisposablePostgres("owner-g");
  try {
    await applyThrough0034(url);
    const orgX = await seedInternalOrg(pool);
    const userX = await seedUser(pool, "owner-x@example.com");
    const orgY = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'unrelated org Y', false)", [orgY]);
    const userY = randomUUID();
    await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [userY, `clerk_${userY}`, "owner-y@example.com"]);
    const oldOwnerRoleId = (await pool.query("select id from staff_roles where name='OWNER'")).rows[0].id;
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [userX, orgX, oldOwnerRoleId]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [userY, orgY, oldOwnerRoleId]);

    const r = await applyNewMigration(url);
    assert.equal(r.ok, true, JSON.stringify(r));
    const rows = (await pool.query("select workspace_org_id, role_id from staff_members order by workspace_org_id")).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.role_id === FIXED_OWNER_ID));
  } finally {
    await stop();
  }
});

// ---------------------------------------------------------------
// H-M + O: post-migration constraint behavior, on a single already-fully-migrated DB.
test("H-M, O. post-migration constraint behavior + idempotent replay", async () => {
  const { url, pool, stop } = await startDisposablePostgres("owner-post");
  try {
    const first = await runMigrate({ argv: ["--apply", "--db-url", url], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
    assert.equal(first.ok, true, JSON.stringify(first));

    const orgOne = await seedInternalOrg(pool);
    const ownerCandidate = await seedUser(pool, "h.owner@example.com");
    const secondCandidate = await seedUser(pool, "i.second@example.com");
    const orgTwo = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'workspace two', false)", [orgTwo]);
    const userTwo = await seedUser(pool, "j.other-workspace@example.com");
    const adminRoleId = (await pool.query("select id from staff_roles where name='ADMIN'")).rows[0].id;
    const managerRoleId = (await pool.query("select id from staff_roles where name='MANAGER'")).rows[0].id;
    const employeeRoleId = (await pool.query("select id from staff_roles where name='EMPLOYEE'")).rows[0].id;

    // H. first OWNER insert succeeds.
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [ownerCandidate, orgOne, FIXED_OWNER_ID]);

    // I. second OWNER, same workspace -> unique violation.
    await assert.rejects(
      () => pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [secondCandidate, orgOne, FIXED_OWNER_ID]),
      /duplicate key value violates unique constraint "staff_members_one_owner_per_workspace"/,
    );

    // J. OWNER in a different workspace -> succeeds.
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [userTwo, orgTwo, FIXED_OWNER_ID]);

    // K. ADMIN/MANAGER/EMPLOYEE unaffected — any number, same workspace as an existing OWNER.
    const adminUser = await seedUser(pool, "k.admin@example.com");
    const managerUser = await seedUser(pool, "k.manager@example.com");
    const employeeUser = await seedUser(pool, "k.employee@example.com");
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [adminUser, orgOne, adminRoleId]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [managerUser, orgOne, managerRoleId]);
    await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,'ACTIVE')", [employeeUser, orgOne, employeeRoleId]);
    const nonOwnerCount = (await pool.query("select count(*)::int n from staff_members where workspace_org_id=$1 and role_id<>$2", [orgOne, FIXED_OWNER_ID])).rows[0].n;
    assert.equal(nonOwnerCount, 3, "ADMIN/MANAGER/EMPLOYEE inserts alongside an existing OWNER must all succeed");

    // L. UPDATE ADMIN -> OWNER in the already-owned workspace -> unique violation.
    await assert.rejects(
      () => pool.query("update staff_members set role_id=$1 where user_id=$2", [FIXED_OWNER_ID, adminUser]),
      /duplicate key value violates unique constraint "staff_members_one_owner_per_workspace"/,
    );

    // M. move the orgTwo OWNER into orgOne (already owned) -> unique violation.
    await assert.rejects(
      () => pool.query("update staff_members set workspace_org_id=$1 where user_id=$2", [orgOne, userTwo]),
      /duplicate key value violates unique constraint "staff_members_one_owner_per_workspace"/,
    );

    // O. idempotent replay: re-running --apply after success is a safe no-op per the existing runner contract.
    const second = await runMigrate({ argv: ["--apply", "--db-url", url], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
    assert.equal(second.ok, true, JSON.stringify(second));
    const recordedAfter = (await pool.query("select count(*)::int n from drizzle.__drizzle_migrations")).rows[0].n;
    assert.equal(recordedAfter, JOURNAL_MIGRATION_COUNT, "re-apply must not duplicate the migration record");
  } finally {
    await stop();
  }
});

// ---------------------------------------------------------------
// STRUCTURAL_VERIFIERS["0035_tough_phil_sheldon"] index-strength regression
// matrix (RBAC-OWNER-DB-INVARIANT-VERIFIER-FIX-1). Everything BUT the index
// under test is held fixed at its correct/expected state (OWNER role at the
// fixed id, both role_id FKs present, exact 4-role catalogue) so that the
// verifier's overall `ok` toggles exactly on whether it correctly judges the
// index. Uses the real exported verifier against a real Postgres catalog —
// never mocks pg_index/pg_indexes output.
const UNRELATED_UUID = "00000000-0000-0000-0000-000000000000";

async function seedVerifierFixtureSchema(pool) {
  await pool.query(`create table staff_roles (id uuid primary key default gen_random_uuid(), name text unique not null)`);
  await pool.query(
    `create table staff_members (id uuid primary key default gen_random_uuid(), workspace_org_id uuid not null, role_id uuid not null, other_uuid uuid)`,
  );
  await pool.query(`create table staff_invitations (id uuid primary key default gen_random_uuid(), role_id uuid not null)`);
  await pool.query(`alter table staff_members add constraint staff_members_role_id_fkey foreign key (role_id) references staff_roles(id)`);
  await pool.query(`alter table staff_invitations add constraint staff_invitations_role_id_fkey foreign key (role_id) references staff_roles(id)`);
  await pool.query(
    `insert into staff_roles (id, name) values ('${FIXED_OWNER_ID}','OWNER'),(gen_random_uuid(),'ADMIN'),(gen_random_uuid(),'MANAGER'),(gen_random_uuid(),'EMPLOYEE')`,
  );
}

async function withIndex(pool, ddl, fn) {
  await pool.query(ddl);
  try {
    return await fn();
  } finally {
    await pool.query(`drop index if exists staff_members_one_owner_per_workspace`);
  }
}

test("STRUCTURAL_VERIFIERS index-strength matrix: only a genuinely correct UNIQUE partial index passes", async () => {
  const { pool, stop } = await startDisposablePostgres("owner-verifier-matrix");
  try {
    await seedVerifierFixtureSchema(pool);
    const client = pool; // pg Pool exposes .query(); STRUCTURAL_VERIFIERS only needs .query()

    // V1 — correct UNIQUE index on workspace_org_id, predicate role_id = fixed. MUST PASS.
    await withIndex(
      pool,
      `create unique index staff_members_one_owner_per_workspace on staff_members (workspace_org_id) where role_id = '${FIXED_OWNER_ID}'::uuid`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, true, `V1 (control) must PASS: ${r.detail}`);
      },
    );

    // V2 — non-unique index, otherwise identical. MUST FAIL.
    await withIndex(
      pool,
      `create index staff_members_one_owner_per_workspace on staff_members (workspace_org_id) where role_id = '${FIXED_OWNER_ID}'::uuid`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, false, "V2 (non-unique index) must FAIL");
      },
    );

    // V3 — UNIQUE index, wrong operator (<>). MUST FAIL.
    await withIndex(
      pool,
      `create unique index staff_members_one_owner_per_workspace on staff_members (workspace_org_id) where role_id <> '${FIXED_OWNER_ID}'::uuid`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, false, "V3 (wrong operator <>) must FAIL");
      },
    );

    // V4 — UNIQUE index, predicate compares the fixed UUID against the wrong column. MUST FAIL.
    await withIndex(
      pool,
      `create unique index staff_members_one_owner_per_workspace on staff_members (workspace_org_id) where other_uuid = '${FIXED_OWNER_ID}'::uuid`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, false, "V4 (wrong predicate column) must FAIL");
      },
    );

    // V5 — UNIQUE index, correct column/operator, but a DIFFERENT UUID literal. MUST FAIL.
    await withIndex(
      pool,
      `create unique index staff_members_one_owner_per_workspace on staff_members (workspace_org_id) where role_id = '${UNRELATED_UUID}'::uuid`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, false, "V5 (different UUID literal) must FAIL");
      },
    );

    // V6 — UNIQUE index, correct predicate, but an EXTRA indexed key column. MUST FAIL.
    await withIndex(
      pool,
      `create unique index staff_members_one_owner_per_workspace on staff_members (workspace_org_id, other_uuid) where role_id = '${FIXED_OWNER_ID}'::uuid`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, false, "V6 (extra indexed key) must FAIL");
      },
    );

    // V7 — UNIQUE index, correct predicate widened with an OR clause. MUST FAIL.
    await withIndex(
      pool,
      `create unique index staff_members_one_owner_per_workspace on staff_members (workspace_org_id) where role_id = '${FIXED_OWNER_ID}'::uuid or other_uuid is null`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, false, "V7 (predicate widened with OR) must FAIL");
      },
    );

    // V8 — UNIQUE index, correct predicate narrowed with an AND clause. MUST FAIL.
    await withIndex(
      pool,
      `create unique index staff_members_one_owner_per_workspace on staff_members (workspace_org_id) where role_id = '${FIXED_OWNER_ID}'::uuid and other_uuid is not null`,
      async () => {
        const r = await STRUCTURAL_VERIFIERS[NEW_TAG](client);
        assert.equal(r.ok, false, "V8 (predicate narrowed with AND) must FAIL");
      },
    );
  } finally {
    await stop();
  }
});
