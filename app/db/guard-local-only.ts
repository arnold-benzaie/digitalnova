/**
 * Safety net for the LOCAL-ONLY Drizzle tooling (drizzle.local.config.ts,
 * scripts/db-push-local.mjs) — refuses to resolve a database URL that
 * isn't the developer's own local Postgres instance, before any command
 * that could generate, diff, or apply schema changes ever runs.
 *
 * This is deliberately an ALLOWLIST, not a denylist: PUBLIC-MAP — DATABASE
 * TOOLING SAFETY / PHASE S1 explicitly rejected the
 * `/supabase|neon|pooler/i` denylist pattern (already used ad hoc in every
 * *.integration.test.mjs file) for this purpose, because a denylist only
 * blocks hosts it was told to name — a new provider, or a differently
 * formatted pooler hostname, would silently slip through. An allowlist of
 * exactly `localhost`/`127.0.0.1` is closed by construction: anything not
 * explicitly local is refused, with no way for an unanticipated remote
 * host to pass.
 *
 * Unrelated to db/guard-main-production.ts on purpose: that guard answers
 * a narrower question ("is this specifically the known main-production
 * project, or an exact copy of DATABASE_URL?") for the Audit database's
 * own config. This guard answers a broader one ("is this local at all?")
 * for the main schema's local-only tooling — copying the production-ref
 * signature-matching logic here would not serve that purpose.
 *
 * IPv6 loopback (`::1`) is deliberately NOT on the allowlist. Every local
 * Postgres instance already used across this repo's own local-only
 * tooling and integration tests connects via `127.0.0.1`/`localhost`
 * exclusively — `::1` was never an established convention here, so it is
 * treated the same as any other unrecognized host rather than silently
 * added to the allowlist without a precedent to justify it.
 */

export class LocalOnlyDatabaseGuardError extends Error {}

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/**
 * Throws LocalOnlyDatabaseGuardError unless `connectionString` is a
 * well-formed Postgres URL whose hostname is exactly `localhost` or
 * `127.0.0.1`. `envVarName` is only used to make the error message
 * actionable (which env var to go fix). Never logs or includes the
 * connection string (which may carry credentials) in any thrown message.
 */
export function assertLocalOnlyDatabase(connectionString: string | undefined, envVarName: string): void {
  if (!connectionString || connectionString.trim() === "") {
    throw new LocalOnlyDatabaseGuardError(
      `${envVarName} is not set. This command only ever runs against a local disposable Postgres instance — ` +
        `see .env.example for the expected local-only value. There is no fallback to DATABASE_URL.`,
    );
  }

  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    throw new LocalOnlyDatabaseGuardError(`${envVarName} is not a valid connection URL. Refused before it was read any further.`);
  }

  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    throw new LocalOnlyDatabaseGuardError(
      `${envVarName} does not resolve to a local database (allowed hosts: localhost, 127.0.0.1). ` +
        "This command refuses to run against any remote host — Supabase, Neon, a pooler, or anything else. " +
        "Refused before any connection was attempted.",
    );
  }
}
