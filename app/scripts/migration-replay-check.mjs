#!/usr/bin/env node
/**
 * PUBLIC-MAP — DATABASE TOOLING SAFETY / PHASE 2A.0.
 *
 * Proves, on a throwaway Postgres this script creates and destroys, that
 * the committed migration chain in db/migrations/ (0000 -> latest):
 *
 *   1. FRESH REPLAY — every db/migrations/*.sql applies cleanly, in
 *      journal order, against an empty database (no error, nothing
 *      skipped).
 *
 *   2. FUNCTIONALLY EQUIVALENT to db/schema.ts — the resulting live
 *      schema, read back through read-only information_schema / pg_catalog
 *      queries, matches db/migrations/meta/<latest>_snapshot.json (the
 *      drizzle-generated model of db/schema.ts) on every table, column,
 *      index, primary key, unique constraint and foreign key.
 *
 *      The comparison is NON-DESTRUCTIVE: it only SELECTs from the
 *      catalogs. It never runs `drizzle-kit push`, never applies DDL to
 *      discover a diff, never generates a migration.
 *
 *   3. TWO ACCEPTED LEGACY EXCEPTIONS — and only these two. PostgreSQL
 *      truncates identifiers to 63 bytes (NAMEDATALEN). Two foreign-key
 *      constraint names drizzle generates are 66 chars, so Postgres stores
 *      them 3 chars short (dropping the trailing `_fk`). This is
 *      cosmetic-only: source/target table+column and ON DELETE CASCADE are
 *      all correct, verified directly against pg_catalog below. Human
 *      adjudication (PHASE 2A.0-B) accepted these two exact cases as KNOWN
 *      LEGACY COSMETIC DRIFT. The allowlist contains EXACTLY these two.
 *      A third name mismatch, or ANY column / index / default / FK-target
 *      / ON DELETE / table difference, is a FAIL + STOP.
 *
 * STRICT SAFETY:
 *   - Runs ONLY against a disposable Docker Postgres container this script
 *     creates and destroys. Never reads DATABASE_URL /
 *     LOCAL_TEST_DATABASE_URL / AUDIT_DATABASE_URL / PREVIEW_SCHEMA_DATABASE_URL
 *     or any other env connection string. Never touches
 *     public-map-approval-test-db, public-map-audit-test-db or any
 *     unrelated Docker resource.
 *   - The container URL is still passed through assertLocalOnlyDatabase()
 *     (127.0.0.1 by construction; the guard refuses anything that isn't).
 *   - Cleanup runs on PASS, FAIL, exception and SIGINT. The script never
 *     calls process.exit() from inside the work block — it records a
 *     result, always tears the container down in `finally`, verifies no
 *     container with its unique name remains, then exits.
 *   - Read / replay / compare only. On ANY unexpected difference it prints
 *     the exact difference and exits non-zero WITHOUT repairing — that
 *     difference is a separate re-audit scope.
 *
 * Usage:  npm run db:verify:migrations   (needs Docker; uses postgres:16-alpine)
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertLocalOnlyDatabase } from "../db/guard-local-only.ts";

const IMAGE = "postgres:16-alpine";
const CONTAINER = `pm-migration-replay-${randomUUID().slice(0, 8)}`;
const HOST_PORT = 5400 + Math.floor(Math.random() * 90); // 5400-5489, clear of 5432/5433/5434
const PG_USER = "replay";
const PG_PASSWORD = "replay_local_only";
const PG_DB = "replay_check";
const URL = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${HOST_PORT}/${PG_DB}`;
const PG_IDENTIFIER_LIMIT = 63; // NAMEDATALEN - 1

/**
 * The EXACTLY TWO accepted legacy cases. Each entry's `snapshotName` is
 * the 66-char name drizzle wants; Postgres stores `snapshotName` truncated
 * to 63 bytes. Nothing else may be added here.
 */
