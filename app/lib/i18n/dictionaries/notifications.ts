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
    delete: "Supprimer",
    deleteRead: "Supprimer les notifications lues",
    deleteReadConfirm: "Supprimer toutes les notifications lues ? Cette action est définitive.",
    notificationDeleted: "Notification supprimée",
    readNotificationsDeleted: "Notifications lues supprimées",
  },
  en: {
    title: (orgName: string) => `Notifications — ${orgName}`,
    subtitle: "Full notification history for this organization.",
    empty: "No notifications",
    unreadOnly: "Unread only",
    all: "All",
    delete: "Delete",
    deleteRead: "Delete read notifications",
    deleteReadConfirm: "Delete all read notifications? This cannot be undone.",
    notificationDeleted: "Notification deleted",
    readNotificationsDeleted: "Read notifications deleted",
  },
} as const;
