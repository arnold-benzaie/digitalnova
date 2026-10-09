/**
 * 4F.9-E — the smallest safe helper to link ONE `discovery_results` row to
 * an E2E-created CRM prospect in the LOCAL disposable main test database,
 * so e2e/crm-radar-website-promotion.spec.ts can exercise the real
 * NO_WEBSITE -> WEBSITE -> LOW-to-MEDIUM promotion path of the Radar queue
 * (lib/radar/signals.ts / opportunities.ts / priority.ts).
 *
 * WHY A DIRECT WRITE: the only application path that links a Discovery row
 * to a client is convertDiscoveryResult() (lib/actions/radar-discovery-
 * convert.ts), and the only UI that reaches it starts from a live external
 * provider search (app/admin/crm/discovery) — unusable in E2E. A guarded SQL
 * write against the local test DB is the established repo pattern for
 * fixtures the UI cannot create (e2e/helpers/main-db-role.mjs,
 * main-db-staff.mjs), not new infrastructure.
 *
 * ROW SHAPE (db/schema.ts discovery_results): status 'converted' because
 * discovery_results_converted_link_check requires it whenever crm_client_id
 * is set; website NULL and business_status 'OPERATIONAL' (never
 * CLOSED_PERMANENTLY, which would block the promotion); a unique
 * `e2e-website-<uuid>` source_id for the (source, source_id) unique index.
 *
 * SAFETY (mirrors main-db-staff.mjs, same database, same guards):
 *   - MAIN_E2E_DATABASE_URL is the hardcoded localhost constant reused from
 *     main-db-role.mjs — never process.env.DATABASE_URL. The Audit database
 *     (5433) is never touched.
 *   - withDiscoveryClient() re-runs assertLocalOnlyDatabase() AND asserts
 *     current_database() === 'public_map_approval_test' before any query.
 *   - Every delete targets the exact id (and, for clients, the exact name)
 *     this spec created — never a pattern.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertLocalOnlyDatabase } from "../../db/guard-local-only.ts";
import { MAIN_E2E_DATABASE_URL } from "./main-db-role.mjs";

const EXPECTED_DB_NAME = "public_map_approval_test";

async function withDiscoveryClient(fn) {
  assertLocalOnlyDatabase(MAIN_E2E_DATABASE_URL, "MAIN_E2E_DATABASE_URL");
  const client = new pg.Client({ connectionString: MAIN_E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as db");
    if (rows[0].db !== EXPECTED_DB_NAME) {
      throw new Error(
        `main-db-discovery: refusing to touch database "${rows[0].db}" — expected "${EXPECTED_DB_NAME}". No write attempted.`,
      );
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Insert one converted discovery_results row linked to `clientId`, with no
 * website and an OPERATIONAL business status. Returns its id + source_id.
 * Refuses if the client does not exist exactly once.
 */
export async function insertConvertedDiscoveryResult(clientId, { name, category = "restaurant" }) {
  return withDiscoveryClient(async (client) => {
    const { rows: clients } = await client.query("select id from crm_clients where id = $1", [clientId]);
    if (clients.length !== 1) throw new Error(`main-db-discovery: crm_clients ${clientId} not found. No write attempted.`);

    const sourceId = `e2e-website-${randomUUID()}`;
    const { rows } = await client.query(
      `insert into discovery_results (source, source_id, name, category, website, business_status, status, crm_client_id)
       values ('google_places', $1, $2, $3, null, 'OPERATIONAL', 'converted', $4)
       returning id, source_id`,
      [sourceId, name, category, clientId],
    );
    return { id: rows[0].id, sourceId: rows[0].source_id };
  });
}

/** Delete the one discovery_results row this spec created (exact id + source_id). */
export async function deleteDiscoveryResult({ id, sourceId }) {
  return withDiscoveryClient(async (client) => {
    const { rowCount } = await client.query("delete from discovery_results where id = $1 and source_id = $2", [id, sourceId]);
    return rowCount;
  });
}

/**
 * Fallback only — used by the spec's cleanup when its client could not be
 * deleted through the UI (e.g. the claim step failed, so this EMPLOYEE
 * account cannot open the client page). Exact id AND exact name.
 */
export async function deleteCrmClientFixture({ id, name }) {
  return withDiscoveryClient(async (client) => {
    const { rowCount } = await client.query("delete from crm_clients where id = $1 and name = $2", [id, name]);
    return rowCount;
  });
}

/** Read-only presence check of this spec's own fixtures, for the cleanup proof. */
export async function getFixturePresence({ discoveryResultId, clientId }) {
  return withDiscoveryClient(async (client) => {
    const discovery = discoveryResultId
      ? (await client.query("select 1 from discovery_results where id = $1", [discoveryResultId])).rowCount
      : 0;
    const crmClient = clientId ? (await client.query("select 1 from crm_clients where id = $1", [clientId])).rowCount : 0;
    return { discoveryResult: discovery, crmClient };
  });
}
