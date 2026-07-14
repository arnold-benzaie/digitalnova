import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your Postgres instance (Neon or Supabase both work — see README).",
  );
}

// Next dev's Hot Module Reload re-evaluates this module on every edit, which
// would otherwise create a brand new pg Pool (and leak its connections) each
// time — the Supabase session pooler caps at 15 clients total, so a handful
// of reloads was enough to exhaust it (EMAXCONNSESSION). Stashing the pool
// on globalThis lets it survive HMR in development; `max` is also kept low
// so a handful of concurrent serverless instances in production can't
// exhaust the same shared limit either.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool = globalForDb.pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });
