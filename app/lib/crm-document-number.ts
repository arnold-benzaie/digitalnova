import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";

/** "DEV-2026-0001" / "FAC-2026-0001" — sequential per calendar year. Not
 * concurrency-safe under heavy simultaneous writes (no DB sequence/lock),
 * acceptable at this app's single-agency scale — same tradeoff already
 * made elsewhere in this codebase (e.g. mock-sub-${Date.now()} in
 * lib/actions/billing.ts). Split out of lib/crm-billing.ts because it's the
 * only piece of that module that touches the database — everything else
 * there is imported by client components for live total previews.
 */
export async function nextDocumentNumber(table: PgTable, numberColumn: PgColumn, prefix: string) {
  const year = new Date().getFullYear();
  const result = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from ${table} where ${numberColumn} like ${`${prefix}-${year}-%`}`,
  );
  const seq = Number(result.rows[0]?.count ?? 0) + 1;
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}
