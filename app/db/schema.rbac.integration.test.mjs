// PHASE 2B.1-B — structure-only integration test for the additive, INERT
// internal-workforce RBAC foundation (migration 0034): staff_roles /
// staff_members / staff_invitations.
//
// Proves against a REAL Postgres that a FRESH replay of every migration
// (0000 -> 0034) creates exactly the expected tables / constraints /
// indexes / FKs, seeds exactly the four staff roles (never CLIENT), leaves
// staff_members empty, and adds nothing to the legacy identity tables
// (users / memberships / roles / organizations / invitations).
//
// Uses its OWN disposable, ephemeral postgres:16-alpine container (random
// name + port, --rm, destroyed in `after`) — exactly like
// scripts/migration-replay-check.mjs. It never touches the shared
// public-map-approval-test-db, never Preview/Production, never a remote
// host. Applies migrations via drizzle migrate() so the hand-appended
// staff_roles seed INSERT in 0034 actually runs (drizzle-kit push would
// not run it). Inserts ZERO business data.
//
// Requires a working local Docker. Run:
//   npx tsx --test db/schema.rbac.integration.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const CONTAINER = `pm-rbac-schema-${randomUUID().slice(0, 8)}`;
const HOST_PORT = 5490 + Math.floor(Math.random() * 90); // 5490-5579, clear of 5432/5433/5434 and replay-check's 5400-5489
const PG_USER = "rbac_replay";
const PG_PASSWORD = "rbac_replay_local_only";
const PG_DB = "rbac_replay_check";
const URL = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${HOST_PORT}/${PG_DB}`;

if (/supabase|neon|pooler/i.test(URL) || !/@127\.0\.0\.1:/.test(URL)) {
  throw new Error("REFUS : cible non locale. Arret avant tout demarrage de conteneur.");
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

let pool;
let containerStarted = false;

before(async () => {
  if (sh("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker indisponible — demarre Docker et relance. Rien n'a ete cree.");
  }
  const run = sh("docker", [
    "run", "-d", "--rm",
    "--name", CONTAINER,
    "-e", `POSTGRES_USER=${PG_USER}`,
    "-e", `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e", `POSTGRES_DB=${PG_DB}`,
    "-p", `127.0.0.1:${HOST_PORT}:5432`,
    "postgres:16-alpine",
  ]);
  if (run.status !== 0) throw new Error(`docker run a echoue : ${run.stderr}`);
  containerStarted = true;

  pool = new Pool({ connectionString: URL });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try {
      await pool.query("select 1");
      ready = true;
    } catch {
      await sleep(500);
    }
  }
  if (!ready) throw new Error("Postgres jetable jamais pret.");

  const { rows } = await pool.query("select current_database() as db");
  assert.equal(rows[0].db, PG_DB, `base inattendue "${rows[0].db}"`);

  await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
});

