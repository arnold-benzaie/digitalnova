import "server-only";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, users } from "@/db/schema";
import { auditDb } from "@/db/audit-index";
import { gbpAudits, gbpQuoteRequests } from "@/db/audit-schema";
import type { BusinessMetrics } from "./types";

/**
 * Real business metrics straight from PUBLIC-MAP's own Postgres tables —
 * not GA4 custom events. More accurate/immediate for internal data
 * PUBLIC-MAP already records, and requires no new event instrumentation.
 * gbpAudits/gbpQuoteRequests live in the separate Audit database
 * (db/audit-index.ts); invoices/users live in the main one — two round
 * trips, same as every other page that touches both domains.
 *
 * Revenue/conversions are plain aggregates over whatever payment records
 * actually exist in `invoices` today — no assumption about which (if
 * any) payment provider populated them, and no invented values: an empty
 * table aggregates to 0, which is exactly what should be shown.
 */
export async function getBusinessMetrics(): Promise<BusinessMetrics> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [auditRows, mainRows] = await Promise.all([
    Promise.all([
      auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpQuoteRequests).where(gte(gbpQuoteRequests.createdAt, since30d)),
      auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpAudits).where(gte(gbpAudits.createdAt, since30d)),
      auditDb
        .select({ count: sql<number>`count(*)::int` })
        .from(gbpAudits)
        .where(and(isNotNull(gbpAudits.sentAt), gte(gbpAudits.sentAt, since30d))),
      auditDb
        .select({ count: sql<number>`count(*)::int` })
        .from(gbpQuoteRequests)
        .where(and(eq(gbpQuoteRequests.status, "won"), gte(gbpQuoteRequests.createdAt, since30d))),
    ]),
    Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users).where(gte(users.lastLoginAt, since7d)),
      db
        .select({
          count: sql<number>`count(*)::int`,
          totalEuros: sql<number>`coalesce(sum(${invoices.amountEuros}), 0)::int`,
        })
        .from(invoices)
        .where(and(eq(invoices.status, "paid"), gte(invoices.issuedAt, since30d))),
    ]),
  ]);

  const [[quoteRequests30d], [auditsStarted30d], [auditsCompleted30d], [conversions30d]] = auditRows;
  const [[loginsThisWeek], [paidInvoices30d]] = mainRows;

  return {
    quoteRequests30d: quoteRequests30d.count,
    auditsStarted30d: auditsStarted30d.count,
    auditsCompleted30d: auditsCompleted30d.count,
    loginsThisWeek: loginsThisWeek.count,
    conversions30d: conversions30d.count,
    revenue30dEuros: paidInvoices30d.totalEuros,
    paidInvoiceCount30d: paidInvoices30d.count,
  };
}
