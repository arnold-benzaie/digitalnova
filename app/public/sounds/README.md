# Notification sound

`lib/notification-preferences.ts`'s `playNotificationSound()` plays `/sounds/notification.mp3` — **that file does not exist yet and must be added here before the sound feature is actually audible.**

Requirements (per the approved notification-system plan):
- Format: `.mp3` (or `.wav`), filename exactly `notification.mp3`.
- Duration: under 2 seconds.
- A short, quiet, non-aggressive chime — not a loop, not a jingle.
- License-free / cleared for use (e.g. a CC0 asset from freesound.org, or a synthesized tone) — do not use a copyrighted sound.

The code degrades gracefully without this file: `playNotificationSound()` catches a failed/blocked `Audio.play()` silently, so a missing file never surfaces an error to the user — it just plays nothing.
