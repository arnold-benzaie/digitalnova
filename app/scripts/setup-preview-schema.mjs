#!/usr/bin/env node
/**
 * Preview-schema setup for PUBLIC-MAP (main app) — see the 2026-07
 * conversation that designed this. Builds a `preview` schema inside the
 * SAME `public-map` Supabase project (not a third project, not the
 * production `public` schema), so a Vercel Preview build of this app can
 * have its own DATABASE_URL without ever touching real production data.
 *
 * Implemented in explicit, separately-approved phases:
 *
 *   Phase 1 (done) — VALIDATION ONLY (preview-schema-migration-validator.mjs).
 *   Phase 2 (done) — in-memory transformation (preview-schema-migration-transformer.mjs).
 *   Phase 3 (this file, today) — the apply engine (preview-schema-execution-engine.mjs),
 *     run here in DRY-RUN ONLY — no client is ever constructed or passed,
 *     so no database connection is opened, no schema is created, no SQL
 *     is executed. Prints the full statement plan for inspection.
 *   Phase 4 (not yet implemented) — construct a real `pg` client against
 *     the target Supabase project, call this exact same engine for real,
 *     seed one test membership row, configure the Vercel Preview env var.
 *
 * Usage: npx tsx scripts/setup-preview-schema.mjs   (or: npm run preview-schema:setup)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPreviewSchemaMigrations } from "./preview-schema-execution-engine.mjs";

const MIGRATIONS_DIR = join("db", "migrations");
const TARGET_SCHEMA = "preview";

function loadMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

const files = loadMigrationFiles();

console.log("─".repeat(60));
console.log("PUBLIC-MAP — Preview schema setup — Phase 1+2+3 (dry-run uniquement)");
console.log("─".repeat(60));
console.log(`Aucune base de données touchée. Aucun fichier écrit. Aucun schéma créé. Aucune connexion ouverte.`);
console.log(`${files.length} fichier(s) de migration trouvé(s) dans ${MIGRATIONS_DIR}/\n`);

try {
  // dryRun: true, et aucun `client` fourni — le moteur ne peut connecter
  // nulle part même s'il le voulait, voir preview-schema-execution-engine.mjs.
  const result = await applyPreviewSchemaMigrations({ files, targetSchema: TARGET_SCHEMA, dryRun: true });

  console.log(`Plan (dry-run) — ${result.statementCount} instruction(s) qui seraient exécutées, dans l'ordre :`);
  for (const { file, sql } of result.statements) {
    const preview = sql.length > 100 ? sql.slice(0, 100) + "…" : sql;
    console.log(`  [${file}] ${preview}`);
  }

  console.log(`\nOK — plan validé, transformé et vérifié (0 mention de "public" dans les ${result.statementCount} instructions).`);
  console.log(`Rien n'a été exécuté. dryRun=${result.dryRun}, applied=${result.applied}.`);
  console.log(`Phase 4 (exécution réelle) pas encore implémentée — nécessite une autorisation explicite séparée.`);
  process.exit(0);
} catch (err) {
  console.error(`\nÉCHEC — ${err instanceof Error ? err.message : err}`);
  console.error("Arrêt avant toute exécution — aucune base de données n'a été touchée.");
  process.exit(1);
}
