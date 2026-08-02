"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { renderNotification } from "@/lib/i18n/notification-templates";
import { notificationHref } from "@/lib/notification-href";

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

  if (items.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
        <p className="font-serif text-lg font-semibold text-pm-noir">{tPage.empty}</p>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
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
          className="self-end text-xs text-pm-gris underline hover:text-pm-noir disabled:opacity-50"
        >
          {t.markAllRead}
        </button>
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
                <p className="shrink-0 text-xs text-pm-gris">{formatDate(item.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
              {rendered.body && <p className="mt-1 text-sm text-pm-gris">{rendered.body}</p>}
            </div>
          </div>
        );
        const markRead = () => {
          if (!item.read) startTransition(() => markNotificationRead(item.id));
        };
        return href ? (
          <Link
            key={item.id}
            href={href}
            onClick={markRead}
            className="block rounded-2xl border border-pm-gris-2 bg-white p-4 transition hover:bg-pm-gris-2/20"
          >
            {content}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            onClick={markRead}
            disabled={item.read}
            className="block w-full rounded-2xl border border-pm-gris-2 bg-white p-4 text-left transition enabled:hover:bg-pm-gris-2/20 disabled:cursor-default"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
