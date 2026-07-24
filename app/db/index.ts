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
// time; on Vercel, the same caching lets a warm Fluid Compute instance
// reuse one pool across invocations instead of opening a fresh one per
// request. `max` is left at 5 deliberately — lowering it was measured to
// add real query-queuing latency locally with no corresponding safety
// benefit once DATABASE_URL points at Supabase's transaction-mode pooler
// (port 6543), which multiplexes far more concurrent connections than the
// session-mode pooler ever did.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool = globalForDb.pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
