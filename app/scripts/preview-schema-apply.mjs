#!/usr/bin/env node
/**
 * Phase 4 of the Preview-schema setup (see the 2026-07 conversation that
 * designed this) — the first script in this pipeline allowed to open a
 * real PostgreSQL connection and execute real SQL. Phases 1-3
 * (preview-schema-migration-validator.mjs, -transformer.mjs,
 * -execution-engine.mjs) do the actual validation/transformation/apply
 * logic and are reused here UNCHANGED — this file only adds the missing
 * piece their own docstrings named: a real `pg` client, wired behind
 * explicit, hard-to-trigger-by-accident confirmation.
 *
 * Deliberately narrow, on purpose:
 *   - Target schema is ALWAYS "preview" — not a CLI option, not an env
 *     var. The one mistake that would be catastrophic (operating on
 *     "public") is structurally impossible to request through this file.
 *   - Migration files to apply are NEVER auto-discovered — every filename
 *     must be passed explicitly on the command line. There is no "apply
 *     everything under db/migrations/" mode here; `preview` already has
 *     its own migration history that this tool has no record of beyond
 *     what's actually in the database (see the table-existence guard
 *     below), so silently re-globbing the whole migrations/ directory
 *     would replay already-applied SQL.
 *   - Reads PREVIEW_SCHEMA_DATABASE_URL only — never DATABASE_URL, even
 *     though (today) they point at the same Supabase project. Keeping
 *     the variable separate means a future environment where they truly
 *     diverge doesn't require touching this file.
 *   - Always prints the full Phase-4 preflight report (same one
 *     `npm run preview-schema:preflight` prints) before doing anything
 *     else — including in --dry-run mode, and including immediately
 *     before the real run in --execute mode. No path through this file
 *     skips showing the plan first.
 *   - Defaults to --dry-run. --execute additionally requires typing the
 *     literal word APPLY at an interactive prompt (no --yes escape
 *     hatch) — same pattern as scripts/audit-db-migrate.mjs.
 *   - Before executing, independently re-checks (beyond the execution
 *     engine's own "is the target schema completely empty" guard) that
 *     none of the specific tables the given files would CREATE already
 *     exist in `preview` — the engine's own guard only refuses on an
 *     empty-vs-non-empty schema, which `preview` deliberately fails
 *     (Phase 4 is meant to add NEW migrations on top of an already-
 *     populated preview schema) — this extra check is what actually
 *     protects against re-applying a file that was already run.
 *
 * Usage:
 *   npx tsx scripts/preview-schema-apply.mjs 0015_new_diamondback.sql 0016_first_outlaw_kid.sql
 *     → dry-run (default): prints the full preflight report, opens no connection.
 *   npx tsx scripts/preview-schema-apply.mjs 0015_new_diamondback.sql 0016_first_outlaw_kid.sql --execute
 *     → prints the same report, then asks to type APPLY before touching anything for real.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { applyPreviewSchemaMigrations, ExecutionEngineError } from "./preview-schema-execution-engine.mjs";
import { buildPreflightReport, formatPreflightReport } from "./preview-schema-preflight.mjs";

config({ path: ".env.local" });

const MIGRATIONS_DIR = join("db", "migrations");
const TARGET_SCHEMA = "preview";
const CONNECTION_ENV_VAR = "PREVIEW_SCHEMA_DATABASE_URL";

const args = process.argv.slice(2);
const isExecute = args.includes("--execute");
const fileNames = args.filter((a) => !a.startsWith("--"));

if (fileNames.length === 0) {
  console.error("Usage: npx tsx scripts/preview-schema-apply.mjs <fichier1.sql> [fichier2.sql ...] [--execute]");
  console.error('Aucun nom de fichier fourni — refus de deviner "tous les fichiers". Liste-les explicitement.');
  process.exit(1);
}

function loadNamedMigrationFiles(names) {
  return names.map((name) => {
    const path = join(MIGRATIONS_DIR, name);
    let sql;
    try {
      sql = readFileSync(path, "utf8");
    } catch {
      throw new Error(`Fichier introuvable : ${path}`);
    }
    return { name, sql };
  });
}

/** Table names a migration's own CREATE TABLE statements would create — used
 * only for the extra pre-execution existence check, not for anything the
 * execution engine itself relies on. */
