#!/usr/bin/env node
/**
 * Phase 4 (see the 2026-07 conversation) — the first and only script in
 * this feature that opens a real PostgreSQL connection and executes SQL.
 * Every guard from Phases 1-3 (preview-schema-execution-engine.mjs) and the
 * Preflight report applies unchanged here; this file only adds the actual
 * connection, plus a before/after "public" table-count check as empirical
 * proof that the public schema was never touched.
 *
 * Usage: npx tsx scripts/preview-schema-execute-phase4.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { applyPreviewSchemaMigrations } from "./preview-schema-execution-engine.mjs";

config({ path: ".env.local" });

const TARGET_SCHEMA = "preview";
const CONNECTION_ENV_VAR = "PREVIEW_SCHEMA_DATABASE_URL";
// public-map (production) — NOT public-map-audit. See the 2026-07 review.
const EXPECTED_PROJECT_REF = "zmndhiujxfxncebezxhb";

const connectionString = process.env[CONNECTION_ENV_VAR];
if (!connectionString) {
  console.error(`ÉCHEC — ${CONNECTION_ENV_VAR} n'est pas défini. Arrêt avant toute connexion.`);
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(connectionString);
} catch {
  console.error("ÉCHEC — chaîne de connexion invalide. Arrêt avant toute connexion.");
  process.exit(1);
}

const projectRef = parsedUrl.username.replace(/^postgres\./, "");
if (projectRef !== EXPECTED_PROJECT_REF) {
  console.error(
    `ÉCHEC — le projet ciblé ("${projectRef}") ne correspond pas au projet public-map attendu ` +
      `("${EXPECTED_PROJECT_REF}"). Arrêt avant toute connexion.`,
  );
  process.exit(1);
}

const MIGRATIONS_DIR = join("db", "migrations");
const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));

async function countTables(client, schema) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1`,
    [schema],
  );
  return rows[0].count;
}

const client = new pg.Client({ connectionString });
const startedAt = Date.now();
let outcome = "ROLLBACK";
let result = null;
let executionError = null;

try {
  await client.connect();
  const publicTableCountBefore = await countTables(client, "public");

  try {
    result = await applyPreviewSchemaMigrations({ files, targetSchema: TARGET_SCHEMA, client });
    outcome = result.applied ? "COMMIT" : "ROLLBACK";
  } catch (err) {
    executionError = err;
    outcome = "ROLLBACK";
  }

  const publicTableCountAfter = await countTables(client, "public");
  const previewTableCount = await countTables(client, TARGET_SCHEMA);
  const durationMs = Date.now() - startedAt;

  console.log("\n" + "─".repeat(70));
  console.log("PHASE 4 — RAPPORT FINAL");
  console.log("─".repeat(70));
  console.log(`Résultat                         : ${outcome}`);
  console.log(`Instructions du plan exécutées   : ${result ? result.statementCount : 0} / ${result ? result.statementCount : "?"}`);
  console.log(`  (+ 1 vérification préalable du nombre de tables existantes, 1 BEGIN, 1 ${outcome})`);
  console.log(`Tables réellement présentes dans "preview" : ${previewTableCount}`);
  console.log(`Durée d'exécution                : ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`Tables dans "public" avant       : ${publicTableCountBefore}`);
  console.log(`Tables dans "public" après       : ${publicTableCountAfter}`);
  console.log(
    `Schéma "public" modifié ?        : ${publicTableCountBefore === publicTableCountAfter ? "NON" : "OUI — ANOMALIE, à investiguer immédiatement"}`,
  );
  console.log("─".repeat(70));

  if (executionError) {
    console.error("\nErreur ayant déclenché le ROLLBACK :", executionError instanceof Error ? executionError.message : executionError);
  }
} finally {
  await client.end();
}

process.exit(executionError ? 1 : 0);
