"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markAuditNotificationRead } from "@/lib/actions/gbp-audit-notifications";

// `displayDate` arrives pre-formatted from the Server Component
// (app/admin/audit/notifications/page.tsx) — never formatted here. This
// component is "use client" (it IS hydrated, unlike a plain Server
// Component), and Intl.DateTimeFormat can render a different string on
// the server's ICU/CLDR data than on the browser's for the exact same
// locale/timeZone/options (confirmed: Node/Chromium render the fr-FR
// medium/short date-time connector as "," while WebKit renders " à ").
// That text divergence is what previously caused React's hydration-
// mismatch error #418 on this page. Formatting server-side only (same
// timeZone as before, "Indian/Mauritius" via resolveDisplayTimeZone) makes
// the rendered text identical and fixed between server and client.
export type NotificationListItem = { id: string; title: string; body: string | null; href: string | null; read: boolean; displayDate: string };

export function NotificationRow({ item }: { item: NotificationListItem }) {
  const [, startTransition] = useTransition();

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
        <p className="shrink-0 text-xs text-pm-gris">{item.displayDate}</p>
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
