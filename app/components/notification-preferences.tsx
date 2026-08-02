"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  getNotificationPreferences,
  playNotificationSound,
  setNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notification-preferences";

type PermissionState = "granted" | "denied" | "default" | "unsupported";

function getPermissionState(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Sound + browser-notification preferences — one shared component
 * embedded in two places (per the approved plan): a compact popover next
 * to the bell in the shared header (components/app-shell-client.tsx,
 * reaches both /dashboard and /admin — there is no /admin/settings today)
 * and a fuller inline card on app/dashboard/settings/page.tsx. Preferences
 * live in localStorage (lib/notification-preferences.ts) — read only after
 * mount to avoid an SSR/client hydration mismatch (the server has no
 * localStorage to read from).
 *
 * Notification.requestPermission() is called ONLY from the button's own
 * onClick — never on mount/effect — per the explicit requirement that a
 * user must never see a permission prompt before they asked for one.
 *
 * `soundAvailable` (computed server-side, see lib/notification-sound-
 * availability.ts) reflects whether a real /public/sounds/notification.mp3
 * has been supplied yet — it hasn't as of this feature's initial deploy.
 * Rather than let a click silently do nothing (playNotificationSound()
 * already no-ops gracefully on a missing file), the test button is
 * disabled outright with a clear "coming soon" message — never blocks
 * deployment, never a broken-looking control.
 */
export function NotificationPreferencesControl({
  locale,
  variant = "full",
  soundAvailable,
}: {
  locale: Locale;
  variant?: "full" | "compact";
  soundAvailable: boolean;
}) {
  const t = dictionaries[locale].settings.notificationPreferences;
  // Both default to the SSR-safe value (localStorage/Notification.permission
  // don't exist server-side) so the client's first render matches the
  // server's — no hydration mismatch — and the effect below fills in the
  // real values right after mount, same one-time-browser-API-read pattern
  // already established in app/error.tsx.
  const [prefs, setPrefs] = useState<NotificationPreferences>({ soundEnabled: true, browserNotificationsEnabled: false });
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(getNotificationPreferences());
    setPermission(getPermissionState());
  }, []);

  useEffect(() => {
    if (variant !== "compact") return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [variant]);

  function toggleSound() {
    setPrefs(setNotificationPreferences({ soundEnabled: !prefs.soundEnabled }));
  }

  async function requestBrowserPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    setPrefs(setNotificationPreferences({ browserNotificationsEnabled: result === "granted" }));
  }

  const body = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-pm-noir">{t.soundLabel}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!soundAvailable}
            title={soundAvailable ? undefined : t.soundComingSoon}
            onClick={() => void playNotificationSound()}
            className="rounded-full border border-pm-gris-2 px-3 py-1 text-xs text-pm-noir transition hover:bg-pm-gris-2/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {t.testSound}
          </button>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={prefs.soundEnabled}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              prefs.soundEnabled ? "bg-pm-noir text-white" : "border border-pm-gris-2 text-pm-gris hover:bg-pm-gris-2/40"
            }`}
          >
            {prefs.soundEnabled ? t.soundDisable : t.soundEnable}
          </button>
        </div>
      </div>
      {!soundAvailable && <p className="-mt-2 text-xs text-pm-gris">{t.soundComingSoon}</p>}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-pm-noir">{t.browserLabel}</span>
        {permission === "unsupported" ? (
          <span className="text-xs text-pm-gris">{t.permissionUnsupported}</span>
        ) : permission === "granted" ? (
          <span className="text-xs font-medium text-emerald-600">{t.permissionGranted}</span>
        ) : permission === "denied" ? (
          <span className="max-w-[14rem] text-right text-xs text-pm-gris">{t.permissionDenied}</span>
        ) : (
          <button
            type="button"
            onClick={() => void requestBrowserPermission()}
            className="rounded-full bg-pm-noir px-3 py-1 text-xs font-medium text-white transition hover:bg-pm-noir/90"
          >
            {t.browserEnableButton}
          </button>
        )}
      </div>
    </div>
  );

  if (variant === "full") {
    return (
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-4">
        <h3 className="text-sm font-semibold text-pm-noir">{t.title}</h3>
        <div className="mt-4">{body}</div>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.title}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-pm-gris-2 bg-white text-pm-noir transition hover:bg-pm-gris-2/40"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && <div className="absolute right-0 z-10 mt-2 w-72 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-lg">{body}</div>}
    </div>
  );
}
