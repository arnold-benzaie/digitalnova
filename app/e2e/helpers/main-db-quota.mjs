/**
 * RADAR INTELLIGENCE V2.1 — Phase G4C-4 — the smallest safe helper to set
 * and clear the RADAR AI quota `radar_ai_quota_policy` / `radar_ai_quota_counter`
 * rows in the LOCAL disposable main test database, so browser E2E can
 * exercise the real NORMAL/WARNING/LIMITED/DISABLED statuses on
 * /admin/owner/ai-governance. Sibling of main-db-role.mjs /
 * main-db-staff.mjs: SAME database, SAME allowlist guard
 * (db/guard-local-only.ts), SAME `current_database()` assertion — the
 * only difference is the two tables.
 *
 * Neither table has a self-service "set current usage" UI path (the
 * counter is machine-only by design, and the policy form has no "seed a
 * specific count" affordance) — exactly the class of state
 * main-db-role.mjs's own docstring already establishes the precedent for:
 * a direct, guarded SQL upsert against the local test DB.
 *
 * clearLocalQuotaPolicy()/clearLocalQuotaCounter() restore the natural
 * "no row yet" baseline (confirmed empty before this phase's first use —
 * see the G4C-4 validation report) — never a fabricated default row, so
 * every OTHER spec that might run afterward sees the exact same
 * pre-G4C-4 state.
 *
 * SAFETY (mirrors main-db-role.mjs / main-db-staff.mjs, three independent
 * layers): hardcoded localhost connection string reused from
 * main-db-role.mjs (never process.env.DATABASE_URL, which is Production
 * in .env.local); assertLocalOnlyDatabase() allowlist check;
 * current_database() === 'public_map_approval_test' asserted before any
 * write.
 */
import pg from "pg";
import { assertLocalOnlyDatabase } from "../../db/guard-local-only.ts";
import { MAIN_E2E_DATABASE_URL } from "./main-db-role.mjs";

const EXPECTED_DB_NAME = "public_map_approval_test";
const SINGLETON_ID = "global";
const GLOBAL_SCOPE = "global";

async function withQuotaClient(fn) {
  assertLocalOnlyDatabase(MAIN_E2E_DATABASE_URL, "MAIN_E2E_DATABASE_URL");
  const client = new pg.Client({ connectionString: MAIN_E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as db");
    if (rows[0].db !== EXPECTED_DB_NAME) {
      throw new Error(`main-db-quota: refusing to touch database "${rows[0].db}" — expected "${EXPECTED_DB_NAME}". No write attempted.`);
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Same UTC-calendar-day key construction as quota-counter-store.ts's own
 * currentGlobalQuotaKey() — duplicated here only because this helper must
 * never import application runtime code into a raw-SQL local-DB script. */
function currentGlobalQuotaKey(now = new Date()) {
  return `${GLOBAL_SCOPE}:${now.toISOString().slice(0, 10)}`;
}

function utcStartOfDay(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Upserts the singleton policy row. `dailyRequestLimit`/`dailyTokenLimit`
 * accept `null` (unlimited) or a non-negative integer, including `0`. */
export async function setLocalQuotaPolicy({ enabled, dailyRequestLimit, dailyTokenLimit, warningThresholdPercent }) {
  return withQuotaClient(async (client) => {
    await client.query(
      `insert into radar_ai_quota_policy (id, enabled, daily_request_limit, daily_token_limit, warning_threshold_percent, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (id) do update set
         enabled = excluded.enabled,
         daily_request_limit = excluded.daily_request_limit,
         daily_token_limit = excluded.daily_token_limit,
         warning_threshold_percent = excluded.warning_threshold_percent,
         updated_at = now()`,
      [SINGLETON_ID, enabled, dailyRequestLimit, dailyTokenLimit, warningThresholdPercent],
    );
  });
}

/** Deletes the singleton policy row — restores the "never configured yet"
 * baseline (loadRadarAiQuotaPolicyWithStatus() -> status: "missing"). */
export async function clearLocalQuotaPolicy() {
  return withQuotaClient(async (client) => {
    await client.query("delete from radar_ai_quota_policy where id = $1", [SINGLETON_ID]);
  });
}

/** Upserts today's UTC-period counter row with an EXACT request/token
 * count — never an increment, so a test's fixture is deterministic
 * regardless of how many times it has run before. */
export async function setLocalQuotaCounter({ requestCount, tokenCount }) {
  const now = new Date();
  const key = currentGlobalQuotaKey(now);
  const windowStart = utcStartOfDay(now);
  return withQuotaClient(async (client) => {
    await client.query(
      `insert into radar_ai_quota_counter (key, request_count, token_count, window_start, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (key) do update set
         request_count = excluded.request_count,
         token_count = excluded.token_count,
         updated_at = now()`,
      [key, requestCount, tokenCount, windowStart],
    );
  });
}

/** Deletes today's UTC-period counter row — restores the "no activity yet"
 * baseline (readGlobalQuotaCounter() -> null). */
export async function clearLocalQuotaCounter() {
  const key = currentGlobalQuotaKey(new Date());
  return withQuotaClient(async (client) => {
    await client.query("delete from radar_ai_quota_counter where key = $1", [key]);
  });
}