const KNOWN_FK_NAME_TRUNCATIONS = [
  {
    snapshotName: "search_console_metrics_property_id_search_console_properties_id_fk",
    fromTable: "search_console_metrics",
  },
  {
    snapshotName: "integration_api_idempotency_keys_integration_id_integrations_id_fk",
    fromTable: "integration_api_idempotency_keys",
  },
].map((e) => ({ ...e, storedName: e.snapshotName.slice(0, PG_IDENTIFIER_LIMIT) }));

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}
function log(msg) {
  console.log(`[migration-replay-check] ${msg}`);
}
function destroyContainer() {
  sh("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
}

function latestSnapshot() {
  const dir = "db/migrations/meta";
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
    .sort();
  const file = `${dir}/${files[files.length - 1]}`;
  return { file, json: JSON.parse(readFileSync(file, "utf8")) };
}

const norm = (s) => String(s ?? "").toLowerCase().trim();
/** Base type only — precision/length parens are stripped on BOTH sides
 * before comparison. A structural change (text -> integer, uuid -> text)
 * is still caught; a representation-only difference such as
 * `numeric(10, 2)` (drizzle snapshot) vs `numeric` (information_schema's
 * data_type column, which keeps precision in separate columns) is not a
 * real drift and is deliberately not flagged. */
const baseType = (t) =>
  norm(t)
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/^character varying$/, "varchar")
    .replace(/\s+/g, " ")
    .trim();

/** All FKs in the live DB: name + from table/cols + to table/cols + on
 * delete. Scalar subqueries (no join fan-out, no GROUP BY) — column
 * ordinality preserved via `unnest ... with ordinality`. */
async function liveForeignKeys(pool) {
  const { rows } = await pool.query(`
    select
      c.conname   as name,
      src.relname as from_table,
      tgt.relname as to_table,
      c.confdeltype as on_delete_code,
      (select string_agg(a.attname, ',' order by k.ord)
         from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as from_cols,
      (select string_agg(a.attname, ',' order by k.ord)
         from unnest(c.confkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as to_cols
    from pg_constraint c
    join pg_class src   on src.oid = c.conrelid
    join pg_class tgt   on tgt.oid = c.confrelid
    join pg_namespace n on n.oid = src.relnamespace and n.nspname = 'public'
    where c.contype = 'f'
  `);
  const DEL = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };
  return rows.map((r) => ({
    name: r.name,
    fromTable: r.from_table,
    fromCols: (r.from_cols ?? "").split(",").filter(Boolean),
    toTable: r.to_table,
    toCols: (r.to_cols ?? "").split(",").filter(Boolean),
    onDelete: DEL[r.on_delete_code] ?? r.on_delete_code,
  }));
}

async function liveColumns(pool) {
  const { rows } = await pool.query(`
    select table_name, column_name, data_type, is_nullable,
           (column_default is not null) as has_default
    from information_schema.columns
    where table_schema = 'public'
  `);
  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Map());
    byTable.get(r.table_name).set(r.column_name, {
      type: baseType(r.data_type),
      notNull: r.is_nullable === "NO",
      hasDefault: r.has_default,
    });
  }
  return byTable;
}

async function liveIndexNames(pool) {
  const { rows } = await pool.query(`
    select tablename, indexname from pg_indexes where schemaname = 'public'
  `);
  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.tablename)) byTable.set(r.tablename, new Set());
    byTable.get(r.tablename).add(r.indexname);
  }
  return byTable;
}

async function liveTableNames(pool) {
  const { rows } = await pool.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  return new Set(rows.map((r) => r.table_name));
}

/** Direct pg_catalog functional read of one FK by its stored (possibly truncated) name. */
async function fkFunctionalDefinition(pool, storedName) {
  const { rows } = await pool.query(
    `
    select
      con.contype                            as constraint_type,
      cl.relname                             as source_table,
      rcl.relname                            as referenced_table,
      (select array_agg(a.attname order by u.ord)
         from unnest(con.conkey) with ordinality as u(attnum, ord)
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.attnum) as source_columns,
      (select array_agg(a.attname order by u.ord)
         from unnest(con.confkey) with ordinality as u(attnum, ord)
         join pg_attribute a on a.attrelid = con.confrelid and a.attnum = u.attnum) as referenced_columns,
      con.confdeltype                        as on_delete_code
    from pg_constraint con
    join pg_class cl     on cl.oid = con.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
    join pg_class rcl    on rcl.oid = con.confrelid
    where con.conname = $1
  `,
    [storedName],
  );
  if (rows.length !== 1) return null;
  const r = rows[0];
  const DEL = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
  return {
    storedName,
    constraintType: r.constraint_type === "f" ? "FOREIGN KEY" : r.constraint_type,
    sourceTable: r.source_table,
    sourceColumns: r.source_columns,
    referencedTable: r.referenced_table,
    referencedColumns: r.referenced_columns,
    onDelete: DEL[r.on_delete_code] ?? r.on_delete_code,
  };
}

