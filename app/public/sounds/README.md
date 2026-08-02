# Notification sound

`notification.wav` is a short, original two-note digital chime (rising major third, C6 → E6), synthesized entirely locally by `scripts/generate-notification-sound.py` (Python standard library only — `wave`, `struct`, `math` — no external dependency, no downloaded or third-party audio). Regenerate it with:

```
python3 scripts/generate-notification-sound.py
```

- Duration: ~0.71s (within the 0.5–1.2s target).
- Peak amplitude: normalized to 42% of full scale — moderate, not aggressive.
- Format: mono, 16-bit PCM, 44.1kHz WAV.

No MP3 exists — this environment has no `ffmpeg` (or equivalent) available to convert it. `lib/notification-sound-availability.ts`'s `getNotificationSoundPath()` prefers `notification.mp3` if one is ever added later (e.g. once a conversion tool is available) and falls back to `notification.wav` otherwise, so dropping in a real MP3 here requires no code change.

The code degrades gracefully if neither file exists: `playNotificationSound()` (`lib/notification-preferences.ts`) only ever receives a path the server has already confirmed exists, and still catches a failed/blocked `Audio.play()` silently — a missing or blocked asset never surfaces an error to the user, it just plays nothing.
