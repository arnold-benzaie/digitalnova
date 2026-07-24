/**
 * Safety net against ever running the Audit app (or its migrations)
 * against the MAIN PUBLIC-MAP Supabase project. Two independent checks:
 *
 * 1. Known signature — the main project's ref, as it appears in the
 *    `postgres.<ref>` pooler username in DATABASE_URL today. This is an
 *    identifier, not a secret (the password portion is never read or
 *    compared here), so it's safe to keep this literal in source. If the
 *    main project is ever migrated to a different ref, update
 *    MAIN_PRODUCTION_SIGNATURES accordingly.
 *    Deliberately NOT matched on the pooler hostname (e.g.
 *    "aws-0-eu-west-3.pooler.supabase.com") — that host is shared by every
 *    Supabase project in the same region, so matching on it would flag any
 *    other project's pooler connection (including the Audit app's own, if
 *    hosted in the same region) as if it were the main project.
 * 2. Exact match against the CURRENT value of process.env.DATABASE_URL —
 *    catches the case where AUDIT_DATABASE_URL was accidentally set to a
 *    copy-paste of DATABASE_URL, even if the main project's signature
 *    below ever goes stale.
 */

const MAIN_PRODUCTION_SIGNATURES = [
  // Project ref, as it appears in the `postgres.<ref>` pooler username.
  "zmndhiujxfxncebezxhb",
];

export class MainProductionDatabaseGuardError extends Error {}

export function looksLikeMainProduction(connectionString: string): boolean {
  return MAIN_PRODUCTION_SIGNATURES.some((sig) => connectionString.includes(sig));
}

/**
 * Throws MainProductionDatabaseGuardError if `connectionString` appears to
 * point at the main PUBLIC-MAP production database. `envVarName` is only
 * used to make the error message actionable (which env var to go fix).
 */
export function assertNotMainProductionDatabase(connectionString: string, envVarName: string): void {
  if (looksLikeMainProduction(connectionString)) {
    throw new MainProductionDatabaseGuardError(
      `${envVarName} points at the MAIN PUBLIC-MAP production database. ` +
        "The Audit app must use its own, separate Supabase project — see db/audit-schema.ts and .env.example. " +
        "This connection was refused before anything was read or written.",
    );
  }

  if (process.env.DATABASE_URL && connectionString === process.env.DATABASE_URL) {
    throw new MainProductionDatabaseGuardError(
      `${envVarName} is set to the exact same value as DATABASE_URL (the main app's database). ` +
        "These must be two different Supabase projects — check .env.local for a copy-paste mistake.",
    );
  }
}
