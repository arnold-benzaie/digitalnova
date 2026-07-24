import { and, eq, sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditNotifications, auditStaffInvitations, gbpQuoteRequests } from "@/db/audit-schema";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { getAuditStaffSession } from "@/lib/gbp-audit/session";

export type NavBadgeCounts = {
  auditUnreadNotifications: number;
  auditPendingInvitations: number;
  auditPendingQuoteRequests: number;
  crmOpenTickets: number;
};

/**
 * Sidebar badge counts — real numbers only, never invented. The audit-side
 * counts are scoped to the isolated audit DB (auditDb); the CRM ticket
 * count comes from the main app DB. Returns all-zero for the audit counts
 * when the signed-in person has no audit_staff_memberships row (a main-CRM
 * user who isn't also PUBLIC-MAP Audit staff) — matches how the rest of
 * the audit module treats "no membership" as no access, not a crash.
 */
export async function getNavBadgeCounts(): Promise<NavBadgeCounts> {
  const auditSession = await getAuditStaffSession();

  const [auditCounts, [{ count: crmOpenTickets }]] = await Promise.all([
    auditSession
      ? Promise.all([
          auditDb
            .select({ count: sql<number>`count(*)::int` })
            .from(auditNotifications)
            .where(and(eq(auditNotifications.recipientUserId, auditSession.userId), sql`${auditNotifications.readAt} is null`)),
          auditDb.select({ count: sql<number>`count(*)::int` }).from(auditStaffInvitations).where(eq(auditStaffInvitations.status, "pending")),
          auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpQuoteRequests).where(eq(gbpQuoteRequests.status, "new")),
        ])
      : Promise.resolve([[{ count: 0 }], [{ count: 0 }], [{ count: 0 }]] as const),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(sql`${tickets.status} in ('open', 'in_progress')`),
  ]);

  return {
    auditUnreadNotifications: auditCounts[0][0]?.count ?? 0,
    auditPendingInvitations: auditCounts[1][0]?.count ?? 0,
    auditPendingQuoteRequests: auditCounts[2][0]?.count ?? 0,
    crmOpenTickets: crmOpenTickets ?? 0,
  };
}
