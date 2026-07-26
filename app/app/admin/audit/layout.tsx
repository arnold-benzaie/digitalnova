import type { Metadata } from "next";
import type { ReactNode } from "react";
import { desc, eq } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditNotifications } from "@/db/audit-schema";
import { getAuditStaffSession } from "@/lib/gbp-audit/session";
import { AuditToaster } from "@/components/gbp-audit/ui/toast";
import { CommandPalette } from "@/components/gbp-audit/command-palette";
import { AuditNotificationBell } from "@/components/gbp-audit/audit-notification-bell";
import { getLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: { template: "%s — PUBLIC-MAP Audit", default: "PUBLIC-MAP Audit" },
};

/**
 * Scoped to /admin/audit/* only — mounts the toast host, the ⌘K command
 * palette, and the notification bell once for the whole module without
 * touching the shared app/admin/layout.tsx (used by CRM and every other
 * admin page too). Uses getAuditStaffSession (nullable, non-throwing) not
 * requireAuditStaffRole — a layout can't gate access to its children (Next
 * still renders/fetches them regardless), so real access control stays in
 * each page as before; this just renders an empty bell if there's no
 * session yet rather than throwing ahead of the page's own check.
 */
export default async function GbpAuditLayout({ children }: { children: ReactNode }) {
  const [session, locale] = await Promise.all([getAuditStaffSession(), getLocale()]);

  const notifications = session
    ? await auditDb
        .select()
        .from(auditNotifications)
        .where(eq(auditNotifications.recipientUserId, session.userId))
        .orderBy(desc(auditNotifications.createdAt))
        .limit(8)
    : [];
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <CommandPalette locale={locale} />
        {session && (
          <AuditNotificationBell
            notifications={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, read: n.readAt !== null, createdAt: n.createdAt }))}
            unreadCount={unreadCount}
            locale={locale}
          />
        )}
      </div>
      <div className="mt-2">{children}</div>
      <AuditToaster />
    </>
  );
}
