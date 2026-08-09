import { and, count, desc, eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { db } from "@/db";
import { notifications as notificationsTable } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import type { DevRole } from "@/lib/dev-role";
import { getNavBadgeCounts } from "@/lib/gbp-audit/nav-badges";
import { getLocale } from "@/lib/i18n/locale";
import { getNotificationSoundPath } from "@/lib/notification-sound-availability";
import { notificationVisibilityWhere } from "@/lib/notification-visibility";
import { requireSession } from "@/lib/session";
import { AppShellClient } from "@/components/app-shell-client";

/**
 * Phase 0/1 shell: fixed sidebar + header, brand tokens only (see
 * app/globals.css). Nav is role-aware (client portal vs staff/admin area);
 * `role` comes from the real Clerk session + DB membership (see
 * lib/session.ts, resolved via lib/dev-role.ts). All interactive bits
 * (collapsible sections, mobile drawer, collapsed-width toggle) live in
 * AppShellClient — this stays a Server Component so it can fetch org,
 * notifications and badge counts directly.
 */
export async function AppShell({ children, role }: { children: ReactNode; role: DevRole }) {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  const visibility = notificationVisibilityWhere(org.id, session.userId, session.role);
  const [recentNotifications, unreadCount, badges, locale] = await Promise.all([
    // Preview list only — last 8, for the dropdown. The unread badge below
    // is computed from a separate, unlimited COUNT so it stays exact past
    // 8 unread rows (previously it was `recentNotifications.filter(unread)`,
    // which silently capped the badge at whatever fit in these 8 rows).
    db.select().from(notificationsTable).where(visibility).orderBy(desc(notificationsTable.createdAt)).limit(8),
    db
      .select({ value: count() })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.read, false), visibility))
      .then((rows) => rows[0]?.value ?? 0),
    role === "client"
      ? Promise.resolve({ auditUnreadNotifications: 0, auditPendingInvitations: 0, auditPendingQuoteRequests: 0, crmOpenTickets: 0 })
      : getNavBadgeCounts(),
    getLocale(),
  ]);

  return (
    <AppShellClient
      role={role}
      badges={badges}
      recentNotifications={recentNotifications}
      unreadCount={unreadCount}
      locale={locale}
      soundPath={getNotificationSoundPath()}
    >
      {children}
    </AppShellClient>
  );
}
