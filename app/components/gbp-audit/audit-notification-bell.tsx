"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { markAllAuditNotificationsRead, markAuditNotificationRead } from "@/lib/actions/gbp-audit-notifications";

type NotificationItem = { id: string; title: string; body: string | null; href: string | null; read: boolean; createdAt: Date };

/**
 * Audit-module equivalent of components/notification-bell.tsx — kept as a
 * separate component (not a shared/parameterized one) because the two pull
 * from entirely different databases and staff identity systems; forcing
 * them through one component would mean threading a mark-all-read callback
 * and a data source through props for a ~120-line component used in
 * exactly two places.
 */
export function AuditNotificationBell({ notifications, unreadCount }: { notifications: NotificationItem[]; unreadCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-pm-gris-2 bg-white text-pm-noir transition hover:bg-pm-gris-2/40"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
            <p className="text-sm font-medium text-pm-noir">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await markAllAuditNotificationsRead();
                    router.refresh();
                  })
                }
                className="text-xs text-pm-gris underline hover:text-pm-noir disabled:opacity-50"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-pm-gris">Aucune notification.</p>
            ) : (
              notifications.map((item) => {
                const content = (
                  <div className="flex items-start gap-2">
                    {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pm-rouge" aria-hidden="true" />}
                    <div className={item.read ? "ml-4" : ""}>
                      <p className="text-sm font-medium text-pm-noir">{item.title}</p>
                      {item.body && <p className="mt-0.5 text-xs text-pm-gris">{item.body}</p>}
                      <p className="mt-1 text-[11px] text-pm-gris">
                        {new Date(item.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
                const markReadAndClose = () => {
                  setOpen(false);
                  if (!item.read) startTransition(() => markAuditNotificationRead(item.id));
                };
                return (
                  <div key={item.id} className="border-b border-pm-gris-2 last:border-b-0">
                    {item.href ? (
                      <Link href={item.href} onClick={markReadAndClose} className="block px-4 py-3 hover:bg-pm-gris-2/20">
                        {content}
                      </Link>
                    ) : (
                      <button type="button" onClick={markReadAndClose} className="block w-full px-4 py-3 text-left hover:bg-pm-gris-2/20">
                        {content}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <Link
            href="/admin/audit/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-pm-gris-2 px-4 py-3 text-center text-xs font-medium text-pm-noir hover:bg-pm-gris-2/30"
          >
            Voir tout
          </Link>
        </div>
      )}
    </div>
  );
}
