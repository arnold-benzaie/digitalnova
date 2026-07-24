#!/usr/bin/env node
/**
 * PUBLIC-MAP — Preview schema Preflight (see the 2026-07 conversation).
 *
 * Read-only, display-only. Opens NO PostgreSQL connection, sends NO SQL.
 * The connection string (PREVIEW_SCHEMA_DATABASE_URL) is only ever parsed
 * as a URL string for display — never handed to a `pg` Client/Pool, which
 * this file does not import.
 *
 * Usage: npx tsx scripts/preview-schema-preflight-report.mjs
 *   (or: npm run preview-schema:preflight)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { buildPreflightReport, formatPreflightReport } from "./preview-schema-preflight.mjs";

config({ path: ".env.local" });

const MIGRATIONS_DIR = join("db", "migrations");
const TARGET_SCHEMA = "preview";
const CONNECTION_ENV_VAR = "PREVIEW_SCHEMA_DATABASE_URL";

function loadMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

try {
  const files = loadMigrationFiles();
  const report = await buildPreflightReport({
    files,
    targetSchema: TARGET_SCHEMA,
    connectionString: process.env[CONNECTION_ENV_VAR],
    connectionEnvVarName: CONNECTION_ENV_VAR,
  });
  console.log(formatPreflightReport(report));
  console.log("\nPhase 4 (exécution réelle) reste non autorisée tant que ce rapport n'a pas été validé explicitement.");
  process.exit(0);
} catch (err) {
  console.error(`\nÉCHEC DU PREFLIGHT — ${err instanceof Error ? err.message : err}`);
  console.error("Arrêt avant toute exécution — aucune base de données n'a été touchée.");
  process.exit(1);
}
