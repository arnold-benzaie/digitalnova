/**
 * RADAR-E2E-AUTH-1 — the smallest safe helper to give the ONE shared E2E
 * test account (contact@public-map.com) an ACTIVE EMPLOYEE `staff_members`
 * row (Axis-C RBAC — db/schema.ts staff_members / staff_roles) in the LOCAL
 * disposable main test database, so RADAR browser tests can exercise the
 * real requireStaffMember("RADAR_WORK") mutations (claimProspect, and later
 * createInteraction) and locate their fixture deterministically via
 * `/admin/crm/radar?assignee=me` instead of a DB-size-dependent page scan.
 *
 * Sibling of e2e/helpers/main-db-role.mjs: SAME database, SAME allowlist
 * guard (db/guard-local-only.ts), SAME `current_database()` assertion — the
 * only difference is the table (staff_members, Axis-C) rather than
 * memberships (Axis-A). The main app has no self-service staff-membership
 * flow and requireStaffMember() is admin-workflow-gated, so — exactly like
 * main-db-role.mjs and e2e/audit-permissions.spec.ts — a direct, guarded
 * SQL upsert against the local test DB is the established repo pattern, not
 * new infrastructure.
 *
 * ROLE = EMPLOYEE by design (lib/rbac/permissions.ts): EMPLOYEE holds
 * RADAR_WORK + RADAR_QUEUE_VIEW but NOT RADAR_ASSIGN, so getRadarCapabilities()
 * resolves { canClaimToSelf: true, canAssignOthers: false, canReleaseOwn:
 * true } — the least-privilege identity that still lets the queue E2E claim
 * its own fixture and proves the negative (no assign-to-others control).
 *
 * PERSISTENCE: ensureRadarStaffMember() is an idempotent upsert on the
 * `staff_members_user_workspace_unique (user_id, workspace_org_id)` index —
 * one row, ever. It is a PERSISTENT local-test seed: e2e/crm-radar.spec.ts
 * calls it in beforeAll and never deletes it. An extra ACTIVE EMPLOYEE
 * Axis-C row changes NO Axis-A behaviour (every /admin segment gate and the
 * Radar-queue read are requireStaffRole()/requireInternalStaff(), which
 * never consult staff_members), so no other spec is affected — and a
 * standing seed avoids the restore-race machinery main-db-role.mjs needs
 * for its per-test Axis-A swap.
 *
 * SAFETY (mirrors main-db-role.mjs, three independent layers):
 *   - MAIN_E2E_DATABASE_URL is the hardcoded localhost constant reused from
 *     main-db-role.mjs — never process.env.DATABASE_URL (which is
 *     Production in .env.local).
 *   - withStaffClient() re-runs assertLocalOnlyDatabase() (db/guard-local-only.ts
 *     allowlist: hostname must be localhost / 127.0.0.1) AND asserts
 *     current_database() === 'public_map_approval_test' before any write.
 *   - resolveContext() REFUSES (never creates) if the internal workspace,
 *     the EMPLOYEE staff_roles row, or the test account's users row is
 *     missing or ambiguous — a non-migrated / non-seeded DB surfaces loudly
 *     instead of being silently bootstrapped.
 */
import pg from "pg";
import { assertLocalOnlyDatabase } from "../../db/guard-local-only.ts";
import { MAIN_E2E_DATABASE_URL, TEST_ACCOUNT_EMAIL } from "./main-db-role.mjs";

const EXPECTED_DB_NAME = "public_map_approval_test";
const TARGET_STAFF_ROLE = "EMPLOYEE";
const ACTIVE_STATUS = "ACTIVE";

