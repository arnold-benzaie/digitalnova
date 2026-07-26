/**
 * Notifications UI chrome (list pages, tabs) — NOT the per-notification
 * title/body content itself, which is rendered per-locale from stored
 * `type` + `metadata` via lib/i18n/notification-templates.ts. This domain
 * is just static page furniture: headings, empty states, filters.
 */
export const notificationsPage = {
  fr: {
    title: (orgName: string) => `Notifications — ${orgName}`,
    subtitle: "Historique complet des notifications de cette organisation.",
    empty: "Aucune notification",
    unreadOnly: "Non lues uniquement",
    all: "Toutes",
  },
  en: {
    title: (orgName: string) => `Notifications — ${orgName}`,
    subtitle: "Full notification history for this organization.",
    empty: "No notifications",
    unreadOnly: "Unread only",
    all: "All",
  },
} as const;
