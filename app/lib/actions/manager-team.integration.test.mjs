// lib/actions/manager-team.integration.test.mjs — WORKFORCE MANAGER "MON
// ÉQUIPE" — disposable-Postgres proof that listManagerTeamMembers() is
// callable ONLY by a real ACTIVE MANAGER (re-derived fresh from
// staff_members, never trusted from the session object), returns exactly
// ACTIVE EMPLOYEE of the caller's own internal workspace, excludes
// OWNER/ADMIN/MANAGER/SUSPENDED/OFFBOARDING/other-workspace members, is
// completely independent of every radar_access value involved, and leaks
// no unnecessary field.
//
// Mirrors the exact disposable-container pattern already established by
// lib/actions/radar-assignment.integration.test.mjs — one disposable
// Postgres + one seed for the whole file. @/lib/session's requireSession()
// is mocked (the same boundary every Axis-C integration test in this
// codebase mocks — a real Clerk auth() call can't run outside a Next.js
// request); @/lib/notifications is mocked with a REAL passthrough query
// against this same disposable pool, not a canned fake. @/db is
// deliberately NOT mocked, so the real query — including its join and
// positive `role = 'EMPLOYEE'` filter — runs against real Postgres.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/manager-team.integration.test.mjs
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
  const user = "manager_team";
  const password = "manager_team_local_only";
  const db = "manager_team_check";
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

