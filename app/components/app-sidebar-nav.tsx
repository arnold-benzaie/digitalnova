import type { NavIconName } from "@/components/gbp-audit/ui/nav-icons";
import type { NavBadgeCounts } from "@/lib/gbp-audit/nav-badges";

export type NavItem = { label: string; href: string; icon: NavIconName; badge?: keyof NavBadgeCounts };
export type NavSection = { key: string; label: string | null; items: NavItem[]; defaultOpen: boolean };

/** Structural shape only (plain `string`, not the literal-French-typed
 * `typeof dictionaries.fr.navigation`) — so this same function accepts
 * either locale's dictionary without a type error, since the two locales'
 * string literals naturally differ. */
type NavDict = {
  sections: { auditGbp: string; clientRelation: string; crm: string; business: string };
  items: {
    dashboard: string; newAudit: string; audits: string; reports: string; quoteRequests: string; offers: string;
    team: string; notifications: string; settings: string; organizations: string; messaging: string; users: string;
    auditLog: string; systemHealth: string; siteAnalytics: string; crmDashboard: string; clients: string; pipeline: string; contracts: string; quotes: string;
    invoices: string; tickets: string; tasks: string; calendar: string; projects: string; billing: string;
    automations: string; googleBusinessProfile: string; googleSearchConsole: string; googleAnalytics: string; googleAds: string; documents: string; integrations: string;
  };
};

/** Staff/admin sidebar — one unified nav, four collapsible sections. Audit
 * GBP is PUBLIC-MAP Audit's own home and opens by default; the other three
 * restore what the previous flat nav had, just organized instead of dumped
 * in one long list. See app-shell-client.tsx for the rendering/collapse
 * logic — this file is config only.
 *
 * Labels are resolved from the active locale's `navigation` dictionary at
 * call time (not baked into a static array) — see components/app-shell-
 * client.tsx, which calls these with `dictionaries[locale].navigation`. */
export function getStaffNavSections(t: NavDict): NavSection[] {
  return [
    {
      key: "audit",
      label: t.sections.auditGbp,
      defaultOpen: true,
      items: [
        { label: t.items.dashboard, href: "/admin/audit", icon: "dashboard" },
        { label: t.items.newAudit, href: "/admin/audit/nouveau", icon: "plusCircle" },
        { label: t.items.audits, href: "/admin/audit/liste", icon: "list" },
        { label: t.items.reports, href: "/admin/audit/rapports", icon: "fileText" },
        { label: t.items.quoteRequests, href: "/admin/audit/devis", icon: "inbox", badge: "auditPendingQuoteRequests" },
        { label: t.items.offers, href: "/admin/audit/offres", icon: "tag" },
        { label: t.items.team, href: "/admin/audit/equipe", icon: "users", badge: "auditPendingInvitations" },
        { label: t.items.notifications, href: "/admin/audit/notifications", icon: "bell", badge: "auditUnreadNotifications" },
        { label: t.items.settings, href: "/admin/audit/parametres", icon: "settings" },
      ],
    },
    {
      key: "relation",
      label: t.sections.clientRelation,
      defaultOpen: false,
      items: [
        { label: t.items.organizations, href: "/admin", icon: "building" },
        { label: t.items.messaging, href: "/admin/messages", icon: "mail" },
        { label: t.items.users, href: "/admin/users", icon: "users" },
        { label: t.items.auditLog, href: "/admin/audit-log", icon: "history" },
        { label: t.items.systemHealth, href: "/admin/system-health", icon: "gauge" },
        { label: t.items.siteAnalytics, href: "/admin/analytics", icon: "barChart" },
      ],
    },
    {
      key: "crm",
      label: t.sections.crm,
      defaultOpen: false,
      items: [
        { label: t.items.crmDashboard, href: "/admin/crm", icon: "briefcase" },
        { label: t.items.clients, href: "/admin/crm/clients", icon: "userCircle" },
        { label: t.items.pipeline, href: "/admin/crm/pipeline", icon: "trendingUp" },
        { label: t.items.contracts, href: "/admin/crm/contracts", icon: "fileSignature" },
        { label: t.items.quotes, href: "/admin/crm/quotes", icon: "receipt" },
        { label: t.items.invoices, href: "/admin/crm/invoices", icon: "creditCard" },
        { label: t.items.tickets, href: "/admin/crm/tickets", icon: "lifeBuoy", badge: "crmOpenTickets" },
        { label: t.items.tasks, href: "/admin/crm/tasks", icon: "checkSquare" },
        { label: t.items.calendar, href: "/admin/crm/calendar", icon: "calendar" },
        { label: t.items.projects, href: "/admin/crm/projects", icon: "folder" },
      ],
    },
    {
      key: "business",
      label: t.sections.business,
      defaultOpen: false,
      items: [
        { label: t.items.billing, href: "/admin/billing", icon: "creditCard" },
        { label: t.items.automations, href: "/admin/integrations", icon: "zap" },
      ],
    },
  ];
}

export function getClientNavSections(t: NavDict): NavSection[] {
  return [
    {
      key: "client",
      label: null,
      defaultOpen: true,
      items: [
        { label: t.items.dashboard, href: "/dashboard", icon: "dashboard" },
        { label: t.items.googleBusinessProfile, href: "/dashboard/gbp", icon: "building" },
        { label: t.items.googleSearchConsole, href: "/dashboard/search-console", icon: "list" },
        { label: t.items.googleAnalytics, href: "/dashboard/analytics", icon: "trendingUp" },
        { label: t.items.googleAds, href: "/dashboard/google-ads", icon: "megaphone" },
        { label: t.items.integrations, href: "/dashboard/integrations", icon: "gauge" },
        { label: t.items.audits, href: "/dashboard/audits", icon: "fileText" },
        { label: t.items.documents, href: "/dashboard/documents", icon: "folder" },
        { label: t.items.messaging, href: "/dashboard/messages", icon: "mail" },
        { label: t.items.settings, href: "/dashboard/settings", icon: "settings" },
      ],
    },
  ];
}
