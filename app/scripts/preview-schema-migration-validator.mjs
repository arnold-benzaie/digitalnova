/**
 * Phase 1 of the Preview-schema setup (see the 2026-07 conversation that
 * designed this): before any migration SQL is rewritten to target the
 * `preview` schema instead of `public`, every "public" mention in it must
 * be accounted for by the ONE pattern this tool knows how to safely
 * rewrite — a foreign key's `REFERENCES "public"."table"`.
 *
 * Deliberately strict, not a bare find-replace: if a future migration adds
 * any other form of schema-qualified reference (CREATE INDEX ON public.x,
 * a column DEFAULT calling public.some_fn(), an unquoted public.Table,
 * CREATE VIEW/FUNCTION in public, etc.), this throws instead of silently
 * leaving that reference pointed at the real production schema.
 *
 * Deliberately over-eager, on purpose: the "how many times does the
 * substring 'public' appear at all" count is case-insensitive and has no
 * awareness of SQL structure, so a hypothetical future comment containing
 * an unrelated word like "publications" would also trip this check and
 * require a human look. That's an acceptable false positive — the
 * alternative (silently missing a real schema reference) is the one
 * outcome this tool must never produce.
 */

const HANDLED_PATTERN = /REFERENCES "public"\./g;
const ANY_MENTION_PATTERN = /public/gi;

export function validatePublicSchemaReferences(sql, fileLabel) {
  const totalMentions = (sql.match(ANY_MENTION_PATTERN) ?? []).length;
  const handledMentions = (sql.match(HANDLED_PATTERN) ?? []).length;

  if (totalMentions !== handledMentions) {
    throw new Error(
      `${fileLabel} : ${totalMentions} occurrence(s) de "public" détectée(s), seulement ${handledMentions} ` +
        `reconnue(s) comme REFERENCES "public". — forme SQL non gérée (CREATE INDEX / DEFAULT / CREATE VIEW / ` +
        `CREATE FUNCTION / référence non guillemetée / autre). Arrêt avant toute exécution.`,
    );
  }

  return { file: fileLabel, totalMentions, handledMentions };
}

/** @param {{ name: string, sql: string }[]} files */
export function validateAllMigrationFiles(files) {
  return files.map((file) => validatePublicSchemaReferences(file.sql, file.name));
}