after(async () => {
  await pool?.end().catch(() => {});
  if (containerStarted) sh("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

// ---- helpers ---------------------------------------------------------
const tableExists = async (name) =>
  (
    await pool.query(
      "select 1 from information_schema.tables where table_schema='public' and table_name=$1",
      [name],
    )
  ).rowCount === 1;

const columnNames = async (name) =>
  (
    await pool.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
      [name],
    )
  ).rows.map((r) => r.column_name);

const columnMap = async (name) =>
  Object.fromEntries(
    (
      await pool.query(
        "select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1",
        [name],
      )
    ).rows.map((r) => [r.column_name, r]),
  );

const checkClause = async (name) =>
  (
    await pool.query(
      `select cc.check_clause
         from information_schema.check_constraints cc
         join information_schema.table_constraints tc using (constraint_schema, constraint_name)
        where tc.table_schema='public' and tc.constraint_name=$1`,
      [name],
    )
  ).rows[0]?.check_clause ?? null;

const indexDef = async (name) =>
  (await pool.query("select indexdef from pg_indexes where schemaname='public' and indexname=$1", [name])).rows[0]
    ?.indexdef ?? null;

// pg confdeltype: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
const DEL = { NO_ACTION: "a", RESTRICT: "r", CASCADE: "c", SET_NULL: "n" };
const foreignKeys = async (table) =>
  Object.fromEntries(
    (
      await pool.query(
        `select
           (select string_agg(a.attname, ',' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) as from_cols,
           tgt.relname as to_table,
           c.confdeltype as on_delete
         from pg_constraint c
         join pg_class src on src.oid=c.conrelid
         join pg_class tgt on tgt.oid=c.confrelid
         join pg_namespace n on n.oid=src.relnamespace and n.nspname='public'
        where c.contype='f' and src.relname=$1`,
        [table],
      )
    ).rows.map((r) => [r.from_cols, r]),
  );

// ===================================================================
test("the three RBAC tables exist", async () => {
  assert.equal(await tableExists("staff_roles"), true);
  assert.equal(await tableExists("staff_members"), true);
  assert.equal(await tableExists("staff_invitations"), true);
});

test("staff_roles: columns id/name/created_at + UNIQUE(name) constraint", async () => {
  assert.deepEqual(await columnNames("staff_roles"), ["id", "name", "created_at"]);
  const { rows } = await pool.query(
    "select 1 from information_schema.table_constraints where table_schema='public' and table_name='staff_roles' and constraint_type='UNIQUE' and constraint_name='staff_roles_name_unique'",
  );
  assert.equal(rows.length, 1, "staff_roles_name_unique present");
});

test("staff_roles seeded with EXACTLY OWNER/ADMIN/MANAGER/EMPLOYEE — never CLIENT", async () => {
  const { rows } = await pool.query("select name from staff_roles");
  assert.deepEqual(
    rows.map((r) => r.name).sort(),
    ["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"],
  );
  assert.ok(!rows.some((r) => /client/i.test(r.name)));
});

test("staff_roles seed is idempotent — re-running migrate() keeps it at four rows", async () => {
  await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  assert.equal((await pool.query("select count(*)::int n from staff_roles")).rows[0].n, 4);
});

test("staff_members: expected columns, nullability, ACTIVE default", async () => {
  const cols = await columnMap("staff_members");
  assert.deepEqual(Object.keys(cols).sort(), [
    "created_at",
    "id",
    "invited_by_user_id",
    "role_id",
    "status",
    "updated_at",
    "user_id",
    "workspace_org_id",
  ]);
  assert.equal(cols.user_id.is_nullable, "NO");
  assert.equal(cols.workspace_org_id.is_nullable, "NO");
  assert.equal(cols.role_id.is_nullable, "NO");
  assert.equal(cols.status.is_nullable, "NO");
  assert.match(cols.status.column_default ?? "", /'ACTIVE'/);
  assert.equal(cols.invited_by_user_id.is_nullable, "YES");
  assert.equal(cols.updated_at.is_nullable, "NO");
});

test("staff_members status CHECK = ACTIVE/SUSPENDED/OFFBOARDING", async () => {
  const clause = await checkClause("staff_members_status_check");
  assert.ok(clause, "check present");
  for (const v of ["ACTIVE", "SUSPENDED", "OFFBOARDING"]) assert.match(clause, new RegExp(`'${v}'`));
});

test("staff_members: UNIQUE(user_id, workspace_org_id) + (workspace_org_id, role_id, status) index", async () => {
  const uniq = await indexDef("staff_members_user_workspace_unique");
  assert.ok(uniq && /unique/i.test(uniq) && /\(user_id, workspace_org_id\)/.test(uniq), uniq ?? "missing");
  const idx = await indexDef("staff_members_workspace_role_status_idx");
  assert.ok(idx && /\(workspace_org_id, role_id, status\)/.test(idx), idx ?? "missing");
});

test("staff_members FKs: user->users CASCADE, workspace->organizations CASCADE, role->staff_roles RESTRICT, invited_by->users SET NULL", async () => {
  const fks = await foreignKeys("staff_members");
  assert.equal(fks.user_id.to_table, "users");
  assert.equal(fks.user_id.on_delete, DEL.CASCADE);
  assert.equal(fks.workspace_org_id.to_table, "organizations");
  assert.equal(fks.workspace_org_id.on_delete, DEL.CASCADE);
  assert.equal(fks.role_id.to_table, "staff_roles");
  assert.equal(fks.role_id.on_delete, DEL.RESTRICT);
  assert.equal(fks.invited_by_user_id.to_table, "users");
  assert.equal(fks.invited_by_user_id.on_delete, DEL.SET_NULL);
});

test("staff_members is EMPTY — no first OWNER, no backfill", async () => {
  assert.equal((await pool.query("select count(*)::int n from staff_members")).rows[0].n, 0);
});

test("staff_invitations: expected columns", async () => {
  assert.deepEqual(await columnNames("staff_invitations"), [
    "id",
    "workspace_org_id",
    "email",
    "role_id",
    "invited_by_user_id",
    "status",
    "created_at",
    "claimed_at",
    "revoked_at",
  ]);
});

test("staff_invitations status CHECK = pending/claimed/revoked", async () => {
  const clause = await checkClause("staff_invitations_status_check");
  assert.ok(clause);
  for (const v of ["pending", "claimed", "revoked"]) assert.match(clause, new RegExp(`'${v}'`));
});

test("staff_invitations: email index + (workspace_org_id, status) index", async () => {
  assert.ok(await indexDef("staff_invitations_email_idx"));
  const ws = await indexDef("staff_invitations_workspace_status_idx");
  assert.ok(ws && /\(workspace_org_id, status\)/.test(ws), ws ?? "missing");
});

test("staff_invitations FKs: workspace->organizations CASCADE, role->staff_roles RESTRICT, invited_by->users SET NULL", async () => {
  const fks = await foreignKeys("staff_invitations");
  assert.equal(fks.workspace_org_id.to_table, "organizations");
  assert.equal(fks.workspace_org_id.on_delete, DEL.CASCADE);
  assert.equal(fks.role_id.to_table, "staff_roles");
  assert.equal(fks.role_id.on_delete, DEL.RESTRICT);
  assert.equal(fks.invited_by_user_id.to_table, "users");
  assert.equal(fks.invited_by_user_id.on_delete, DEL.SET_NULL);
});

// ---- legacy identity tables untouched by 0034 --------------------
test("legacy identity tables keep their exact column sets (0034 added nothing)", async () => {
  assert.deepEqual(await columnNames("roles"), ["id", "name"]);
  assert.deepEqual(await columnNames("memberships"), ["user_id", "organization_id", "role_id", "created_at"]);
  for (const legacy of ["roles", "memberships", "users", "organizations", "invitations"]) {
    assert.ok(!(await columnNames(legacy)).some((n) => /staff/i.test(n)), `${legacy} gained no staff_* column`);
  }
});

test("legacy `roles` table has no workforce role names injected by 0034", async () => {
  const { rows } = await pool.query("select name from roles");
  assert.ok(!rows.some((r) => ["OWNER", "MANAGER", "EMPLOYEE"].includes(r.name)));
});
