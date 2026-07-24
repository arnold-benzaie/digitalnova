"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markAuditNotificationRead } from "@/lib/actions/gbp-audit-notifications";

export type NotificationListItem = { id: string; title: string; body: string | null; href: string | null; read: boolean; createdAt: string };

export function NotificationRow({ item }: { item: NotificationListItem }) {
  const [, startTransition] = useTransition();

  function markRead() {
    if (!item.read) startTransition(() => markAuditNotificationRead(item.id));
  }

  const card = (
    <div className={`rounded-2xl border bg-white p-4 transition-shadow hover:shadow-sm ${item.read ? "border-pm-gris-2" : "border-pm-noir/20"}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-pm-noir">{item.title}</p>
        <p className="shrink-0 text-xs text-pm-gris">{new Date(item.createdAt).toLocaleString("fr-FR")}</p>
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
