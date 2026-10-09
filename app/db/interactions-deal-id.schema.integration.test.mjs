// MICRO-STEP 4F.8.2 — structure-only integration test for the additive,
// INERT interactions.deal_id column (migration 0048): nullable uuid, FK to
// deals.id ON DELETE SET NULL, index interactions_deal_id_idx. Schema only —
// no write path sets the column yet, and no backfill exists.
//
// Proves against a REAL Postgres that a FRESH replay of every migration
// (0000 -> 0048) creates exactly that column/FK/index, that deleting a deal
// keeps the interaction (deal_id becomes NULL), and that deleting a client
// still cascades to its interactions exactly as before.
//
// Uses its OWN disposable, ephemeral postgres:16-alpine container (random
// name + port, --rm, destroyed in `after`) — exactly like
// db/schema.rbac.integration.test.mjs and scripts/migration-replay-check.mjs.
// It never touches public-map-approval-test-db, public-map-audit-test-db,
// the Radar validation database, Preview or Production. The only rows it
// inserts live in that throwaway container.
//
// Requires a working local Docker. Run:
//   npx tsx --test db/interactions-deal-id.schema.integration.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const CONTAINER = `pm-interactions-deal-id-${randomUUID().slice(0, 8)}`;
const HOST_PORT = 5580 + Math.floor(Math.random() * 90); // 5580-5669, clear of 5432-5435, replay-check (5400-5489) and the RBAC test (5490-5579)
const PG_USER = "deal_id_replay";
const PG_PASSWORD = "deal_id_replay_local_only";
const PG_DB = "deal_id_replay_check";
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
async function insertClient() {
  const { rows } = await pool.query("insert into crm_clients (name) values ($1) returning id", [`4F.8.2 client ${randomUUID()}`]);
  return rows[0].id;
}
async function insertDeal(clientId) {
  const { rows } = await pool.query("insert into deals (client_id, title) values ($1, $2) returning id", [clientId, `4F.8.2 deal ${randomUUID()}`]);
  return rows[0].id;
}
async function insertInteraction(clientId, dealId) {
  const { rows } = await pool.query(
    "insert into interactions (client_id, deal_id, type, summary) values ($1, $2, 'call', '4F.8.2 interaction') returning id",
    [clientId, dealId],
  );
  return rows[0].id;
}
async function interactionRow(id) {
  return (await pool.query("select id, client_id, deal_id from interactions where id = $1", [id])).rows[0] ?? null;
}

// ---- structure -------------------------------------------------------
test("4F.8.2 migration 0048 is exactly the column + FK + index (no backfill, no other statement)", () => {
  const journal = JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8"));
  const last = journal.entries.at(-1);
  assert.equal(last.idx, 48);
  assert.equal(last.tag, "0048_parallel_nick_fury");
  const statements = readFileSync(`db/migrations/${last.tag}.sql`, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(statements, [
    'ALTER TABLE "interactions" ADD COLUMN "deal_id" uuid;',
    'ALTER TABLE "interactions" ADD CONSTRAINT "interactions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;',
    'CREATE INDEX "interactions_deal_id_idx" ON "interactions" USING btree ("deal_id");',
  ]);
});

test("4F.8.2 interactions.deal_id is a nullable uuid with no default", async () => {
  const { rows } = await pool.query(
    "select data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='interactions' and column_name='deal_id'",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data_type, "uuid");
  assert.equal(rows[0].is_nullable, "YES");
  assert.equal(rows[0].column_default, null);
});

test("4F.8.2 FK interactions.deal_id -> deals.id with ON DELETE SET NULL; client_id FK still ON DELETE CASCADE", async () => {
  const { rows } = await pool.query(
    `select con.conname, a.attname as column, ref.relname as ref_table, ra.attname as ref_column, con.confdeltype
       from pg_constraint con
       join pg_class t on t.oid = con.conrelid and t.relname = 'interactions'
       join pg_class ref on ref.oid = con.confrelid
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
       join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = any(con.confkey)
      where con.contype = 'f'
      order by a.attname`,
  );
  const byColumn = Object.fromEntries(rows.map((r) => [r.column, r]));
  assert.deepEqual(
    { name: byColumn.deal_id.conname, ref: `${byColumn.deal_id.ref_table}.${byColumn.deal_id.ref_column}`, onDelete: byColumn.deal_id.confdeltype },
    { name: "interactions_deal_id_deals_id_fk", ref: "deals.id", onDelete: "n" }, // n = SET NULL
  );
  assert.equal(`${byColumn.client_id.ref_table}.${byColumn.client_id.ref_column}`, "crm_clients.id");
  assert.equal(byColumn.client_id.confdeltype, "c", "client_id stays ON DELETE CASCADE"); // c = CASCADE
  assert.ok(!rows.some((r) => r.column === "deal_id" && r.ref_table !== "deals"), "single-column FK only — no composite client/deal FK in this step");
});

test("4F.8.2 index interactions_deal_id_idx exists on deal_id (non-unique btree); existing interaction indexes intact", async () => {
  const { rows } = await pool.query("select indexname, indexdef from pg_indexes where schemaname='public' and tablename='interactions' order by indexname");
  const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
  assert.equal(defs.interactions_deal_id_idx, "CREATE INDEX interactions_deal_id_idx ON public.interactions USING btree (deal_id)");
  assert.ok(defs.interactions_client_id_idx, "interactions_client_id_idx still present");
  assert.ok(defs.interactions_created_by_user_id_idx, "interactions_created_by_user_id_idx still present");
});

// ---- behaviour -------------------------------------------------------
test("4F.8.2 an interaction without deal_id is still valid (NULL = general client interaction)", async () => {
  const clientId = await insertClient();
  const id = await insertInteraction(clientId, null);
  assert.deepEqual(await interactionRow(id), { id, client_id: clientId, deal_id: null });
});

test("4F.8.2 deleting a deal keeps the interaction and sets its deal_id to NULL", async () => {
  const clientId = await insertClient();
  const dealId = await insertDeal(clientId);
  const id = await insertInteraction(clientId, dealId);
  assert.equal((await interactionRow(id)).deal_id, dealId);
  await pool.query("delete from deals where id = $1", [dealId]);
  assert.deepEqual(await interactionRow(id), { id, client_id: clientId, deal_id: null }, "interaction kept, link cleared");
});

test("4F.8.2 deleting a client still cascades to its interactions (linked or not) and its deals", async () => {
  const clientId = await insertClient();
  const dealId = await insertDeal(clientId);
  const linked = await insertInteraction(clientId, dealId);
  const general = await insertInteraction(clientId, null);
  await pool.query("delete from crm_clients where id = $1", [clientId]);
  assert.equal(await interactionRow(linked), null);
  assert.equal(await interactionRow(general), null);
  assert.equal((await pool.query("select 1 from deals where id = $1", [dealId])).rowCount, 0);
});

test("4F.8.2 a deal_id that references no deal is rejected by the FK (23503)", async () => {
  const clientId = await insertClient();
  await assert.rejects(insertInteraction(clientId, randomUUID()), (error) => error.code === "23503");
});
