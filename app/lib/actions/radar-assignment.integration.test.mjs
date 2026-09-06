// lib/actions/radar-assignment.integration.test.mjs — PHASE RADAR-CORE-1A
// disposable-Postgres proof that claimProspect / assignProspect /
// unassignProspect behave correctly against a REAL database, including the
// generated migration 0036 (crm_clients.assigned_user_id + FK + index),
// real staff_members / staff_roles, real requireStaffMember() Axis-C gates,
// real transactional row-lock serialisation, and real audit rows.
//
// One disposable `postgres:16-alpine` container per run (127.0.0.1-guarded,
// NEVER Supabase/Neon/pooler/Production). Migrations applied via
// scripts/db-migrate.mjs. @/db is NOT mocked (DATABASE_URL is set before
// the first import that touches it). @/lib/session, @/lib/notifications and
// next/cache are mocked at the boundary; requireStaffMember() runs for
// real. Single test() body — @/db caches its Pool on globalThis.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-assignment.integration.test.mjs
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
  const user = "radar_assign";
  const password = "radar_assign_local_only";
  const db = "radar_assign_check";
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

test("RADAR-CORE-1A integration: prospect assignment against real Postgres + migration 0036", async () => {
  const { url, pool, stop } = await startDisposablePostgres("radar-assign");
  try {
    const dbMigrate = await import(new URL("../../scripts/db-migrate.mjs", import.meta.url).pathname);
    const applied = await dbMigrate.run({
      argv: ["--apply", "--db-url", url],
      env: TEST_ENV,
      promptFn: async () => "MIGRATE",
      ...silent,
    });
    assert.equal(applied.ok, true, `migration apply failed: ${JSON.stringify(applied)}`);

    // --- migration 0036 shape ---
    const cols = (await pool.query(
      "select column_name, is_nullable, data_type from information_schema.columns where table_name='crm_clients' and column_name='assigned_user_id'",
    )).rows;
    assert.equal(cols.length, 1, "crm_clients.assigned_user_id exists");
    assert.equal(cols[0].is_nullable, "YES", "assigned_user_id is nullable");
    assert.equal(cols[0].data_type, "uuid");
    const fk = (await pool.query(
      `select rc.delete_rule
         from information_schema.referential_constraints rc
         join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
        where tc.table_name='crm_clients' and tc.constraint_name='crm_clients_assigned_user_id_users_id_fk'`,
    )).rows;
    assert.equal(fk.length, 1, "FK crm_clients_assigned_user_id_users_id_fk exists");
    assert.equal(fk[0].delete_rule, "SET NULL", "ON DELETE SET NULL");
    const idx = (await pool.query("select indexname from pg_indexes where tablename='crm_clients' and indexname='crm_clients_assigned_user_id_idx'")).rows;
    assert.equal(idx.length, 1, "index crm_clients_assigned_user_id_idx exists");

    // --- seed ---
    const orgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal', true)", [orgId]);
    const someClientOrgId = randomUUID();
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'A client company', false)", [someClientOrgId]);

    const roleRows = (await pool.query("select id, name from staff_roles")).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    for (const n of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"]) assert.ok(roleId[n], `staff_roles seeded ${n}`);

    async function seedUser(email) {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [id, `clerk_${id}`, email]);
      return id;
    }
    async function seedStaff(email, roleName, status = "ACTIVE") {
      const uid = await seedUser(email);
      await pool.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1,$2,$3,$4)", [uid, orgId, roleId[roleName], status]);
      return uid;
    }

    const adminUserId = await seedStaff("radar-admin@example.com", "ADMIN");
    const managerUserId = await seedStaff("radar-manager@example.com", "MANAGER");
    const empAUserId = await seedStaff("radar-emp-a@example.com", "EMPLOYEE");
    const empBUserId = await seedStaff("radar-emp-b@example.com", "EMPLOYEE");
    const ownerUserId = await seedStaff("radar-owner@example.com", "OWNER");
    const suspEmpUserId = await seedStaff("radar-emp-susp@example.com", "EMPLOYEE", "SUSPENDED");
    const offEmpUserId = await seedStaff("radar-emp-off@example.com", "EMPLOYEE", "OFFBOARDING");
    const nonStaffUserId = await seedUser("radar-nonstaff@example.com"); // a users row, NO staff_members row

    async function seedClient(name, assignedUserId = null, organizationId = null) {
      const id = randomUUID();
      await pool.query("insert into crm_clients (id, name, stage, assigned_user_id, organization_id) values ($1,$2,'lead',$3,$4)", [
        id, name, assignedUserId, organizationId,
      ]);
      return id;
    }
    const unassignedClientId = await seedClient("Unassigned Co");
    const raceClientId = await seedClient("Race Co");
    const orgScopedClientId = await seedClient("Org-scoped Co", null, someClientOrgId);

    process.env.DATABASE_URL = url;

    /** @type {{ kind: "unauthenticated" } | { kind: "session"; userId: string }} */
    let sessionMockState = { kind: "unauthenticated" };
    mock.module("server-only", { defaultExport: {} });
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

    const { claimProspect, assignProspect, unassignProspect } = await import(
      new URL("./radar-assignment.ts", import.meta.url).pathname
    );

    const asUser = (userId) => { sessionMockState = { kind: "session", userId }; };
    const assignedOf = async (clientId) => (await pool.query("select assigned_user_id from crm_clients where id=$1", [clientId])).rows[0]?.assigned_user_id ?? null;
    const auditRows = async (clientId) =>
      (await pool.query(
        "select action, actor_user_id, organization_id, metadata from audit_log where target_type='crm_client' and target_id=$1 and action in ('crm.client_assigned','crm.client_reassigned','crm.client_unassigned') order by created_at",
        [clientId],
      )).rows;
    const assignAuditCount = async (clientId) => (await auditRows(clientId)).length;

    // 1. EMPLOYEE A claims an unassigned prospect.
    asUser(empAUserId);
    revalidateCalls = [];
    const claim1 = await claimProspect(unassignedClientId);
    assert.equal(claim1, undefined, `expected success, got ${JSON.stringify(claim1)}`);
    assert.equal(await assignedOf(unassignedClientId), empAUserId);
    assert.deepEqual(revalidateCalls, ["/admin/crm/radar"]);
    const a1 = await auditRows(unassignedClientId);
    assert.equal(a1.length, 1);
    assert.equal(a1[0].action, "crm.client_assigned");
    assert.equal(a1[0].actor_user_id, empAUserId);
    assert.equal(a1[0].organization_id, null, "staff-global CRM audit — no organization_id");
    assert.deepEqual(a1[0].metadata, { clientId: unassignedClientId, previousAssigneeUserId: null, newAssigneeUserId: empAUserId });

    // 2. ADMIN reassigns A -> B.
    asUser(adminUserId);
    assert.equal(await assignProspect(unassignedClientId, empBUserId), undefined);
    assert.equal(await assignedOf(unassignedClientId), empBUserId);
    const a2 = await auditRows(unassignedClientId);
    assert.equal(a2.length, 2);
    assert.equal(a2[1].action, "crm.client_reassigned");
    assert.deepEqual(a2[1].metadata, { clientId: unassignedClientId, previousAssigneeUserId: empAUserId, newAssigneeUserId: empBUserId });

    // 3. ADMIN unassigns B -> null.
    assert.equal(await unassignProspect(unassignedClientId), undefined);
    assert.equal(await assignedOf(unassignedClientId), null);
    const a3 = await auditRows(unassignedClientId);
    assert.equal(a3.length, 3);
    assert.equal(a3[2].action, "crm.client_unassigned");
    assert.deepEqual(a3[2].metadata, { clientId: unassignedClientId, previousAssigneeUserId: empBUserId, newAssigneeUserId: null });

    // 4. Concurrent claims on the same unassigned prospect (same eligible
    //    caller — a single module-level session mock cannot represent two
    //    distinct concurrent sessions; the ROW LOCK invariant is
    //    session-agnostic). Exactly one winner. Order-independent.
    asUser(empAUserId);
    const race = await Promise.allSettled([claimProspect(raceClientId), claimProspect(raceClientId)]);
    const fulfilled = race.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 2, "both calls resolve (neither throws)");
    assert.equal(fulfilled.filter((r) => r.value === undefined).length, 1, "exactly one claim succeeds");
    assert.equal(fulfilled.filter((r) => r.value && r.value.error === "ALREADY_ASSIGNED").length, 1, "exactly one ALREADY_ASSIGNED");
    assert.equal(await assignedOf(raceClientId), empAUserId, "final assignee is the winner");
    assert.equal(await assignAuditCount(raceClientId), 1, "exactly one assignment audit under concurrency");
    // a DISTINCT eligible caller still cannot claim a taken prospect
    asUser(empBUserId);
    assert.deepEqual(await claimProspect(raceClientId), { error: "ALREADY_ASSIGNED" });
    assert.equal(await assignAuditCount(raceClientId), 1, "the rejected claim wrote nothing");

    // 5. Ineligible assignees (SUSPENDED / OFFBOARDING / OWNER / non-staff).
    asUser(adminUserId);
    for (const target of [suspEmpUserId, offEmpUserId, ownerUserId, nonStaffUserId, randomUUID()]) {
      revalidateCalls = [];
      assert.deepEqual(await assignProspect(unassignedClientId, target), { error: "ASSIGNEE_NOT_ELIGIBLE" });
      assert.equal(await assignedOf(unassignedClientId), null, "no write for an ineligible target");
      assert.deepEqual(revalidateCalls, []);
    }
    assert.equal(await assignAuditCount(unassignedClientId), 3, "no new audit for any ineligible target");

    // 6. EMPLOYEE forged assignProspect(other) -> denied by the RADAR_ASSIGN gate.
    asUser(empAUserId);
    await assert.rejects(() => assignProspect(unassignedClientId, empBUserId), (e) => e?.digest?.startsWith?.("NEXT_REDIRECT"));
    assert.equal(await assignedOf(unassignedClientId), null);

    // 7. MANAGER assignProspect -> allowed (RADAR_ASSIGN granted to MANAGER).
    asUser(managerUserId);
    assert.equal(await assignProspect(unassignedClientId, empBUserId), undefined);
    assert.equal(await assignedOf(unassignedClientId), empBUserId);

    // 8. EMPLOYEE B unassigns their OWN prospect -> allowed (RADAR_WORK).
    asUser(empBUserId);
    assert.equal(await unassignProspect(unassignedClientId), undefined);
    assert.equal(await assignedOf(unassignedClientId), null);

    // 9. EMPLOYEE A unassigns SOMEONE ELSE'S prospect -> NOT_ALLOWED_TO_ASSIGN.
    asUser(managerUserId);
    await assignProspect(unassignedClientId, empBUserId); // assign to B again
    asUser(empAUserId);
    assert.deepEqual(await unassignProspect(unassignedClientId), { error: "NOT_ALLOWED_TO_ASSIGN" });
    assert.equal(await assignedOf(unassignedClientId), empBUserId, "a denied foreign unassign changed nothing");

    // 10. MANAGER unassigns SOMEONE ELSE'S prospect -> allowed (RADAR_ASSIGN).
    asUser(managerUserId);
    assert.equal(await unassignProspect(unassignedClientId), undefined);
    assert.equal(await assignedOf(unassignedClientId), null);

    // 11. crm_clients.organization_id is IRRELEVANT to assignment authorization.
    asUser(adminUserId);
    assert.equal(await assignProspect(orgScopedClientId, empAUserId), undefined);
    assert.equal(await assignedOf(orgScopedClientId), empAUserId);
    const [row] = (await pool.query("select organization_id from crm_clients where id=$1", [orgScopedClientId])).rows;
    assert.equal(row.organization_id, someClientOrgId, "the client's own organization is untouched and was never an auth scope");

    // 12. PROSPECT_NOT_FOUND for an unknown client id.
    assert.deepEqual(await claimProspect(randomUUID()), { error: "PROSPECT_NOT_FOUND" });

    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
