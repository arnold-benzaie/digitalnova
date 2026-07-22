/**
 * Phase 2 of the Preview-schema setup (see the 2026-07 conversation that
 * designed this) — rewrites a migration's foreign key references from the
 * real `public` schema to the isolated `preview` schema, entirely in
 * memory. Nothing here ever touches disk or a database connection; the
 * transformed SQL exists only as a JS string for the lifetime of the
 * caller's process.
 *
 * Callers MUST validate a file with validatePublicSchemaReferences() (see
 * preview-schema-migration-validator.mjs) before transforming it —
 * validateAndTransform() below does this for you and refuses to transform
 * anything that hasn't passed. Transforming an unvalidated file would
 * defeat the whole point: silently leaving an unrecognized schema
 * reference untouched.
 */
import { validatePublicSchemaReferences } from "./preview-schema-migration-validator.mjs";

const VALID_SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Only the exact pattern already proven safe by the validator is rewritten
 * — REFERENCES "public"."table" becomes REFERENCES "<targetSchema>"."table".
 * Everything else in the file (CREATE TABLE, indexes, column definitions,
 * the --> statement-breakpoint markers) passes through byte-for-byte.
 */
export function transformMigrationToSchema(sql, targetSchema) {
  if (!VALID_SCHEMA_NAME.test(targetSchema)) {
    throw new Error(`Nom de schéma cible invalide : "${targetSchema}" — attendu un identifiant Postgres simple (lettres minuscules/chiffres/underscore).`);
  }
  return sql.replaceAll('REFERENCES "public".', `REFERENCES "${targetSchema}".`);
}

/** Validates, then transforms — refuses to transform a file that hasn't been proven safe first. */
export function validateAndTransform(file, targetSchema) {
  validatePublicSchemaReferences(file.sql, file.name);
  return { name: file.name, sql: transformMigrationToSchema(file.sql, targetSchema) };
}

export function validateAndTransformAll(files, targetSchema) {
  return files.map((file) => validateAndTransform(file, targetSchema));
}