test("WORKFORCE MANAGER TEAM integration: listManagerTeamMembers() against real Postgres", async () => {
  const { url, pool, stop } = await startDisposablePostgres("manager-team");
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
    await pool.query("insert into organizations (id, name, is_internal) values ($1,'Other workspace', false)", [otherOrgId]);

    async function seedUser(email, fullName = null) {
      const id = randomUUID();
      await pool.query("insert into users (id, clerk_user_id, email, full_name, status) values ($1,$2,$3,$4,'active')", [
        id,
        `clerk_${id}`,
        email,
        fullName,
      ]);
      return id;
    }

    const roleRows = (await pool.query("select id, name from staff_roles order by name")).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));

    async function seedStaff(userId, role, status, workspaceOrgId = orgId, radarAccess = true) {
      const [row] = (
        await pool.query(
          "insert into staff_members (user_id, workspace_org_id, role_id, status, radar_access) values ($1,$2,$3,$4,$5) returning id",
          [userId, workspaceOrgId, roleId[role], status, radarAccess],
        )
      ).rows;
      return row.id;
    }

    const ownerUserId = await seedUser("owner@example.com", "The Owner");
    await seedStaff(ownerUserId, "OWNER", "ACTIVE");

    const adminUserId = await seedUser("admin@example.com", "The Admin");
    await seedStaff(adminUserId, "ADMIN", "ACTIVE");

    const managerUserId = await seedUser("manager@example.com", "Manager One");
    await seedStaff(managerUserId, "MANAGER", "ACTIVE", orgId, true);

    // A second MANAGER whose OWN radar_access is false — proves the panel
    // still works for a MANAGER with RADAR disabled (test #7).
    const managerNoRadarUserId = await seedUser("manager-noradar@example.com", "Manager NoRadar");
    await seedStaff(managerNoRadarUserId, "MANAGER", "ACTIVE", orgId, false);

    const employee1UserId = await seedUser("employee1@example.com", "Employee Bee");
    await seedStaff(employee1UserId, "EMPLOYEE", "ACTIVE", orgId, true);

    // An EMPLOYEE whose OWN radar_access is false — must still appear
    // (test #8): team visibility is independent of the LISTED member's
    // radar_access too, not just the caller's.
    const employee2UserId = await seedUser("employee2-noradar@example.com", "Employee Ann");
    await seedStaff(employee2UserId, "EMPLOYEE", "ACTIVE", orgId, false);

    const employeeSuspendedUserId = await seedUser("employee-suspended@example.com", "Employee Suspended");
    await seedStaff(employeeSuspendedUserId, "EMPLOYEE", "SUSPENDED", orgId);

    const employeeOffboardingUserId = await seedUser("employee-offboarding@example.com", "Employee Offboarding");
    await seedStaff(employeeOffboardingUserId, "EMPLOYEE", "OFFBOARDING", orgId);

    const employeeOtherOrgUserId = await seedUser("employee-other-org@example.com", "Employee OtherOrg");
    await seedStaff(employeeOtherOrgUserId, "EMPLOYEE", "ACTIVE", otherOrgId);

    const clientUserId = await seedUser("client@example.com", "A Client");
    // deliberately zero staff_members rows for clientUserId
    const noMembershipUserId = await seedUser("nomembership@example.com", "No Membership");

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

    const { listManagerTeamMembers } = await import(
      "/Users/arnoldbenzaie/Documents/projects.md/digitalnova/.claude/worktrees/chantier1-phase2-quote-public-page/app/lib/actions/manager-team.ts"
    );

    const asUser = (userId) => {
      sessionMockState = { kind: "session", userId };
    };

    // ---- 1. MANAGER -> can retrieve ACTIVE EMPLOYEE ----
    asUser(managerUserId);
    const result = await listManagerTeamMembers();
    const resultIds = result.map((m) => m.userId).sort();
    assert.deepEqual(resultIds, [employee1UserId, employee2UserId].sort(), "exactly the two ACTIVE EMPLOYEE of this workspace");

    // ---- 2. never any ADMIN ----
    assert.ok(!result.some((m) => m.userId === adminUserId), "ADMIN must never appear");

    // ---- 3. never OWNER ----
    assert.ok(!result.some((m) => m.userId === ownerUserId), "OWNER must never appear");
    assert.ok(!JSON.stringify(result).toLowerCase().includes("owner"), "no OWNER trace anywhere in the serialized result");

    // never the caller's own MANAGER peers either (positive EMPLOYEE-only allowlist)
    assert.ok(!result.some((m) => m.userId === managerUserId || m.userId === managerNoRadarUserId), "no MANAGER in the result, including the caller");

    // ---- 4. never SUSPENDED / OFFBOARDING ----
    assert.ok(!result.some((m) => m.userId === employeeSuspendedUserId), "SUSPENDED EMPLOYEE excluded");
    assert.ok(!result.some((m) => m.userId === employeeOffboardingUserId), "OFFBOARDING EMPLOYEE excluded");

    // ---- 9. workspace isolation ----
    assert.ok(!result.some((m) => m.userId === employeeOtherOrgUserId), "an EMPLOYEE of a DIFFERENT workspace must never appear");

    // ---- 10. no sensitive/unnecessary data ----
    for (const m of result) {
      assert.deepEqual(Object.keys(m).sort(), ["displayName", "role", "userId"], "exactly these three fields, nothing else");
      assert.equal(m.role, "EMPLOYEE");
      assert.ok(!("email" in m) && !("clerkUserId" in m) && !("workspaceOrgId" in m) && !("radarAccess" in m) && !("createdAt" in m) && !("updatedAt" in m));
    }
    const employee1 = result.find((m) => m.userId === employee1UserId);
    assert.equal(employee1.displayName, "Employee Bee", "displayName is the fullName when present");

    // ---- 5. EMPLOYEE -> denied ----
    asUser(employee1UserId);
    await assert.rejects(() => listManagerTeamMembers(), /NEXT_REDIRECT/);

    // ADMIN and OWNER -> denied too (not a MANAGER, same reasoning)
    asUser(adminUserId);
    await assert.rejects(() => listManagerTeamMembers(), /NEXT_REDIRECT/);
    asUser(ownerUserId);
    await assert.rejects(() => listManagerTeamMembers(), /NEXT_REDIRECT/);

    // ---- 6. CLIENT (no staff_members at all) -> denied ----
    asUser(clientUserId);
    await assert.rejects(() => listManagerTeamMembers(), /NEXT_REDIRECT/);

    // no staff_members row at all -> denied (same path as CLIENT)
    asUser(noMembershipUserId);
    await assert.rejects(() => listManagerTeamMembers(), /NEXT_REDIRECT/);

    // unauthenticated -> requireSession()'s own redirect
    sessionMockState = { kind: "unauthenticated" };
    await assert.rejects(() => listManagerTeamMembers(), /NEXT_REDIRECT/);

    // ---- 7. MANAGER caller with radar_access=false -> still works ----
    asUser(managerNoRadarUserId);
    const resultNoRadar = await listManagerTeamMembers();
    assert.deepEqual(
      resultNoRadar.map((m) => m.userId).sort(),
      [employee1UserId, employee2UserId].sort(),
      "a MANAGER's own radar_access=false does not affect this view at all",
    );

    // ---- 8. listed EMPLOYEE with radar_access=false is still visible ----
    // (already proven above: employee2UserId, seeded with radar_access=false,
    // is present in every successful result — re-asserted explicitly here.)
    asUser(managerUserId);
    const resultAgain = await listManagerTeamMembers();
    assert.ok(resultAgain.some((m) => m.userId === employee2UserId), "an EMPLOYEE with radar_access=false is still listed — only their own status/role/workspace matter");

    // suspended a real workforce member remains untouched, no other side effects
    const finalStaffCount = (await pool.query("select count(*)::int n from staff_members")).rows[0].n;
    assert.equal(finalStaffCount, 9, "no row was created or removed by any of the above — read-only throughout");

    // @/db's own module-scoped Pool (db/index.ts caches it on
    // globalThis.pgPool) was opened as a side effect of importing
    // manager-team.ts above and is never otherwise closed — end it BEFORE
    // destroying the container (same fix as every sibling integration test).
    await globalThis.pgPool?.end().catch(() => {});
  } finally {
    await stop();
  }
});
