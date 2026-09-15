/**
 * PERF (SESSION) — THROTTLE last_login_at WRITES — the smallest safe
 * helper to read/set/restore the ONE shared E2E test account's
 * (contact@public-map.com) `users.last_login_at` column in the LOCAL
 * disposable main test database, so a real browser navigation through a
 * real Clerk session can prove resolveAccessState()'s new throttled write
 * behavior end to end.
 *
 * Sibling of e2e/helpers/main-db-role.mjs / main-db-staff.mjs: SAME
 * database, SAME allowlist guard (db/guard-local-only.ts), SAME
 * `current_database()` assertion — the only difference is the column
 * touched (`users.last_login_at`, never `role_id`/`staff_members`).
 * Deliberately the SAFEST possible mutation in this shared-account test
 * family: `last_login_at` is not a fixture ANY other spec's setup or
 * assertions depend on (confirmed by direct search across the codebase —
 * every consumer is a display/analytics reader, never an authorization or
 * test-fixture input), so this helper never needs the elaborate
 * capture/restore-with-hard-verify choreography main-db-role.mjs's Axis-A
 * role swap requires — it still restores the original value in
 * afterEach/afterAll (good hygiene, consistent with every other helper in
 * this family), but a failed restore here cannot poison another spec's
 * authorization baseline the way a stuck role_id could.
 *
 * WHY DIRECT SQL: resolveAccessState() (lib/session.ts) is the only code
 * path that ever writes this column, and it runs on every authenticated
 * request — there is no way to set it to an arbitrary PAST timestamp
 * through the app itself (the whole point of this spec is to control that
 * timestamp before the request under test).
 */
import pg from "pg";
import { assertLocalOnlyDatabase } from "../../db/guard-local-only.ts";

export const MAIN_E2E_DATABASE_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";

export const TEST_ACCOUNT_EMAIL = "contact@public-map.com";
const EXPECTED_DB_NAME = "public_map_approval_test";

async function withClient(fn) {
  assertLocalOnlyDatabase(MAIN_E2E_DATABASE_URL, "MAIN_E2E_DATABASE_URL");
  const client = new pg.Client({ connectionString: MAIN_E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as db");
    if (rows[0].db !== EXPECTED_DB_NAME) {
      throw new Error(`main-db-last-login: refusing to touch database "${rows[0].db}" — expected "${EXPECTED_DB_NAME}". No write attempted.`);
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Reads the account's current `last_login_at` (Date | null). Also the
 * capture step: call this BEFORE any setLastLoginAt(), keep the result,
 * and pass it to restoreLastLoginAt() afterward. */
export async function readLastLoginAt() {
  return withClient(async (client) => {
    const { rows } = await client.query("select last_login_at from users where email = $1 limit 1", [TEST_ACCOUNT_EMAIL]);
    if (!rows[0]) throw new Error(`main-db-last-login: no users row for ${TEST_ACCOUNT_EMAIL} in ${EXPECTED_DB_NAME}`);
    return rows[0].last_login_at;
  });
}

/** Sets the account's `last_login_at` to an arbitrary value — `null` for
 * "never logged in", or a Date for a specific past timestamp. */
export async function setLastLoginAt(value) {
  return withClient(async (client) => {
    await client.query("update users set last_login_at = $1 where email = $2", [value, TEST_ACCOUNT_EMAIL]);
  });
}

/** Restores the value readLastLoginAt() captured before this test began. */
export async function restoreLastLoginAt(originalValue) {
  return withClient(async (client) => {
    await client.query("update users set last_login_at = $1 where email = $2", [originalValue, TEST_ACCOUNT_EMAIL]);
  });
}

/** Counts "login" product_events recorded for the account since `since` —
 * used to prove the product event stays coupled to the exact same
 * isNewLoginSession boolean that now also gates the last_login_at write. */
export async function loginProductEventCountSince(since) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `select count(*)::int n
         from product_events pe
         join users u on u.id = pe.user_id
        where u.email = $1 and pe.event_type = 'login' and pe.occurred_at >= $2`,
      [TEST_ACCOUNT_EMAIL, since],
    );
    return rows[0].n;
  });
}
