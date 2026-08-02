import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-only resolution of which notification sound asset actually exists
 * on disk, if any — /public/sounds/notification.mp3 preferred (kept as the
 * primary target in case a real MP3 is ever supplied, e.g. once ffmpeg
 * becomes available to convert notification.wav), falling back to
 * notification.wav (the one that actually exists as of this feature:
 * synthesized locally via scripts/generate-notification-sound.py, no
 * external/downloaded asset — see public/sounds/README.md). Checked once
 * per render in the server components that need it (components/app-shell.tsx,
 * app/dashboard/settings/page.tsx, app/access-refused/page.tsx) and threaded
 * down as a plain string-or-null prop — cheaper and more reliable than a
 * client-side existence probe, and it means the client never needs its own
 * "try mp3, catch, retry wav" fallback logic: the server has already
 * decided, once, which single URL is safe to request.
 */
export function getNotificationSoundPath(): string | null {
  const soundsDir = join(process.cwd(), "public", "sounds");
  if (existsSync(join(soundsDir, "notification.mp3"))) return "/sounds/notification.mp3";
  if (existsSync(join(soundsDir, "notification.wav"))) return "/sounds/notification.wav";
  return null;
}
