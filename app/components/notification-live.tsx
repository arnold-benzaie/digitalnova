"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getLatestNotificationMeta, getNotificationsById } from "@/lib/actions/notifications";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { renderNotification } from "@/lib/i18n/notification-templates";
import { getNotificationPreferences, playNotificationSound } from "@/lib/notification-preferences";
import { notificationToast } from "@/components/notification-toaster";

const POLL_INTERVAL_MS = 12000;

/**
 * Lightweight polling for "a new notification arrived while this tab is
 * open" — toast + optional sound + optional browser Notification, then
 * router.refresh() so the server-rendered bell (components/notification-
 * bell.tsx, fed by components/app-shell.tsx's query) picks up the new
 * unread count. Deliberately reuses that same server-round-trip mechanism
 * (already how "mark all read" refreshes the bell) rather than maintaining
 * a second, parallel client-side copy of the same 8 notifications.
 *
 * Modeled directly on app/access-pending/access-pending-client.tsx's
 * existing poll()-on-mount-then-setInterval shape (same codebase, same
 * problem: detect a server-side change without a page reload) — immediate
 * check on mount, cleaned up on unmount, and additionally paused via the
 * Page Visibility API while the tab is hidden (resumed, with an immediate
 * poll rather than waiting out the rest of the interval, when it's shown
 * again) since there's nothing to gain from polling a backgrounded tab.
 *
 * `seenIds` is seeded from `initialNotificationIds` — the same 8 rows
 * AppShell already fetched and passed down as props for the bell itself —
 * not from an extra throwaway first poll, and not toasted/sounded: this is
 * what guarantees pre-existing unread notifications never toast on page
 * load, only ones that appear after that.
 */
export function NotificationLive({
  initialNotificationIds,
  locale,
  soundPath,
}: {
  initialNotificationIds: string[];
  locale: Locale;
  soundPath: string | null;
}) {
  const router = useRouter();
  const seenIds = useRef<Set<string>>(new Set(initialNotificationIds));
  const inFlightRef = useRef(false);
  // Screen-reader announcement, independent of the toast/badge — per the
  // accessibility requirement that a new notification must be perceivable
  // without relying on sound or on spotting the badge changing.
  const [announcement, setAnnouncement] = useState("");
  const t = dictionaries[locale].settings.notificationPreferences;

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const latest = await getLatestNotificationMeta();
        if (cancelled) return;

        const newIds = latest.map((item) => item.id).filter((id) => !seenIds.current.has(id));
        for (const item of latest) seenIds.current.add(item.id);
        if (newIds.length === 0) return;

        const fullRows = await getNotificationsById(newIds);
        if (cancelled) return;

        const prefs = getNotificationPreferences();
        for (const row of fullRows) {
          const rendered = renderNotification(row, locale);
          notificationToast.info(rendered.title, rendered.body ?? undefined);
          setAnnouncement(`${t.newNotification} — ${rendered.title}`);
          if (prefs.soundEnabled && soundPath) playNotificationSound(soundPath);
          if (prefs.browserNotificationsEnabled && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
            // tag: same id can never open two overlapping system
            // notifications, satisfying the "no duplicate" requirement.
            new Notification(rendered.title, { body: rendered.body ?? undefined, tag: row.id, icon: "/brand/public-map-logo.png" });
          }
        }
        router.refresh();
      } catch {
        // Network hiccup — never surface a raw error, just retry next tick.
      } finally {
        inFlightRef.current = false;
      }
    }

    function startPolling() {
      if (intervalId) return;
      poll();
      intervalId = setInterval(poll, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function handleVisibilityChange() {
      if (document.hidden) stopPolling();
      else startPolling();
    }

    if (!document.hidden) startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router, locale, t.newNotification, soundPath]);

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {announcement}
    </span>
  );
}
