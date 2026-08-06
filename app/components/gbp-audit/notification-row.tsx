"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markAuditNotificationRead } from "@/lib/actions/gbp-audit-notifications";
import type { Locale } from "@/lib/i18n/dictionaries";
import { formatDateTime, resolveDisplayTimeZone } from "@/lib/i18n/format";

export type NotificationListItem = { id: string; title: string; body: string | null; href: string | null; read: boolean; createdAt: string };

export function NotificationRow({ item, locale = "fr" }: { item: NotificationListItem; locale?: Locale }) {
  const [, startTransition] = useTransition();
  // Audit module is always admin space — same resolver as the main-platform
  // notifications list, same reason: Intl.DateTimeFormat without an
  // explicit timeZone renders differently on the server (UTC) than in the
  // browser, which is what causes React's hydration-mismatch error (#418).
  const timeZone = resolveDisplayTimeZone({ organizationTimeZone: null, isAdminSpace: true });

  function markRead() {
    if (!item.read) startTransition(() => markAuditNotificationRead(item.id));
  }

  const card = (
    <div
      className={`rounded-2xl border p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)] ${
        item.read ? "border-pm-gris-2 bg-white" : "border-pm-g-blue/25 bg-pm-g-blue/[0.025]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-pm-noir">{item.title}</p>
        <p className="shrink-0 text-xs text-pm-gris">{formatDateTime(item.createdAt, locale, { timeZone })}</p>
      </div>
      {item.body && <p className="mt-1 text-sm text-pm-gris">{item.body}</p>}
    </div>
  );

  if (!item.href) {
    return (
      <button type="button" onClick={markRead} className="text-left">
        {card}
      </button>
    );
  }

  return (
    <Link href={item.href} onClick={markRead}>
      {card}
    </Link>
  );
}