function extractCreatedTableNames(sql) {
  const names = [];
  const pattern = /CREATE TABLE\s+"([^"]+)"/gi;
  let match;
  while ((match = pattern.exec(sql))) names.push(match[1]);
  return names;
}

const files = loadNamedMigrationFiles(fileNames);
const connectionString = process.env[CONNECTION_ENV_VAR];

console.log("═".repeat(70));
console.log("PUBLIC-MAP — Preview schema — Phase 4 (première phase pouvant exécuter du SQL réel)");
console.log("═".repeat(70));

if (!connectionString) {
  console.error(`\n✗ ${CONNECTION_ENV_VAR} n'est pas défini. Rien n'a été tenté.`);
  process.exit(1);
}

const report = await buildPreflightReport({
  files,
  targetSchema: TARGET_SCHEMA,
  connectionString,
  connectionEnvVarName: CONNECTION_ENV_VAR,
});
console.log("\n" + formatPreflightReport(report));

if (!isExecute) {
  console.log("\nMode dry-run (défaut) — aucune connexion PostgreSQL ouverte, aucune instruction envoyée.");
  console.log("Relancer avec --execute pour proposer une exécution réelle (confirmation interactive requise).");
  process.exit(0);
}

console.log("\n" + "─".repeat(70));
console.log("--execute demandé — vérifications supplémentaires avant toute connexion réelle...");

const client = new Client({ connectionString });
await client.connect();

try {
  // Extra, file-specific guard (see module docstring) — beyond the engine's
  // own "is the schema entirely empty" check, which `preview` intentionally
  // fails at this stage.
  const candidateTables = files.flatMap((f) => extractCreatedTableNames(f.sql));
  if (candidateTables.length > 0) {
    const { rows } = await client.query(
      `select table_name from information_schema.tables where table_schema = $1 and table_name = any($2::text[])`,
      [TARGET_SCHEMA, candidateTables],
    );
    if (rows.length > 0) {
      console.error(
        `\n✗ REFUS : la (les) table(s) suivante(s) existent DÉJÀ dans "${TARGET_SCHEMA}" — ces migrations semblent déjà appliquées : ` +
          rows.map((r) => r.table_name).join(", "),
      );
      process.exit(1);
    }
    console.log(`✓ Aucune des tables que ces fichiers créeraient (${candidateTables.join(", ")}) n'existe encore dans "${TARGET_SCHEMA}".`);
  }

  console.log(`\nCible : ${CONNECTION_ENV_VAR} → schéma "${TARGET_SCHEMA}" (voir la ligne "Hôte"/"Base de données" du rapport ci-dessus).`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Taper "APPLY" pour exécuter réellement ce plan, toute autre réponse annule : ');
  rl.close();

  if (answer.trim() !== "APPLY") {
    console.log("Annulé — aucune modification effectuée.");
    process.exit(0);
  }

  const result = await applyPreviewSchemaMigrations({
    files,
    targetSchema: TARGET_SCHEMA,
    client,
    dryRun: false,
    allowExisting: true, // preview already holds earlier migrations by design — see module docstring.
  });

  console.log(`\n✓ Appliqué — ${result.statementCount} instruction(s) exécutée(s) dans une seule transaction, COMMIT confirmé.`);
} catch (err) {
  if (err instanceof ExecutionEngineError) {
    console.error(`\n✗ REFUSÉ par le moteur d'exécution : ${err.message}`);
  } else {
    console.error(`\n✗ ÉCHEC pendant l'exécution : ${err instanceof Error ? err.message : err}`);
    console.error("La transaction a été annulée (ROLLBACK) si elle avait démarré — voir preview-schema-execution-engine.mjs.");
  }
  process.exit(1);
} finally {
  await client.end();
}
