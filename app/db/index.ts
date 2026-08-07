import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
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

const pool =
  globalForDb.pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 3000 });

globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
