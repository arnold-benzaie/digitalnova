import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-only check for whether a real /public/sounds/notification.mp3 has
 * been supplied yet (see public/sounds/README.md — no such file exists as
 * of this feature's initial deploy; sourcing a real, short, license-free
 * chime is a separate, non-blocking follow-up). Checked once per render in
 * the server components that need it (components/app-shell.tsx, app/
 * dashboard/settings/page.tsx) and threaded down as a plain boolean prop —
 * cheaper and more reliable than a client-side existence probe, and avoids
 * a wasted network request on every page load for something that only
 * changes when a developer adds the file.
 */
export function isNotificationSoundAvailable(): boolean {
  return existsSync(join(process.cwd(), "public", "sounds", "notification.mp3"));
}
