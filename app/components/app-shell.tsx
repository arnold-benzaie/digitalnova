import { desc, eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { db } from "@/db";
import { notifications as notificationsTable } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import type { DevRole } from "@/lib/dev-role";
import { getNavBadgeCounts } from "@/lib/gbp-audit/nav-badges";
import { getLocale } from "@/lib/i18n/locale";
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
  const org = await getOrCreateDevOrganization();
  const [recentNotifications, badges, locale] = await Promise.all([
    db.select().from(notificationsTable).where(eq(notificationsTable.organizationId, org.id)).orderBy(desc(notificationsTable.createdAt)).limit(8),
    role === "client"
      ? Promise.resolve({ auditUnreadNotifications: 0, auditPendingInvitations: 0, auditPendingQuoteRequests: 0, crmOpenTickets: 0 })
      : getNavBadgeCounts(),
    getLocale(),
  ]);
  const unreadCount = recentNotifications.filter((n) => !n.read).length;

  return (
    <AppShellClient role={role} badges={badges} recentNotifications={recentNotifications} unreadCount={unreadCount} locale={locale}>
      {children}
    </AppShellClient>
  );
}
