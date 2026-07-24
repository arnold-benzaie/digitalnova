import "server-only";
import { eq, inArray } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditNotifications, auditStaffMemberships, auditStaffRoles } from "@/db/audit-schema";
import type { AuditStaffRole } from "@/lib/gbp-audit/session";

/**
 * Broadcasts one audit_notifications row per staff member holding any of
 * `roles` — e.g. notifyAuditRoles(["admin", "supervisor"], {...}) when a
 * prospect submits a quote request. There's no single-agent equivalent yet:
 * gbpAudits.assignedAgentName is a free-text field, not a FK to
 * audit_staff_users, so "notify the assigned agent" can't be resolved
 * reliably — see db/audit-schema.ts.
 */
export async function notifyAuditRoles(
  roles: AuditStaffRole[],
  input: { kind: string; title: string; body?: string | null; href?: string | null },
): Promise<void> {
  const recipients = await auditDb
    .select({ userId: auditStaffMemberships.userId })
    .from(auditStaffMemberships)
    .innerJoin(auditStaffRoles, eq(auditStaffRoles.id, auditStaffMemberships.roleId))
    .where(inArray(auditStaffRoles.name, roles));

  if (recipients.length === 0) return;

  await auditDb.insert(auditNotifications).values(
    recipients.map((r) => ({ recipientUserId: r.userId, kind: input.kind, title: input.title, body: input.body ?? null, href: input.href ?? null })),
  );
}
