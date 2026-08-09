"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteAllReadNotifications, deleteNotification, markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate, resolveDisplayTimeZone } from "@/lib/i18n/format";
import { renderNotification } from "@/lib/i18n/notification-templates";
import { notificationHref } from "@/lib/notification-href";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { notificationToast } from "@/components/notification-toaster";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: unknown;
  read: boolean;
  createdAt: Date;
};

/**
 * Shared by app/dashboard/notifications/page.tsx and
 * app/admin/notifications/page.tsx — same read/unread distinction, per-item
 * mark-as-read, and "mark all read" behavior components/notification-bell.tsx
 * already has, just for the full-history list instead of the last 8. One
 * component instead of duplicating this interaction logic in both pages.
 */
export function NotificationsList({ items, locale, base }: { items: NotificationItem[]; locale: Locale; base: "/admin" | "/dashboard" }) {
  const t = dictionaries[locale].navigation.bell;
  const tPage = dictionaries[locale].notificationsPage;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const unreadCount = items.filter((item) => !item.read).length;
  const readCount = items.filter((item) => item.read).length;
  // organizationTimeZone is null until organizations.timezone exists — see
  // resolveDisplayTimeZone's docstring; this is where that column's value
  // will plug in later without changing this call site.
  const timeZone = resolveDisplayTimeZone({ organizationTimeZone: null, isAdminSpace: base === "/admin" });

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteNotification(id);
      if (result.deleted) {
        notificationToast.success(tPage.notificationDeleted);
        router.refresh();
      }
    });
  }

  function handleDeleteRead() {
    if (!confirm(tPage.deleteReadConfirm)) return;
    startTransition(async () => {
      const result = await deleteAllReadNotifications();
      if (result.deletedCount > 0) {
        notificationToast.success(tPage.readNotificationsDeleted);
        router.refresh();
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="mt-8">
        <EmptyState icon={<NAV_ICONS.bell width={22} height={22} />} title={tPage.empty} />
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {(unreadCount > 0 || readCount > 0) && (
        <div className="flex items-center justify-end gap-4">
          {readCount > 0 && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleDeleteRead}
              className="text-xs text-pm-gris underline transition hover:text-pm-noir disabled:opacity-50"
            >
              {tPage.deleteRead}
            </button>
          )}
          {unreadCount > 0 && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await markAllNotificationsRead();
                  router.refresh();
                })
              }
              className="text-xs text-pm-gris underline transition hover:text-pm-bleu-eu disabled:opacity-50"
            >
              {t.markAllRead}
            </button>
          )}
        </div>
      )}

      {items.map((item) => {
        const rendered = renderNotification(item, locale);
        const href = notificationHref(item.type, base);
        const content = (
          <div className="flex items-start gap-2">
            {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pm-rouge" aria-hidden="true" />}
            <div className={item.read ? "ml-4 flex-1" : "flex-1"}>
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium text-pm-noir">{rendered.title}</p>
                <p className="shrink-0 text-xs text-pm-gris">{formatDate(item.createdAt, locale, { dateStyle: "medium", timeStyle: "short", timeZone })}</p>
              </div>
              {rendered.body && <p className="mt-1 text-sm text-pm-gris">{rendered.body}</p>}
            </div>
          </div>
        );
        const markRead = () => {
          if (!item.read) startTransition(() => markNotificationRead(item.id));
        };
        const deleteButton = (
          <button
            type="button"
            disabled={isPending}
            aria-label={t.deleteAriaLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleDelete(item.id);
            }}
            className="shrink-0 rounded-full p-1.5 text-pm-gris/70 transition hover:bg-pm-gris-2/40 hover:text-pm-noir disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="sr-only">{tPage.delete}</span>
          </button>
        );

        return (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-pm-g-blue/25 hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]"
          >
            {href ? (
              <Link href={href} onClick={markRead} className="min-w-0 flex-1">
                {content}
              </Link>
            ) : (
              <button type="button" onClick={markRead} disabled={item.read} className="min-w-0 flex-1 text-left disabled:cursor-default">
                {content}
              </button>
            )}
            {deleteButton}
          </div>
        );
      })}
    </div>
  );
}
