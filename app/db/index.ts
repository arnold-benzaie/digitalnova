import { isIP } from "node:net";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";
import { SUPABASE_ROOT_CA_2021_PEM } from "./supabase-root-ca";

/**
 * PREVIEW_SCHEMA_DATABASE_URL was originally built for the preview-schema
 * pre-merge validation tooling (scripts/preview-schema-*.mjs) — a separate
 * Postgres *schema* sandbox, not a runtime connection. This is its second,
 * deliberately narrow use: letting one specific Vercel Preview branch
 * (via a branch-scoped env var, never Production, never the shared
 * Preview default) opt into that same schema for a real deployment,
 * without touching the DATABASE_URL every other Preview branch and
 * Production already depend on.
 *
 * Deliberately checks VERCEL_ENV === "preview" (Vercel's own injected
 * value, same convention as lib/system-alerts.ts/lib/chat/technical-alert.ts)
 * rather than just "is PREVIEW_SCHEMA_DATABASE_URL set" — this is what
 * keeps Production immune even in the hypothetical case that var were
 * ever accidentally set there too. Every non-Preview case (Production,
 * local dev, tests that set DATABASE_URL directly) resolves to the exact
 * same DATABASE_URL behavior as before.
 *
 * 4F.14-O — Preview fails closed instead: the `preview` schema lives in the
 * production Supabase project and Drizzle's tables are unqualified, so the
 * connection's search_path alone decides which schema every query hits. On
 * VERCEL_ENV === "preview" this refuses to start (throws at module load)
 * unless PREVIEW_SCHEMA_DATABASE_URL is set AND pins search_path to exactly
 * `preview` — never a silent fallback to DATABASE_URL. This only constrains
 * the search_path: it does NOT make the role's privileges safe (a role that
 * can read `public` still can, via qualified names) — that needs a dedicated
 * least-privilege role, which does not exist yet.
 *
 * 4F.14-X — Preview also requires verified TLS to the Supabase pooler:
 * resolveDatabaseSsl() passes the pinned Supabase Root 2021 CA as `ssl.ca`
 * with rejectUnauthorized: true (Node then also checks the DNS host name).
 * pg-connection-string turns EVERY URL query parameter into a client option
 * that overrides the config object (sslmode/sslrootcert replace `ssl`
 * wholesale; ?host= / ?port= / ?user= replace the URL's own), and pg falls
 * back to PGSSLMODE only without an explicit `ssl` — so on Preview the URL may
 * carry no parameter except `options`, its host must be a DNS name (pg skips
 * TLS SNI for an IP, which defeats the host-name check), and PGOPTIONS /
 * PGSSLMODE / PGSSLROOTCERT must be unset. Production and local dev are
 * unchanged at this step (no `ssl` passed, exactly as before).
 */
export class PreviewDatabaseIsolationError extends Error {}

/** The only query parameter a Preview database URL may carry. */
export const PREVIEW_ALLOWED_URL_PARAMS: ReadonlySet<string> = new Set(["options"]);

/** Environment variables pg would read that could change the search_path or TLS behaviour. */
export const PREVIEW_FORBIDDEN_ENV = ["PGOPTIONS", "PGSSLMODE", "PGSSLROOTCERT"] as const;

/** The only accepted `options` value — pg sends it as the startup parameter. */
export const PREVIEW_ISOLATION_OPTIONS = "-c search_path=preview";

/**
 * Throws PreviewDatabaseIsolationError unless `connectionString` pins
 * search_path to exactly `preview`. Never includes the URL in the message.
 * node-postgres parses the query string with WHATWG URLSearchParams (last
 * duplicate wins) and lets URL parameters override its config object, and it
 * falls back to PGOPTIONS only when the URL has no `options` — so: exactly one
 * `options`, equal to PREVIEW_ISOLATION_OPTIONS, and no PGOPTIONS at all.
 */
