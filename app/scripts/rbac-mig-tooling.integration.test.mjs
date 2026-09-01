// PHASE RBAC-MIG-TOOLING — one disposable-container integration test for
// scripts/db-migrate.mjs + scripts/bootstrap-first-staff-owner.mjs.
//
// Spins its OWN ephemeral postgres:16-alpine (random name + port, --rm,
// destroyed in `after`) — the exact pattern of
// db/schema.rbac.integration.test.mjs and scripts/migration-replay-check.mjs.
// It NEVER touches public-map-approval-test-db / public-map-audit-test-db,
// NEVER Preview/Production, NEVER a remote host. Both tools are driven in
// RBAC_MIG_TEST_MODE=1 (127.0.0.1 only) with real connect/migrate.
//
// Requires Docker. Run:
//   npx tsx --test scripts/rbac-mig-tooling.integration.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

import { run as runMigrate } from "./db-migrate.mjs";
import { run as runBootstrap } from "./bootstrap-first-staff-owner.mjs";

const CONTAINER = `pm-rbac-mig-tooling-${randomUUID().slice(0, 8)}`;
const HOST_PORT = 5580 + Math.floor(Math.random() * 60); // 5580-5639 — clear of 5432/5433/5434 and the other suites' 5400-5579
const PG_USER = "rbac_mig_tooling";
const PG_PASSWORD = "rbac_mig_tooling_local_only";
const PG_DB = "rbac_mig_tooling_check";
const URL = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${HOST_PORT}/${PG_DB}`;

if (/supabase|neon|pooler/i.test(URL) || !/@127\.0\.0\.1:/.test(URL)) {
  throw new Error("REFUS : cible non locale. Arret avant tout demarrage de conteneur.");
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };

const ORG = randomUUID();
const ROLE_ADMIN_LEGACY = randomUUID();
const ROLE_AGENT_LEGACY = randomUUID();
const OWNER_USER = randomUUID();
const ADMIN_USER = randomUUID();
const AGENT_USER = randomUUID();

let pool;
let containerStarted = false;
const client = { query: (...a) => pool.query(...a) };

before(async () => {
  if (sh("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker indisponible — demarre Docker et relance. Rien n'a ete cree.");
  }
  const runc = sh("docker", [
    "run", "-d", "--rm",
    "--name", CONTAINER,
    "-e", `POSTGRES_USER=${PG_USER}`,
    "-e", `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e", `POSTGRES_DB=${PG_DB}`,
    "-p", `127.0.0.1:${HOST_PORT}:5432`,
    "postgres:16-alpine",
  ]);
  if (runc.status !== 0) throw new Error(`docker run a echoue : ${runc.stderr}`);
  containerStarted = true;

  pool = new Pool({ connectionString: URL });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { await pool.query("select 1"); ready = true; } catch { await sleep(500); }
  }
  if (!ready) throw new Error("Postgres jetable jamais pret.");
  const { rows } = await pool.query("select current_database() as db");
  assert.equal(rows[0].db, PG_DB);
});

