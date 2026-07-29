"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PortalNavGroup } from "@/lib/developer-portal/nav";

/** Sidebar for every /developers/docs/** page — lists shipped guides
 * (linked) and future sections (shown, not linked, with a "soon" badge)
 * so the portal's full intended scope stays visible as it grows. */
export function DocsSidebar({ groups, soonBadge }: { groups: PortalNavGroup[]; soonBadge: string }) {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Documentation" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-pm-gris">{group.label}</p>
          {group.items.map((item) => {
            if (item.status === "soon") {
              return (
                <span key={item.key} className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm text-pm-gris/50">
                  {item.label}
                  <span className="rounded-full bg-pm-gris-2/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pm-gris">
                    {soonBadge}
                  </span>
                </span>
              );
            }
            const active = pathname === item.href;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  active ? "bg-pm-noir text-pm-blanc" : "text-pm-noir hover:bg-pm-gris-2/30"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
