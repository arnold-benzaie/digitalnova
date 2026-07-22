import type { NavIconName } from "@/components/gbp-audit/ui/nav-icons";
import type { NavBadgeCounts } from "@/lib/gbp-audit/nav-badges";

export type NavItem = { label: string; href: string; icon: NavIconName; badge?: keyof NavBadgeCounts };
export type NavSection = { key: string; label: string | null; items: NavItem[]; defaultOpen: boolean };

/** Staff/admin sidebar — one unified nav, four collapsible sections. Audit
 * GBP is PUBLIC-MAP Audit's own home and opens by default; the other three
 * restore what the previous flat nav had, just organized instead of dumped
 * in one long list. See app-shell-client.tsx for the rendering/collapse
 * logic — this file is config only. */
export const STAFF_NAV_SECTIONS: NavSection[] = [
  {
    key: "audit",
    label: "Audit GBP",
    defaultOpen: true,
    items: [
      { label: "Tableau de bord", href: "/admin/audit", icon: "dashboard" },
      { label: "Nouvel audit", href: "/admin/audit/nouveau", icon: "plusCircle" },
      { label: "Audits", href: "/admin/audit/liste", icon: "list" },
      { label: "Rapports", href: "/admin/audit/rapports", icon: "fileText" },
      { label: "Demandes de devis", href: "/admin/audit/devis", icon: "inbox", badge: "auditPendingQuoteRequests" },
      { label: "Offres", href: "/admin/audit/offres", icon: "tag" },
      { label: "Équipe", href: "/admin/audit/equipe", icon: "users", badge: "auditPendingInvitations" },
      { label: "Notifications", href: "/admin/audit/notifications", icon: "bell", badge: "auditUnreadNotifications" },
      { label: "Paramètres", href: "/admin/audit/parametres", icon: "settings" },
    ],
  },
  {
    key: "relation",
    label: "Relation client",
    defaultOpen: false,
    items: [
      { label: "Organisations", href: "/admin", icon: "building" },
      { label: "Messagerie", href: "/admin/messages", icon: "mail" },
      { label: "Utilisateurs", href: "/admin/users", icon: "users" },
      { label: "Journal d'audit", href: "/admin/audit-log", icon: "history" },
    ],
  },
  {
    key: "crm",
    label: "CRM",
    defaultOpen: false,
    items: [
      { label: "Tableau de bord", href: "/admin/crm", icon: "briefcase" },
      { label: "Clients", href: "/admin/crm/clients", icon: "userCircle" },
      { label: "Pipeline", href: "/admin/crm/pipeline", icon: "trendingUp" },
      { label: "Contrats", href: "/admin/crm/contracts", icon: "fileSignature" },
      { label: "Devis", href: "/admin/crm/quotes", icon: "receipt" },
      { label: "Factures", href: "/admin/crm/invoices", icon: "creditCard" },
      { label: "Tickets", href: "/admin/crm/tickets", icon: "lifeBuoy", badge: "crmOpenTickets" },
      { label: "Tâches", href: "/admin/crm/tasks", icon: "checkSquare" },
      { label: "Calendrier", href: "/admin/crm/calendar", icon: "calendar" },
      { label: "Projets", href: "/admin/crm/projects", icon: "folder" },
    ],
  },
  {
    key: "business",
    label: "Business",
    defaultOpen: false,
    items: [
      { label: "Abonnement plateforme", href: "/admin/billing", icon: "creditCard" },
      { label: "Automatisations", href: "/admin/webhooks", icon: "zap" },
    ],
  },
];

export const CLIENT_NAV_SECTIONS: NavSection[] = [
  {
    key: "client",
    label: null,
    defaultOpen: true,
    items: [
      { label: "Tableau de bord", href: "/dashboard", icon: "dashboard" },
      { label: "Google Business Profile", href: "/dashboard/gbp", icon: "building" },
      { label: "Google Search Console", href: "/dashboard/search-console", icon: "list" },
      { label: "Google Analytics", href: "/dashboard/analytics", icon: "trendingUp" },
      { label: "Audits", href: "/dashboard/audits", icon: "fileText" },
      { label: "Documents", href: "/dashboard/documents", icon: "folder" },
      { label: "Messagerie", href: "/dashboard/messages", icon: "mail" },
      { label: "Paramètres", href: "/dashboard/settings", icon: "settings" },
    ],
  },
];