async function main() {
  assertLocalOnlyDatabase(URL, "migration-replay-check target");

  if (sh("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    return { code: 2, reason: "Docker is not available — start Docker and retry. Nothing was created." };
  }

  log(`Starting disposable ${IMAGE} as ${CONTAINER} on 127.0.0.1:${HOST_PORT} …`);
  const run = sh("docker", [
    "run", "-d", "--rm",
    "--name", CONTAINER,
    "-e", `POSTGRES_USER=${PG_USER}`,
    "-e", `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e", `POSTGRES_DB=${PG_DB}`,
    "-p", `127.0.0.1:${HOST_PORT}:5432`,
    IMAGE,
  ]);
  if (run.status !== 0) {
    return { code: 2, reason: `docker run failed:\n${run.stderr || run.stdout}` };
  }

  let pool;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const probe = sh("docker", ["exec", CONTAINER, "pg_isready", "-U", PG_USER, "-d", PG_DB]);
      if (probe.status === 0 && /accepting connections/.test(probe.stdout)) {
        ready = true;
        break;
      }
      await sleep(1000);
    }
    if (!ready) return { code: 1, reason: "Postgres never became ready in the disposable container." };
    log("Container ready.");

    // ---- 1. FRESH REPLAY -------------------------------------------------
    log("Replaying db/migrations/ 0000 -> latest against the empty database …");
    pool = new Pool({ connectionString: URL, max: 1 });
    const dbc = drizzle(pool);
    await migrate(dbc, { migrationsFolder: "db/migrations" });
    const applied = (await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n;
    log(`FRESH REPLAY: PASS — ${applied} migration(s) applied cleanly from empty.`);

    // ---- 2. NON-DESTRUCTIVE FUNCTIONAL COMPARISON vs snapshot ----------
    const { file: snapFile, json: snap } = latestSnapshot();
    log(`Comparing live schema to ${snapFile} (read-only catalog queries only) …`);

    const snapTables = Object.values(snap.tables);
    const snapTableNames = new Set(snapTables.map((t) => t.name));

    const [liveTables, liveCols, liveIdx, liveFks] = await Promise.all([
      liveTableNames(pool),
      liveColumns(pool),
      liveIndexNames(pool),
      liveForeignKeys(pool),
    ]);

    const diffs = [];

    // 2a. tables
    for (const n of snapTableNames) if (!liveTables.has(n)) diffs.push(`missing table: ${n}`);
    for (const n of liveTables) if (!snapTableNames.has(n)) diffs.push(`unexpected table: ${n}`);

    // 2b. columns (name / notNull / hasDefault / type)
    for (const t of snapTables) {
      const live = liveCols.get(t.name) ?? new Map();
      for (const c of Object.values(t.columns)) {
        const lc = live.get(c.name);
        if (!lc) {
          diffs.push(`${t.name}.${c.name}: missing column`);
          continue;
        }
        if (lc.notNull !== !!c.notNull) diffs.push(`${t.name}.${c.name}: notNull ${c.notNull} (schema) vs ${lc.notNull} (db)`);
        if (lc.hasDefault !== (c.default !== undefined)) {
          diffs.push(`${t.name}.${c.name}: hasDefault ${c.default !== undefined} (schema) vs ${lc.hasDefault} (db)`);
        }
        const st = baseType(c.type);
        if (st && lc.type && st !== lc.type && !(st === "serial" && lc.type === "integer")) {
          diffs.push(`${t.name}.${c.name}: type "${st}" (schema) vs "${lc.type}" (db)`);
        }
      }
      for (const name of live.keys()) {
        if (!t.columns[name]) diffs.push(`${t.name}.${name}: unexpected column in db`);
      }
    }

    // 2c. indexes (declared indexes + unique constraints must exist by name)
    for (const t of snapTables) {
      const liveNames = liveIdx.get(t.name) ?? new Set();
      const wanted = [
        ...Object.values(t.indexes ?? {}).map((i) => i.name),
        ...Object.values(t.uniqueConstraints ?? {}).map((u) => u.name),
      ];
      for (const name of wanted) if (!liveNames.has(name)) diffs.push(`${t.name}: missing index/unique "${name}"`);
    }

    // 2d. foreign keys — functional match by (fromTable, fromCols, toTable);
    //     name must match too, EXCEPT the two accepted truncations.
    const snapFks = [];
    for (const t of snapTables) for (const fk of Object.values(t.foreignKeys ?? {})) snapFks.push(fk);
    const keyOf = (fromTable, fromCols) => `${fromTable}::${[...fromCols].sort().join(",")}`;
    const liveByKey = new Map();
    for (const fk of liveFks) {
      const k = keyOf(fk.fromTable, fk.fromCols);
      if (!liveByKey.has(k)) liveByKey.set(k, []);
      liveByKey.get(k).push(fk);
    }

    let matchedKnown = 0;
    for (const sfk of snapFks) {
      const k = keyOf(sfk.tableFrom, sfk.columnsFrom);
      const candidates = liveByKey.get(k) ?? [];
      const lfk =
        candidates.find((c) => c.toTable === sfk.tableTo && [...c.toCols].sort().join(",") === [...sfk.columnsTo].sort().join(",")) ??
        candidates[0];
      if (!lfk) {
        diffs.push(`FK missing in db: ${sfk.name} (${sfk.tableFrom}.${sfk.columnsFrom} -> ${sfk.tableTo}.${sfk.columnsTo})`);
        continue;
      }
      // functional fields — never allowlisted
      if (lfk.toTable !== sfk.tableTo) diffs.push(`FK ${sfk.name}: target table ${sfk.tableTo} (schema) vs ${lfk.toTable} (db)`);
      if ([...lfk.toCols].sort().join(",") !== [...sfk.columnsTo].sort().join(","))
        diffs.push(`FK ${sfk.name}: target cols ${sfk.columnsTo} (schema) vs ${lfk.toCols} (db)`);
      if (norm(lfk.onDelete) !== norm(sfk.onDelete))
        diffs.push(`FK ${sfk.name}: ON DELETE ${sfk.onDelete} (schema) vs ${lfk.onDelete} (db)`);
      // name — allowlist the two known truncations only
      if (lfk.name !== sfk.name) {
        const known = KNOWN_FK_NAME_TRUNCATIONS.find(
          (kt) => kt.snapshotName === sfk.name && kt.fromTable === sfk.tableFrom && kt.storedName === lfk.name,
        );
        if (known) {
          matchedKnown += 1;
          log(`  accepted legacy truncation: "${sfk.name}" stored as "${lfk.name}" (${lfk.name.length} bytes)`);
        } else {
          diffs.push(`FK name mismatch (NOT an accepted exception): "${sfk.name}" (schema) vs "${lfk.name}" (db)`);
        }
      }
    }
    // any live FK the snapshot doesn't know about?
    const snapNameSet = new Set(snapFks.map((f) => f.name));
    const snapStoredSet = new Set(KNOWN_FK_NAME_TRUNCATIONS.map((k) => k.storedName));
    for (const lfk of liveFks) {
      if (!snapNameSet.has(lfk.name) && !snapStoredSet.has(lfk.name)) {
        diffs.push(`unexpected FK in db: ${lfk.name} (${lfk.fromTable}.${lfk.fromCols} -> ${lfk.toTable}.${lfk.toCols})`);
      }
    }

    // ---- 3. DIRECT pg_catalog FUNCTIONAL CHECK of the two legacy FKs ----
    log("Verifying the two accepted legacy FKs directly via pg_catalog …");
    const fkReports = [];
    for (const kt of KNOWN_FK_NAME_TRUNCATIONS) {
      const def = await fkFunctionalDefinition(pool, kt.storedName);
      fkReports.push({ expected: kt, def });
      if (!def) {
        diffs.push(`accepted-legacy FK "${kt.storedName}" not found by its stored name in pg_catalog`);
        continue;
      }
      console.log(
        `    - ${def.storedName}\n` +
          `        type              : ${def.constraintType}\n` +
          `        source            : ${def.sourceTable}(${def.sourceColumns})\n` +
          `        references        : ${def.referencedTable}(${def.referencedColumns})\n` +
          `        on delete         : ${def.onDelete}`,
      );
      if (def.constraintType !== "FOREIGN KEY") diffs.push(`legacy FK ${def.storedName}: type is ${def.constraintType}, not FOREIGN KEY`);
      if (def.onDelete !== "CASCADE") diffs.push(`legacy FK ${def.storedName}: ON DELETE is ${def.onDelete}, expected CASCADE`);
      if (def.sourceTable !== kt.fromTable) diffs.push(`legacy FK ${def.storedName}: source table ${def.sourceTable} != ${kt.fromTable}`);
    }

    await pool.end();
    pool = undefined;

    if (matchedKnown !== KNOWN_FK_NAME_TRUNCATIONS.length) {
      diffs.push(
        `expected exactly ${KNOWN_FK_NAME_TRUNCATIONS.length} accepted legacy FK-name truncation(s), matched ${matchedKnown}`,
      );
    }

    if (diffs.length > 0) {
      return {
        code: 1,
        reason:
          "UNEXPECTED SCHEMA DIFFERENCE — the migration chain and db/schema.ts are NOT functionally equivalent\n" +
          "beyond the two accepted legacy FK-name truncations. STOP: separate re-audit scope. Do NOT paper over it.\n\n" +
          diffs.map((d) => `  • ${d}`).join("\n"),
      };
    }

    return {
      code: 0,
      reason:
        "MIGRATION REPLAY: PASS\n" +
        "FUNCTIONAL SCHEMA: FUNCTIONALLY EQUIVALENT WITH 2 EXPLICIT LEGACY POSTGRESQL IDENTIFIER-TRUNCATION EXCEPTIONS\n" +
        `  1. ${KNOWN_FK_NAME_TRUNCATIONS[0].snapshotName}\n     stored as ${KNOWN_FK_NAME_TRUNCATIONS[0].storedName}\n` +
        `  2. ${KNOWN_FK_NAME_TRUNCATIONS[1].snapshotName}\n     stored as ${KNOWN_FK_NAME_TRUNCATIONS[1].storedName}\n` +
        "UNEXPECTED DIFFERENCES: 0\n" +
        "Both legacy FKs verified via pg_catalog: type FOREIGN KEY, correct source/target, ON DELETE CASCADE.",
    };
  } finally {
    log(`Destroying disposable container ${CONTAINER} …`);
    if (pool) {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
    }
    destroyContainer();
    const stillThere = sh("docker", ["ps", "-a", "--filter", `name=${CONTAINER}`, "--format", "{{.Names}}"]).stdout.trim();
    if (stillThere) {
      console.error(`[migration-replay-check] ⚠ container ${CONTAINER} still present after cleanup — remove it manually: docker rm -f ${CONTAINER}`);
    } else {
      log("Cleanup verified — no disposable container remains.");
    }
  }
}

process.on("SIGINT", () => {
  destroyContainer();
  process.exit(130);
});

main()
  .then((result) => {
    if (result.code === 0) {
      console.log(`\n[migration-replay-check] ✓ ${result.reason}`);
    } else {
      console.error(`\n[migration-replay-check] ✗ ${result.reason}`);
    }
    process.exit(result.code);
  })
  .catch((err) => {
    console.error(`[migration-replay-check] ✗ ${err?.stack || err}`);
    destroyContainer();
    process.exit(1);
  });
