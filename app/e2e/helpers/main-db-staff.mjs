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
 * G4C-4 — ensureStaffRole(roleName) generalizes the same upsert to any
 * staff_roles name (OWNER/ADMIN/MANAGER/EMPLOYEE), for RADAR AI quota
 * governance E2E (requireStaffMember("RADAR_AI_POLICY_MANAGE"), OWNER-only).
 * ensureRadarStaffMember() is now a thin, BYTE-IDENTICAL-BEHAVIOR wrapper
 * over it (still always EMPLOYEE) — every existing caller is unaffected. A
 * spec that temporarily calls ensureStaffRole("OWNER"/"ADMIN"/"MANAGER")
 * MUST call ensureRadarStaffMember() again afterward to restore the
 * standing EMPLOYEE seed other specs depend on (see e2e/ai-governance.spec.ts).
 *
 * SESSION AUTHORITY UNIFICATION — removeStaffMember() (delete, not
 * deactivate: there is no third status between ACTIVE and "no row", and
 * resolveAccessState() only ever checks status = 'ACTIVE') is for specs
 * that test the Axis-A role model in isolation (e.g. e2e/staff-rbac.spec.ts,
 * the "client" case in e2e/ai-governance.spec.ts): now that an ACTIVE
 * staff_members row makes resolveAccessState() resolve context="WORKFORCE"
 * UNCONDITIONALLY (strict priority over any Axis-A membership, including
 * "client" — see lib/session.ts), the standing EMPLOYEE seed this file
 * otherwise keeps persistent would confound any test that sets the shared
 * account's Axis-A role and expects THAT role's legacy behavior alone to
 * decide the outcome. Callers MUST restore the seed afterward (via
 * ensureRadarStaffMember()) so crm-radar.spec.ts / ai-governance.spec.ts
 * are unaffected regardless of run order.
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
 * Resolve — never create — the two ids every caller needs regardless of
 * role: the single internal workspace org, and the shared test account's
 * users row. Each must match exactly one row.
 */
async function resolveOrgAndUser(client) {
  const org = await resolveExactlyOne(
    client,
    "select id from organizations where is_internal = true",
    [],
    "internal workspace (organizations.is_internal = true)",
  );
  const user = await resolveExactlyOne(
    client,
    "select id from users where email = $1",
    [TEST_ACCOUNT_EMAIL],
    `users row for ${TEST_ACCOUNT_EMAIL}`,
  );
  return { orgId: org.id, userId: user.id };
}

/** Resolve — never create — a specific staff_roles id by name (seeded by
 * migration 0034). Only needed by the write path (ensureStaffRole). */
async function resolveRoleId(client, roleName) {
  const role = await resolveExactlyOne(client, "select id from staff_roles where name = $1", [roleName], `staff_roles."${roleName}" (seeded by migration 0034)`);
  return role.id;
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
 * Idempotent: ensure contact@public-map.com has exactly one ACTIVE
 * `roleName` staff_members row in the internal workspace. Upserts on
 * (user_id, workspace_org_id); a pre-existing row with the wrong status or
 * role is deterministically converted back to ACTIVE / `roleName`. Reads
 * the row back and hard-asserts it. Returns the verified snapshot
 * { userId, workspaceOrgId, status, roleName }. `roleName` MUST be one of
 * the four staff_roles seeded by migration 0034 (OWNER/ADMIN/MANAGER/
 * EMPLOYEE) — resolveExactlyOne() throws loudly for anything else rather
 * than silently creating a new role.
 */
export async function ensureStaffRole(roleName) {
  return withStaffClient(async (client) => {
    const { orgId, userId } = await resolveOrgAndUser(client);
    const roleId = await resolveRoleId(client, roleName);
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
    if (snap.status !== ACTIVE_STATUS || snap.roleName !== roleName) {
      throw new Error(
        `main-db-staff: post-upsert verification failed — status="${snap.status}" role="${snap.roleName}", ` +
          `expected "${ACTIVE_STATUS}" / "${roleName}".`,
      );
    }
    return snap;
  });
}

/**
 * UNCHANGED CONTRACT: always EMPLOYEE. Kept as its own named export
 * (rather than inlining `ensureStaffRole("EMPLOYEE")` at every existing
 * call site) so e2e/crm-radar.spec.ts's own docstring/intent — "the
 * least-privilege identity" — stays self-documenting at its call site.
 */
export async function ensureRadarStaffMember() {
  return ensureStaffRole(TARGET_STAFF_ROLE);
}

/**
 * Read-only. Returns the test account's staff_members snapshot
 * { userId, workspaceOrgId, status, roleName }, or null if it has no row in
 * the internal workspace. No secrets are read or returned.
 */
export async function getRadarStaffMemberSnapshot() {
  return withStaffClient(async (client) => {
    const { orgId, userId } = await resolveOrgAndUser(client);
    return readSnapshot(client, userId, orgId);
  });
}

/**
 * Deletes the test account's staff_members row in the internal workspace,
 * if any. Idempotent (no-op if already absent). Verifies the row is gone
 * before returning. See the SESSION AUTHORITY UNIFICATION note above this
 * file's export list for why this exists and why callers must restore the
 * standing seed via ensureRadarStaffMember() afterward.
 */
export async function removeStaffMember() {
  return withStaffClient(async (client) => {
    const { orgId, userId } = await resolveOrgAndUser(client);
    await client.query("delete from staff_members where user_id = $1 and workspace_org_id = $2", [userId, orgId]);
    const snap = await readSnapshot(client, userId, orgId);
    if (snap) {
      throw new Error("main-db-staff: removeStaffMember() left a row behind — delete did not take effect.");
    }
  });
}
