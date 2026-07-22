/**
 * Preflight report for Phase 4 (see the 2026-07 conversation that designed
 * this) — READ-ONLY, DISPLAY-ONLY. Gives an operator everything needed to
 * review a migration run before it happens, but on its own:
 *
 *   - never opens a real PostgreSQL connection: the connection string is
 *     only ever parsed as a plain URL (`new URL(...)`), never handed to a
 *     `pg` Client/Pool — this file imports no driver at all;
 *   - never calls applyPreviewSchemaMigrations() with a `client` — always
 *     `dryRun: true`, so the same zero-connection guarantee proven in
 *     Phase 3 applies here too;
 *   - never sends a single SQL statement anywhere.
 *
 * Because no connection is opened, guards #4-#6 of the execution engine
 * (existing-table count, SET LOCAL search_path, the BEGIN/COMMIT/ROLLBACK
 * transaction) CANNOT be exercised for real here — they are only described,
 * clearly labeled as "will run", not "did run". Guards #1-#3 DO run for
 * real as part of building the dry-run plan, so they're reported as
 * already verified. Phase 4 itself (the first real execution) is a
 * separate, not-yet-implemented, separately-authorized script.
 */

import { applyPreviewSchemaMigrations } from "./preview-schema-execution-engine.mjs";

const REDACTED = "•••• (masqué — jamais affiché)";

/** Parses a Postgres connection string into a display-safe summary. Never opens a socket. */
export function describeDatabaseTarget(connectionString) {
  if (!connectionString) {
    return { configured: false };
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Chaîne de connexion invalide — impossible de l'analyser comme une URL Postgres (attendu: postgresql://user:password@host:port/dbname).");
  }
  return {
    configured: true,
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, ""),
    user: url.username || null,
    password: REDACTED,
  };
}

const CHECKS_ALREADY_RUN = [
  'Guard #1 — le schéma cible a été refusé s\'il s\'agissait de "public" ou d\'un autre schéma système réservé (pg_catalog, information_schema, pg_toast, pg_temp).',
  "Guard #2 — chaque fichier de migration a été re-validé (Phase 1) puis retransformé (Phase 2) ; l'exécution se serait arrêtée net sur la première forme SQL non reconnue.",
  'Guard #3 — vérification indépendante que zéro mention de "public" ne subsiste dans les instructions transformées.',
];

const CHECKS_PENDING_REAL_EXECUTION = [
  "Guard #4 — comptage des tables déjà présentes dans le schéma cible ; arrêt si le schéma n'est pas vide, sauf allowExisting explicite. Nécessite une vraie connexion, donc PAS encore exécuté.",
  'Guard #5 — juste après CREATE SCHEMA, SET LOCAL search_path TO "<schéma>" à l\'intérieur de la transaction, avant toute instruction non qualifiée. Nécessite une vraie connexion, donc PAS encore exécuté.',
  "Guard #6 — l'ensemble des instructions s'exécute dans une unique transaction BEGIN…COMMIT, avec ROLLBACK automatique à la moindre erreur. Nécessite une vraie connexion, donc PAS encore exécuté.",
];

/**
 * @param {{ files: {name: string, sql: string}[], targetSchema: string, connectionString?: string, connectionEnvVarName: string }} opts
 */
export async function buildPreflightReport({ files, targetSchema, connectionString, connectionEnvVarName }) {
  const database = describeDatabaseTarget(connectionString);
  // dryRun: true, no `client` passed — identical zero-connection guarantee as Phase 3.
  const plan = await applyPreviewSchemaMigrations({ files, targetSchema, dryRun: true });

  return {
    connectionEnvVarName,
    database,
    targetSchema,
    migrationFiles: files.map((f) => f.name),
    statements: plan.statements,
    statementCount: plan.statementCount,
    checksAlreadyRun: CHECKS_ALREADY_RUN,
    checksPendingRealExecution: CHECKS_PENDING_REAL_EXECUTION,
  };
}

function formatDatabaseLine(database, envVarName) {
  if (!database.configured) {
    return `  (non configuré — ${envVarName} n'est pas défini localement)`;
  }
  return [
    `  Variable d'environnement : ${envVarName}`,
    `  Hôte                     : ${database.host}`,
    `  Port                     : ${database.port}`,
    `  Base de données          : ${database.database}`,
    `  Utilisateur              : ${database.user ?? "(non précisé dans l'URL)"}`,
    `  Mot de passe             : ${database.password}`,
    `  Note : ce projet Supabase est le MÊME que celui de DATABASE_URL (production) —`,
    `         l'isolation ne vient pas d'un projet séparé mais du schéma ci-dessous.`,
  ].join("\n");
}

export function formatPreflightReport(report) {
  const lines = [];
  lines.push("─".repeat(70));
  lines.push("PREFLIGHT — préparation Phase 4 (aucune commande SQL n'est envoyée par ce rapport)");
  lines.push("─".repeat(70));

  lines.push("\n1. Base PostgreSQL ciblée :");
  lines.push(formatDatabaseLine(report.database, report.connectionEnvVarName));

  lines.push(`\n2. Schéma cible : "${report.targetSchema}"`);

  lines.push(`\n3. Migrations qui seraient appliquées (${report.migrationFiles.length}) :`);
  for (const name of report.migrationFiles) {
    lines.push(`  - ${name}`);
  }

  lines.push(`\n4. Instructions SQL finales, dans leur ordre exact (${report.statementCount}) :`);
  report.statements.forEach((s, i) => {
    const preview = s.sql.length > 100 ? s.sql.slice(0, 100) + "…" : s.sql;
    lines.push(`  [${i + 1}/${report.statementCount}] [${s.file}] ${preview}`);
  });

  lines.push("\n5. Vérifications de sécurité déjà effectuées (par ce rapport, sans connexion) :");
  for (const check of report.checksAlreadyRun) {
    lines.push(`  ✓ ${check}`);
  }
  lines.push("\n   Vérifications prévues juste avant l'exécution réelle (Phase 4, pas encore lancées) :");
  for (const check of report.checksPendingRealExecution) {
    lines.push(`  ○ ${check}`);
  }

  lines.push("\n" + "─".repeat(70));
  lines.push("CONFIRMATION : aucune commande SQL n'a été envoyée au serveur. Aucune connexion PostgreSQL n'a été ouverte. Aucune transaction n'a été démarrée.");
  lines.push("─".repeat(70));

  return lines.join("\n");
}
