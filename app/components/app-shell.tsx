import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/db";
import { notifications as notificationsTable } from "@/db/schema";
import { NotificationBell } from "@/components/notification-bell";
import { RoleSwitcher } from "@/components/role-switcher";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import type { DevRole } from "@/lib/dev-role";

type NavItem = { label: string; href: string };
type NavGroup = { section?: string; items: NavItem[] };

const STAFF_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Organisations", href: "/admin" },
      { label: "Messagerie", href: "/admin/messages" },
      { label: "Utilisateurs", href: "/admin/users" },
      { label: "Journal d'audit", href: "/admin/audit-log" },
    ],
  },
  {
    section: "CRM",
    items: [
      { label: "Tableau de bord", href: "/admin/crm" },
      { label: "Clients", href: "/admin/crm/clients" },
      { label: "Pipeline", href: "/admin/crm/pipeline" },
      { label: "Contrats", href: "/admin/crm/contracts" },
      { label: "Tickets", href: "/admin/crm/tickets" },
      { label: "Tâches", href: "/admin/crm/tasks" },
      { label: "Calendrier", href: "/admin/crm/calendar" },
      { label: "Projets", href: "/admin/crm/projects" },
    ],
  },
  {
    section: "Business",
    items: [
      { label: "Facturation", href: "/admin/billing" },
      { label: "Automatisations", href: "/admin/webhooks" },
    ],
  },
];

const NAV_GROUPS: Record<DevRole, NavGroup[]> = {
  client: [
    {
      items: [
        { label: "Tableau de bord", href: "/dashboard" },
        { label: "Google Business Profile", href: "/dashboard/gbp" },
        { label: "Audits", href: "/dashboard/audits" },
        { label: "Documents", href: "/dashboard/documents" },
        { label: "Messagerie", href: "/dashboard/messages" },
        { label: "Paramètres", href: "/dashboard/settings" },
      ],
    },
  ],
  staff: STAFF_GROUPS,
  admin: STAFF_GROUPS,
};

/**
 * Phase 0/1 shell: fixed sidebar + header, brand tokens only (see
 * app/globals.css). Nav is role-aware (client portal vs staff/admin area);
 * once Clerk + memberships are back, `role` should come from the real
 * session instead of the dev-role cookie (see lib/dev-role.ts).
 */
export async function AppShell({ children, role }: { children: ReactNode; role: DevRole }) {
  const org = await getOrCreateDevOrganization();
  const recentNotifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.organizationId, org.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(8);
  const unreadCount = recentNotifications.filter((n) => !n.read).length;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-pm-gris-2 bg-white p-6 md:flex">
        <div className="mb-10 font-serif text-2xl font-semibold text-pm-noir">
          Public<span className="text-pm-rouge">Maps</span>
        </div>
        <nav className="flex flex-col gap-4">
          {NAV_GROUPS[role].map((group, index) => (
            <div key={group.section ?? index} className="flex flex-col gap-1">
              {group.section && (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-pm-gris">
                  {group.section}
                </p>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-sm text-pm-gris transition hover:bg-pm-gris-2/40 hover:text-pm-noir"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-pm-gris-2 bg-white px-6">
          <div className="font-serif text-lg font-semibold text-pm-noir md:hidden">
            Public<span className="text-pm-rouge">Maps</span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <span className="rounded-full bg-pm-gris-2/40 px-3 py-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
              {role === "client" ? "Espace client" : "Espace agence"}
            </span>
            <NotificationBell
              notifications={recentNotifications}
              unreadCount={unreadCount}
              viewAllHref={role === "client" ? "/dashboard/notifications" : "/admin/notifications"}
            />
            <RoleSwitcher current={role} />
          </div>
        </header>
        <main className="flex-1 bg-pm-blanc p-6">{children}</main>
      </div>
    </div>
  );
}
