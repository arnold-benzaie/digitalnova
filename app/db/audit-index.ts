import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as auditSchema from "./audit-schema";
import { assertNotMainProductionDatabase } from "./guard-main-production";

/**
 * Separate Drizzle client for the PUBLIC-MAP Audit application's own
 * Supabase project — deliberately never the same Pool/connection as
 * db/index.ts (the main CRM/SaaS platform). Reads AUDIT_DATABASE_URL, a
 * DIFFERENT env var name than the main app's DATABASE_URL specifically so
 * the two can never collide or be silently swapped in .env.local.
 */
if (!process.env.AUDIT_DATABASE_URL) {
  throw new Error(
    "AUDIT_DATABASE_URL is not set. Copy .env.example to .env.local and point it at the PUBLIC-MAP Audit Supabase project (a project SEPARATE from DATABASE_URL — see db/audit-schema.ts).",
  );
}

assertNotMainProductionDatabase(process.env.AUDIT_DATABASE_URL, "AUDIT_DATABASE_URL");

const globalForAuditDb = globalThis as unknown as { auditPgPool?: Pool };

const auditPool =
  globalForAuditDb.auditPgPool ?? new Pool({ connectionString: process.env.AUDIT_DATABASE_URL, max: 5 });

if (process.env.NODE_ENV !== "production") {
  globalForAuditDb.auditPgPool = auditPool;
}

export const auditDb = drizzle(auditPool, { schema: auditSchema });
