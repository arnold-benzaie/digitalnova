"use client";

/**
 * Client-only, local-device notification preferences (sound, browser
 * notifications) — localStorage rather than a DB column, since no
 * per-user preferences table exists anywhere in this project today (see
 * db/schema.ts; the only related toggle, organizations.emailNotifications
 * Enabled, is org-wide, not per-user) and the feature this backs doesn't
 * need cross-device sync. A NEW convention for this codebase — no other
 * localStorage usage exists to mirror — kept deliberately small (one key,
 * one JSON blob) rather than one key per field.
 */
const STORAGE_KEY = "pm-notification-prefs";

export type NotificationPreferences = {
  soundEnabled: boolean;
  browserNotificationsEnabled: boolean;
};

const DEFAULTS: NotificationPreferences = {
  soundEnabled: true,
  browserNotificationsEnabled: false,
};

/** Never throws — private browsing / storage quota / SSR (no window) all
 * fall back to defaults rather than breaking the notification UI. */
export function getNotificationPreferences(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      soundEnabled: typeof parsed.soundEnabled === "boolean" ? parsed.soundEnabled : DEFAULTS.soundEnabled,
      browserNotificationsEnabled:
        typeof parsed.browserNotificationsEnabled === "boolean" ? parsed.browserNotificationsEnabled : DEFAULTS.browserNotificationsEnabled,
    };
  } catch {
    return DEFAULTS;
  }
}

export function setNotificationPreferences(patch: Partial<NotificationPreferences>): NotificationPreferences {
  const next = { ...getNotificationPreferences(), ...patch };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota exceeded / storage disabled — preference just won't persist
      // across reloads this session, not worth surfacing as an error.
    }
  }
  return next;
}

/**
 * Short, quiet chime — never throws, never repeats, never blocks whatever
 * called it. Browsers block autoplay before a user gesture; both that and
 * any load/decode failure degrade to a silent no-op rather than a console
 * error or a thrown exception reaching components/notification-live.tsx's
 * polling loop. `path` is resolved server-side (see lib/notification-sound-
 * availability.ts's getNotificationSoundPath()) to whichever asset actually
 * exists — this function has no fallback logic of its own and never guesses
 * a filename, so it stays correct automatically if an MP3 is added later.
 * Callers decide whether to gate this on the sound preference — the
 * "Tester le son" button intentionally calls this unconditionally, since
 * testing is the one case where playing regardless of the current
 * preference is exactly the point.
 */
export function playNotificationSound(path: string) {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  try {
    const audio = new Audio(path);
    audio.volume = 0.5;
    void audio.play().catch(() => {});
  } catch {
    // Audio() unsupported/blocked in this context — no-op.
  }
}
