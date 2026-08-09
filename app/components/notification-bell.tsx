"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteNotification, markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { renderNotification } from "@/lib/i18n/notification-templates";
import { notificationHref } from "@/lib/notification-href";
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

export function NotificationBell({
  notifications,
  unreadCount,
  viewAllHref,
  locale,
}: {
  notifications: NotificationItem[];
  unreadCount: number;
  viewAllHref: string;
  locale: Locale;
}) {
  const t = dictionaries[locale].navigation.bell;
  const tPage = dictionaries[locale].notificationsPage;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteNotification(id);
      if (result.deleted) {
        notificationToast.success(tPage.notificationDeleted);
        router.refresh();
      }
    });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.label}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-pm-gris-2 bg-white text-pm-noir transition hover:bg-pm-gris-2/40"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pm-rouge px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-2xl border border-pm-gris-2 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-pm-gris-2 px-4 py-3">
            <p className="text-sm font-medium text-pm-noir">{t.heading}</p>
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
                className="text-xs text-pm-gris underline hover:text-pm-noir disabled:opacity-50"
              >
                {t.markAllRead}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-pm-gris">{t.empty}</p>
            ) : (
              notifications.map((item) => {
                const rendered = renderNotification(item, locale);
                const href = notificationHref(item.type, viewAllHref.startsWith("/admin") ? "/admin" : "/dashboard");
                const content = (
                  <div className="flex items-start gap-2">
                    {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pm-rouge" />}
                    <div className={item.read ? "ml-4" : ""}>
                      <p className="text-sm font-medium text-pm-noir">{rendered.title}</p>
                      {rendered.body && <p className="mt-0.5 text-xs text-pm-gris">{rendered.body}</p>}
                      <p className="mt-1 text-[11px] text-pm-gris">
                        {formatDate(item.createdAt, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
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
                    className="shrink-0 rounded-full p-1 text-pm-gris/70 transition hover:bg-pm-gris-2/40 hover:text-pm-noir disabled:opacity-50"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                );
                return (
                  <div key={item.id} className="flex items-start gap-1 border-b border-pm-gris-2 px-2 py-1 last:border-b-0 hover:bg-pm-gris-2/30">
                    {href ? (
                      <Link
                        href={href}
                        onClick={() => {
                          setOpen(false);
                          // Fire-and-forget alongside the navigation, not
                          // awaited first — revalidatePath (inside
                          // markNotificationRead) invalidates /admin and
                          // /dashboard's cached layout data, so the unread
                          // badge is correct by the time the destination
                          // page's shared layout renders.
                          if (!item.read) startTransition(() => markNotificationRead(item.id));
                        }}
                        className="min-w-0 flex-1 rounded-xl px-2 py-2"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="min-w-0 flex-1 px-2 py-2">{content}</div>
                    )}
                    <div className="pt-2">{deleteButton}</div>
                  </div>
                );
              })
            )}
          </div>

          <Link
            href={viewAllHref}
            onClick={() => setOpen(false)}
            className="block border-t border-pm-gris-2 px-4 py-3 text-center text-xs font-medium text-pm-noir hover:bg-pm-gris-2/30"
          >
            {t.viewAll}
          </Link>
        </div>
      )}
    </div>
  );
}
