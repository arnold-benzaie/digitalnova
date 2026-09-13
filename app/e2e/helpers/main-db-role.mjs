/**
 * PHASE 2A.0 — the smallest safe helper for main-app RBAC E2E
 * (e2e/staff-rbac.spec.ts). Flips the ONE shared E2E test account's
 * `memberships.role_id` in the LOCAL disposable main test database for the
 * duration of a test, then restores it.
 *
 * Why direct SQL and not a UI flow: the main app has no self-service role
 * change, and changeUserRole() is admin-only — the test needs to become a
 * non-admin, which no UI path allows. This mirrors the Audit suite's own
 * precedent (e2e/audit-permissions.spec.ts mutates audit_staff_memberships
 * directly) — the difference is only which database and which table.
 *
 * SAFETY:
 *   - MAIN_E2E_DATABASE_URL is a hardcoded localhost constant matching
 *     e2e/README.md and lib/actions/*.integration.test.mjs — never read
 *     from .env.local (whose DATABASE_URL is Production).
 *   - Every entry point re-runs assertLocalOnlyDatabase() AND checks
 *     current_database() === 'public_map_approval_test' before any write.
 *   - captureOriginalRole() refuses to proceed unless the account is
 *     currently `admin` — a non-admin baseline means a previous run left
 *     it broken, and this helper must surface that, not build on top of it.
 *   - restoreOriginalRole() re-reads and hard-asserts the role is back;
 *     the spec calls it from afterEach AND afterAll and fails the run
 *     loudly if verification fails.
 */
import pg from "pg";
import { assertLocalOnlyDatabase } from "../../db/guard-local-only.ts";

export const MAIN_E2E_DATABASE_URL =
  "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";

export const TEST_ACCOUNT_EMAIL = "contact@public-map.com";
export const EXPECTED_BASELINE_ROLE = "admin";
const EXPECTED_DB_NAME = "public_map_approval_test";

async function withClient(fn) {
  assertLocalOnlyDatabase(MAIN_E2E_DATABASE_URL, "MAIN_E2E_DATABASE_URL");
  const client = new pg.Client({ connectionString: MAIN_E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as db");
    if (rows[0].db !== EXPECTED_DB_NAME) {
      throw new Error(
        `main-db-role: refusing to touch database "${rows[0].db}" — expected "${EXPECTED_DB_NAME}". No write attempted.`,
      );
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function roleIdByName(client, name) {
  const { rows } = await client.query("select id from roles where name = $1 limit 1", [name]);
  if (!rows[0]) throw new Error(`main-db-role: role "${name}" not found in ${EXPECTED_DB_NAME}.roles`);
  return rows[0].id;
}

async function membershipRow(client, email) {
  const { rows } = await client.query(
    `select m.user_id, m.organization_id, r.name as role_name, m.role_id
       from users u
       join memberships m on m.user_id = u.id
       join roles r on r.id = m.role_id
      where u.email = $1
      limit 1`,
    [email],
  );
  if (!rows[0]) throw new Error(`main-db-role: no membership for ${email} in ${EXPECTED_DB_NAME}`);
  return rows[0];
}

/**
 * Reads the account's current membership. Throws unless it is exactly the
 * expected `admin` baseline — refuses to run the suite on a poisoned DB.
 * Returns the data the spec needs to restore afterwards.
 */
export async function captureOriginalRole() {
  return withClient(async (client) => {
    const m = await membershipRow(client, TEST_ACCOUNT_EMAIL);
    if (m.role_name !== EXPECTED_BASELINE_ROLE) {
      throw new Error(
        `main-db-role: ${TEST_ACCOUNT_EMAIL} baseline role is "${m.role_name}", expected "${EXPECTED_BASELINE_ROLE}". ` +
          "A previous run likely failed to restore it — fix the DB before running this suite; do not build on a poisoned baseline.",
      );
    }
    return { userId: m.user_id, organizationId: m.organization_id, originalRoleId: m.role_id };
  });
}

/** Sets the account's membership role to `roleName` (e.g. "client", "agent"). */
export async function setRole(ctx, roleName) {
  return withClient(async (client) => {
    const roleId = await roleIdByName(client, roleName);
    await client.query("update memberships set role_id = $1 where user_id = $2 and organization_id = $3", [
      roleId,
      ctx.userId,
      ctx.organizationId,
    ]);
  });
}

/**
 * Restores the captured role and VERIFIES it. Safe to call repeatedly
 * (afterEach + afterAll). Throws loudly if the account is not back to the
 * expected baseline — a failed restore must fail the run, never pass
 * silently.
 */
export async function restoreOriginalRole(ctx) {
  return withClient(async (client) => {
    await client.query("update memberships set role_id = $1 where user_id = $2 and organization_id = $3", [
      ctx.originalRoleId,
      ctx.userId,
      ctx.organizationId,
    ]);
    const m = await membershipRow(client, TEST_ACCOUNT_EMAIL);
    if (m.role_name !== EXPECTED_BASELINE_ROLE) {
      throw new Error(
        `main-db-role: RESTORE FAILED — ${TEST_ACCOUNT_EMAIL} is "${m.role_name}", expected "${EXPECTED_BASELINE_ROLE}". ` +
          "Restore this manually before any other E2E run.",
      );
    }
  });
}

/**
 * SESSION AUTHORITY UNIFICATION — deletes the shared account's Axis-A
 * membership row entirely (not just its role), to test a genuine "Axis-C
 * staff_members ACTIVE, NO Axis-A membership at all" identity — the exact
 * shape resolveAccessState() must resolve to context="WORKFORCE" with no
 * Axis-A row to fall back to. Safe: memberships has no other table
 * referencing it by foreign key (db/schema.ts), and its PK is
 * (user_id, organization_id) — captureOriginalRole()'s returned ctx already
 * carries everything restoreMembership() needs to put the exact same row
 * back. MUST be paired with restoreMembership(ctx) in the same test (or its
 * afterEach/afterAll) — never left deleted, since every other spec's
 * captureOriginalRole() throws loudly if this row is missing.
 */
export async function removeMembership(ctx) {
  return withClient(async (client) => {
    await client.query("delete from memberships where user_id = $1 and organization_id = $2", [ctx.userId, ctx.organizationId]);
  });
}

/**
 * Re-inserts the exact membership row removeMembership(ctx) deleted, using
 * the same `ctx` captureOriginalRole() returned. Idempotent: a conflicting
 * (user_id, organization_id) row — the row was never actually removed, or
 * setRole() changed its role_id in place rather than deleting it — is left
 * as-is by `on conflict do nothing`. Only verifies the row EXISTS with
 * SOME role, not that it is `admin`: a spec that called setRole() instead
 * of removeMembership() relies on the caller also calling
 * restoreOriginalRole() (which owns the `admin`-baseline verification) to
 * fix the role_id afterward — asserting `admin` here would fire before
 * that has a chance to run.
 */
export async function restoreMembership(ctx) {
  return withClient(async (client) => {
    await client.query(
      `insert into memberships (user_id, organization_id, role_id)
       values ($1, $2, $3)
       on conflict (user_id, organization_id) do nothing`,
      [ctx.userId, ctx.organizationId, ctx.originalRoleId],
    );
    const { rows } = await client.query("select 1 from memberships where user_id = $1 and organization_id = $2", [
      ctx.userId,
      ctx.organizationId,
    ]);
    if (rows.length === 0) {
      throw new Error(`main-db-role: restoreMembership FAILED — no membership row for ${TEST_ACCOUNT_EMAIL} after insert.`);
    }
  });
}