export function assertPreviewDatabaseIsolation(connectionString: string, env: NodeJS.ProcessEnv = process.env): void {
  const fail = (reason: string): never => {
    throw new PreviewDatabaseIsolationError(`Preview database isolation refused: ${reason}. The app will not start on Preview.`);
  };
  if (env.PGOPTIONS !== undefined) fail("PGOPTIONS is set and could change the search_path");
  for (const name of PREVIEW_FORBIDDEN_ENV) {
    if (env[name] !== undefined) fail(`${name} is set and could change the search_path or TLS behaviour`);
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return fail("PREVIEW_SCHEMA_DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") fail("the URL must use the postgresql:// scheme");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) fail("the URL has no host");
  if (isIP(host) !== 0) fail("the URL host must be a DNS name, not an IP address (TLS host-name verification)");
  const unexpected = [...new Set(url.searchParams.keys())].filter((key) => !PREVIEW_ALLOWED_URL_PARAMS.has(key));
  if (unexpected.length > 0) fail(`unsupported URL parameter(s) ${unexpected.join(", ")} — only "options" is allowed (TLS is configured in code)`);
  const options = url.searchParams.getAll("options");
  if (options.length === 0) fail('the URL has no "options" parameter pinning search_path=preview');
  if (options.length > 1) fail('the URL has more than one "options" parameter');
  if (options[0] !== PREVIEW_ISOLATION_OPTIONS) fail(`"options" must be exactly "${PREVIEW_ISOLATION_OPTIONS}"`);
}

export function resolveDatabaseUrl(): string | undefined {
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  if (isVercelPreview) {
    const previewUrl = process.env.PREVIEW_SCHEMA_DATABASE_URL;
    if (!previewUrl) {
      throw new PreviewDatabaseIsolationError(
        "Preview database isolation refused: PREVIEW_SCHEMA_DATABASE_URL is not set (no fallback to DATABASE_URL). The app will not start on Preview.",
      );
    }
    assertPreviewDatabaseIsolation(previewUrl);
    return previewUrl;
  }
  return process.env.DATABASE_URL;
}

/** Verified-TLS options for pg: the given CA only, no fallback to unverified or plaintext. */
export function buildPreviewSslConfig(ca: string = SUPABASE_ROOT_CA_2021_PEM): NonNullable<PoolConfig["ssl"]> {
  return { ca, rejectUnauthorized: true };
}

/** Preview: verified TLS with the pinned Supabase root CA. Everywhere else: undefined (unchanged behaviour). */
export function resolveDatabaseSsl(env: NodeJS.ProcessEnv = process.env): PoolConfig["ssl"] {
  return env.VERCEL_ENV === "preview" ? buildPreviewSslConfig() : undefined;
}

const connectionString = resolveDatabaseUrl();

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your Postgres instance (Neon or Supabase both work — see README).",
  );
}

// Cached on globalThis in every environment, not just dev: Next dev's Hot
// Module Reload re-evaluates this module on every edit, which would
// otherwise create a brand new pg Pool (and leak its connections) each
// time; on Vercel, the same caching lets a warm instance reuse one pool
// across invocations instead of opening a fresh one per request.
//
// `max` was previously 5 on the (incorrect) assumption that port 6543
// meant Supabase's transaction-mode pooler, which tolerates many more
// concurrent connections than session mode. Production's own
// EMAXCONNSESSION errors report "session mode" explicitly, and
// pg_stat_activity confirms it: connections opened by this pool sit
// `idle` for minutes after their query finished, well past pg's own
// 10s default idleTimeoutMillis — because a serverless instance freezes
// between invocations, the pool's timer-based idle-connection reaper
// never gets to run. Each (possibly frozen) concurrent instance can hold
// up to `max` real sessions open against Supabase's pooler, which caps
// this project at 15 total — so a handful of concurrent instances is
// enough to exceed it. Lowered to 3 to reduce that worst-case, and
// idleTimeoutMillis set explicitly (shorter than pg's default) so any
// instance that *does* get to run its timer sheds idle connections
// faster. This mitigates the failure rate; it does not eliminate the
// underlying architecture mismatch (see the EMAXCONNSESSION diagnostic
// report for the recommended longer-term fix).
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool = globalForDb.pgPool ?? new Pool({ connectionString, ssl: resolveDatabaseSsl(), max: 3, idleTimeoutMillis: 3000 });

globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
