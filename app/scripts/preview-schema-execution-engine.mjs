/**
 * Phase 3 of the Preview-schema setup (see the 2026-07 conversation that
 * designed this) — the apply pipeline: validate -> transform -> re-verify
 * -> execute inside a single transaction.
 *
 * This module NEVER constructs its own database connection and does not
 * import `pg` or any driver. `applyPreviewSchemaMigrations()` takes a
 * `client` as an explicit parameter — any object with an async
 * `query(sql, params?)` method (the shape node-postgres's Client/
 * PoolClient already have). The real connection is the CALLER's
 * responsibility, not implemented until Phase 4. This is what makes the
 * engine fully testable with an in-memory fake client and zero real
 * database, in this phase.
 *
 * Guards, in the order they run:
 *   1. Target schema name refused outright if it's "public" or another
 *      reserved/system schema — the one mistake that would be
 *      catastrophic (silently operating on the real production schema).
 *   2. Every file re-validated (Phase 1) and transformed (Phase 2) —
 *      throws loudly on the first file with an unrecognized SQL form.
 *   3. Independent re-check that zero "public" mentions remain in the
 *      transformed SQL — defense in depth, doesn't trust Phase 2 blindly.
 *   4. (real runs only) Refuses to proceed if the target schema already
 *      has tables in it, unless explicitly told to proceed anyway — never
 *      silently re-applies on top of an existing preview schema.
 *   5. Immediately after CREATE SCHEMA, `SET LOCAL search_path TO
 *      "<targetSchema>"` — every unqualified CREATE TABLE / CREATE INDEX /
 *      ALTER TABLE in the migrations (only the FK REFERENCES clauses are
 *      schema-qualified by Phase 2) resolves against this, not whatever
 *      the connection's own default happens to be. `LOCAL`, not a plain
 *      `SET`: PostgreSQL scopes a LOCAL setting to the current
 *      transaction only and reverts it automatically on either COMMIT or
 *      ROLLBACK — see https://www.postgresql.org/docs/current/sql-set.html
 *      ("SET LOCAL... value is effective for only the current
 *      transaction... automatically undone when the transaction ends").
 *      That reversion is PostgreSQL's own guarantee, not this engine's
 *      code — nothing here needs to (or could) implement it.
 *   6. Everything after CREATE SCHEMA runs inside one BEGIN/COMMIT — any
 *      failure rolls back the whole batch, never a half-applied schema.
 */

import { validateAndTransformAll } from "./preview-schema-migration-transformer.mjs";

const FORBIDDEN_SCHEMA_NAMES = new Set(["public", "pg_catalog", "information_schema", "pg_toast", "pg_temp"]);

export class ExecutionEngineError extends Error {}

function assertSchemaNameAllowed(targetSchema) {
  if (!targetSchema || FORBIDDEN_SCHEMA_NAMES.has(targetSchema.toLowerCase())) {
    throw new ExecutionEngineError(
      `Schéma cible refusé : "${targetSchema}" — ce moteur n'opère jamais sur un schéma réservé ou de production.`,
    );
  }
}

/** Splits a migration file's SQL on Drizzle's own statement separator, dropping empty fragments. */
function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildStatementPlan(files, targetSchema) {
  // validateAndTransformAll already runs Phase 1's validator per file before
  // transforming — no need to call it separately here.
  const transformed = validateAndTransformAll(files, targetSchema);

  for (const { name, sql } of transformed) {
    const remaining = (sql.match(/public/gi) ?? []).length;
    if (remaining !== 0) {
      throw new ExecutionEngineError(
        `${name} : ${remaining} mention(s) de "public" subsistent après transformation — erreur interne, arrêt avant toute exécution.`,
      );
    }
  }

  const statements = [
    { file: "(schema)", sql: `CREATE SCHEMA IF NOT EXISTS "${targetSchema}"` },
    // Transaction-scoped on purpose (see the module docstring) — every
    // unqualified statement below must resolve here, never the
    // connection's own default schema.
    { file: "(schema)", sql: `SET LOCAL search_path TO "${targetSchema}"` },
  ];
  for (const { name, sql } of transformed) {
    for (const stmt of splitStatements(sql)) {
      statements.push({ file: name, sql: stmt });
    }
  }
  return statements;
}

/**
 * @param {{ files: {name: string, sql: string}[], targetSchema: string, client?: {query: Function}, dryRun?: boolean, allowExisting?: boolean }} opts
 */
export async function applyPreviewSchemaMigrations({ files, targetSchema, client, dryRun = false, allowExisting = false }) {
  assertSchemaNameAllowed(targetSchema);

  const statements = buildStatementPlan(files, targetSchema);

  if (dryRun) {
    return { dryRun: true, applied: false, statementCount: statements.length, statements };
  }

  if (!client || typeof client.query !== "function") {
    throw new ExecutionEngineError("Aucun client de base de données valide fourni — ce moteur n'en construit jamais un lui-même.");
  }

  const { rows } = await client.query(
    `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1`,
    [targetSchema],
  );
  const existingTableCount = rows?.[0]?.count ?? 0;
  if (existingTableCount > 0 && !allowExisting) {
    throw new ExecutionEngineError(
      `Le schéma "${targetSchema}" contient déjà ${existingTableCount} table(s) — arrêt pour éviter une double application. ` +
        `Passer allowExisting: true pour forcer une nouvelle application.`,
    );
  }

  await client.query("BEGIN");
  try {
    for (const { sql } of statements) {
      await client.query(sql);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }

  return { dryRun: false, applied: true, statementCount: statements.length, statements };
}