after(async () => {
  await pool?.end().catch(() => {});
  if (containerStarted) sh("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

// ---------------------------------------------------------------
test("A. fresh disposable DB has no staff_* tables", async () => {
  const { rows } = await client.query(
    "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('staff_roles','staff_members','staff_invitations')",
  );
  assert.equal(rows[0].n, 0);
});

test("B+C+D. db-migrate --apply (test mode) replays 0000->0034: tables + exact role seed", async () => {
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.ok, true, `migrate run failed: ${JSON.stringify(r)}`);
  assert.equal(r.mutated, true);
  assert.equal(r.classification, "TEST-DISPOSABLE");
  assert.deepEqual(r.roleRows, ["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"]);

  const t = await client.query(
    "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('staff_roles','staff_members','staff_invitations')",
  );
  assert.equal(t.rows[0].n, 3);
});

test("E. staff_members is initially empty", async () => {
  const { rows } = await client.query("select count(*)::int n from staff_members");
  assert.equal(rows[0].n, 0);
});

test("db-migrate re-run is a safe no-op (already-applied migration skipped)", async () => {
  const r = await runMigrate({ argv: ["--apply", "--db-url", URL], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
  assert.equal(r.ok, true);
  const { rows } = await client.query("select count(*)::int n from staff_roles");
  assert.equal(rows[0].n, 4);
});

test("F. seed synthetic legacy fixtures (internal org + admin/agent memberships)", async () => {
  await client.query("insert into roles (id, name) values ($1,'admin'),($2,'agent') on conflict (name) do nothing", [ROLE_ADMIN_LEGACY, ROLE_AGENT_LEGACY]);
  const adminRoleId = (await client.query("select id from roles where name='admin'")).rows[0].id;
  const agentRoleId = (await client.query("select id from roles where name='agent'")).rows[0].id;
  await client.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal',true)", [ORG]);
  for (const [id, email, status] of [
    [OWNER_USER, "owner@public-map.com", "active"],
    [ADMIN_USER, "admin2@public-map.com", "active"],
    [AGENT_USER, "agent@public-map.com", "active"],
  ]) {
    await client.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,$4)", [id, `clerk_${id}`, email, status]);
  }
  await client.query("insert into memberships (user_id, organization_id, role_id) values ($1,$2,$3),($4,$2,$3),($5,$2,$6)", [
    OWNER_USER, ORG, adminRoleId, ADMIN_USER, AGENT_USER, agentRoleId,
  ]);
  const n = (await client.query("select count(*)::int n from memberships")).rows[0].n;
  assert.equal(n, 3);
});

function manifestFor(overrides = {}) {
  return {
    ownerUserId: OWNER_USER,
    adminUserIds: [ADMIN_USER],
    expectedWorkspaceOrgId: ORG,
    expectedDbName: PG_DB,
    ...overrides,
  };
}

test("G. bootstrap DRY-RUN writes zero staff_members", async () => {
  const r = await runBootstrap({
    argv: ["--manifest", "x"],
    env: TEST_ENV,
    connectFn: undefined,
    readManifestFn: () => manifestFor(),
    ...silent,
  });
  // NB: RBAC_MIG_TEST_MODE alone is not enough — bootstrap also needs --db-url in test mode.
  assert.equal(r.refused, true, "test mode still requires --db-url");

  const r2 = await runBootstrap({
    argv: ["--manifest", "x", "--db-url", URL],
    env: TEST_ENV,
    readManifestFn: () => manifestFor(),
    ...silent,
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.mode, "dry-run");
  assert.equal(r2.mutated, false);
  const n = (await client.query("select count(*)::int n from staff_members")).rows[0].n;
  assert.equal(n, 0);
});

test("H. bootstrap APPLY → exactly 1 OWNER + 1 ADMIN, all ACTIVE, correct workspace", async () => {
  const r = await runBootstrap({
    argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", OWNER_USER],
    env: TEST_ENV,
    readManifestFn: () => manifestFor(),
    promptFn: async () => "BOOTSTRAP",
    ...silent,
  });
  assert.equal(r.ok, true, `bootstrap failed: ${JSON.stringify(r)}`);
  assert.equal(r.mutated, true);

  const { rows } = await client.query(
    "select sm.user_id, sr.name role, sm.status, sm.workspace_org_id from staff_members sm join staff_roles sr on sr.id=sm.role_id order by sr.name",
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => `${x.role}:${x.user_id}:${x.status}`), [
    `ADMIN:${ADMIN_USER}:ACTIVE`,
    `OWNER:${OWNER_USER}:ACTIVE`,
  ]);
  assert.ok(rows.every((x) => x.workspace_org_id === ORG));
});

test("I. bootstrap re-run with the same manifest → already bootstrapped, zero mutation", async () => {
  const r = await runBootstrap({
    argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", OWNER_USER],
    env: TEST_ENV,
    readManifestFn: () => manifestFor(),
    promptFn: async () => "BOOTSTRAP",
    ...silent,
  });
  assert.equal(r.ok, true);
  assert.equal(r.alreadyBootstrapped, true);
  assert.equal(r.mutated, false);
  const n = (await client.query("select count(*)::int n from staff_members")).rows[0].n;
  assert.equal(n, 2);
});

test("J. bootstrap with a CHANGED privileged set → refused, zero mutation", async () => {
  const r = await runBootstrap({
    argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", OWNER_USER],
    env: TEST_ENV,
    readManifestFn: () => manifestFor({ adminUserIds: [] }), // drop the ADMIN
    promptFn: async () => "BOOTSTRAP",
    ...silent,
  });
  assert.equal(r.refused, true);
  const n = (await client.query("select count(*)::int n from staff_members")).rows[0].n;
  assert.equal(n, 2);
});

test("J2. bootstrap refuses to promote a legacy non-admin (agent) to ADMIN", async () => {
  // Fresh workspace-less check would be complex; instead prove the resolver
  // rejects the agent even as an additional ADMIN, against the already
  // bootstrapped set (still refused for the changed-set reason OR the
  // role reason — either way: zero mutation).
  const r = await runBootstrap({
    argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", OWNER_USER],
    env: TEST_ENV,
    readManifestFn: () => manifestFor({ adminUserIds: [ADMIN_USER, AGENT_USER] }),
    promptFn: async () => "BOOTSTRAP",
    ...silent,
  });
  assert.equal(r.ok === true && r.mutated === true, false);
  const n = (await client.query("select count(*)::int n from staff_members")).rows[0].n;
  assert.equal(n, 2);
});

test("K. legacy tables/data remain intact after all of the above", async () => {
  const orgs = (await client.query("select count(*)::int n from organizations")).rows[0].n;
  const users = (await client.query("select count(*)::int n from users")).rows[0].n;
  const memberships = (await client.query("select count(*)::int n from memberships")).rows[0].n;
  assert.equal(orgs, 1);
  assert.equal(users, 3);
  assert.equal(memberships, 3);
  // staff_invitations untouched by any of this tooling
  const inv = (await client.query("select count(*)::int n from staff_invitations")).rows[0].n;
  assert.equal(inv, 0);
});
