"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { trackClientEvent } from "@/lib/actions/product-events";

/**
 * Minimal page_view tracker — mounted once in app/dashboard/layout.tsx
 * only (never app/admin/layout.tsx, never app/(marketing)/sign-in etc.),
 * so "don't track admin/auth pages" holds by construction rather than by
 * a path blocklist. Fires once per real pathname change — usePathname()
 * already excludes the query string/hash — never on an interval or poll,
 * and skips a redundant call when the pathname hasn't actually changed
 * (covers re-renders that don't correspond to a real navigation).
 */
export function ProductActivityTracker() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!pathname || lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;
    startTransition(() => {
      trackClientEvent({ eventType: "page_view", path: pathname }).catch(() => {
        // Best-effort — a tracking failure must never surface to the user.
      });
    });
  }, [pathname]);

  return null;
}
