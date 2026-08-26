import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

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
 * ever accidentally set there too. Every other case (Production,
 * Preview without the var, local dev, tests that set DATABASE_URL
 * directly) resolves to the exact same DATABASE_URL behavior as before.
 */
export function resolveDatabaseUrl(): string | undefined {
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  if (isVercelPreview && process.env.PREVIEW_SCHEMA_DATABASE_URL) {
    return process.env.PREVIEW_SCHEMA_DATABASE_URL;
  }
  return process.env.DATABASE_URL;
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

const pool = globalForDb.pgPool ?? new Pool({ connectionString, max: 3, idleTimeoutMillis: 3000 });

globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