async function withStaffClient(fn) {
  assertLocalOnlyDatabase(MAIN_E2E_DATABASE_URL, "MAIN_E2E_DATABASE_URL");
  const client = new pg.Client({ connectionString: MAIN_E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as db");
    if (rows[0].db !== EXPECTED_DB_NAME) {
      throw new Error(
        `main-db-staff: refusing to touch database "${rows[0].db}" — expected "${EXPECTED_DB_NAME}". No write attempted.`,
      );
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function resolveExactlyOne(client, sql, params, label) {
  const { rows } = await client.query(sql, params);
  if (rows.length === 0) {
    throw new Error(`main-db-staff: ${label} not found in ${EXPECTED_DB_NAME}. Is the local test DB migrated and seeded?`);
  }
  if (rows.length > 1) {
    throw new Error(`main-db-staff: ${label} is ambiguous (${rows.length} rows) in ${EXPECTED_DB_NAME}. Refusing to guess.`);
  }
  return rows[0];
}

/**
 * Resolve — never create — the three ids the upsert needs: the single
 * internal workspace org, the EMPLOYEE staff_roles row (seeded by migration
 * 0034), and the shared test account's users row. Each must match exactly
 * one row.
 */
async function resolveContext(client) {
  const org = await resolveExactlyOne(
    client,
    "select id from organizations where is_internal = true",
    [],
    "internal workspace (organizations.is_internal = true)",
  );
  const role = await resolveExactlyOne(
    client,
    "select id from staff_roles where name = $1",
    [TARGET_STAFF_ROLE],
    `staff_roles."${TARGET_STAFF_ROLE}" (seeded by migration 0034)`,
  );
  const user = await resolveExactlyOne(
    client,
    "select id from users where email = $1",
    [TEST_ACCOUNT_EMAIL],
    `users row for ${TEST_ACCOUNT_EMAIL}`,
  );
  return { orgId: org.id, roleId: role.id, userId: user.id };
}

async function readSnapshot(client, userId, orgId) {
  const { rows } = await client.query(
    `select sm.user_id, sm.workspace_org_id, sm.status, sr.name as role_name
       from staff_members sm
       join staff_roles sr on sr.id = sm.role_id
      where sm.user_id = $1 and sm.workspace_org_id = $2
      limit 1`,
    [userId, orgId],
  );
  const row = rows[0];
  return row
    ? { userId: row.user_id, workspaceOrgId: row.workspace_org_id, status: row.status, roleName: row.role_name }
    : null;
}

/**
 * Idempotent: ensure contact@public-map.com has exactly one ACTIVE EMPLOYEE
 * staff_members row in the internal workspace. Upserts on
 * (user_id, workspace_org_id); a pre-existing row with the wrong status or
 * role is deterministically converted back to ACTIVE / EMPLOYEE. Reads the
 * row back and hard-asserts it. Returns the verified snapshot
 * { userId, workspaceOrgId, status, roleName }.
 */
export async function ensureRadarStaffMember() {
  return withStaffClient(async (client) => {
    const { orgId, roleId, userId } = await resolveContext(client);
    await client.query(
      `insert into staff_members (user_id, workspace_org_id, role_id, status)
       values ($1, $2, $3, $4)
       on conflict (user_id, workspace_org_id)
       do update set role_id = excluded.role_id, status = excluded.status, updated_at = now()`,
      [userId, orgId, roleId, ACTIVE_STATUS],
    );
    const snap = await readSnapshot(client, userId, orgId);
    if (!snap) {
      throw new Error("main-db-staff: upsert did not produce a staff_members row.");
    }
    if (snap.status !== ACTIVE_STATUS || snap.roleName !== TARGET_STAFF_ROLE) {
      throw new Error(
        `main-db-staff: post-upsert verification failed — status="${snap.status}" role="${snap.roleName}", ` +
          `expected "${ACTIVE_STATUS}" / "${TARGET_STAFF_ROLE}".`,
      );
    }
    return snap;
  });
}

/**
 * Read-only. Returns the test account's staff_members snapshot
 * { userId, workspaceOrgId, status, roleName }, or null if it has no row in
 * the internal workspace. No secrets are read or returned.
 */
export async function getRadarStaffMemberSnapshot() {
  return withStaffClient(async (client) => {
    const { orgId, userId } = await resolveContext(client);
    return readSnapshot(client, userId, orgId);
  });
}
