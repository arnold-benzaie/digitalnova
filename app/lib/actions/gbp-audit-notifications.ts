"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { auditNotifications } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";

export async function markAllAuditNotificationsRead() {
  const session = await requireAuditStaffRole();
  await auditDb.update(auditNotifications).set({ readAt: new Date() }).where(eq(auditNotifications.recipientUserId, session.userId));
  revalidatePath("/admin/audit");
  revalidatePath("/admin/audit/notifications");
}

/** Scoped to the caller's own notifications (recipientUserId match) — one staff member can't mark another's as read. */
export async function markAuditNotificationRead(notificationId: string) {
  const session = await requireAuditStaffRole();
  await auditDb
    .update(auditNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(auditNotifications.id, notificationId), eq(auditNotifications.recipientUserId, session.userId)));
  revalidatePath("/admin/audit");
  revalidatePath("/admin/audit/notifications");
}
