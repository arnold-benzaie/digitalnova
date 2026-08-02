#!/usr/bin/env python3
"""
Generates public/sounds/notification.wav from scratch — pure synthesis via
Python's standard `wave`/`struct`/`math` modules only, no external library,
no network access, no third-party audio sample. Nothing here is downloaded
or derived from an existing recording; every sample is computed.

Two soft sine-wave "notes" (a rising major third, C6 -> E6 — the same
pleasant, unmistakably digital interval widely used for UI confirmation
chimes) with a quick attack and an exponential decay tail, layered with a
short overlap so the second note rings while the first is still fading —
that overlap is what makes it read as one small "chime" rather than two
separate beeps. A gentle second harmonic on each note gives it a touch of
bell-like timbre instead of a flat, sterile sine tone.

Run: python3 scripts/generate-notification-sound.py
Output: public/sounds/notification.wav (mono, 16-bit PCM, 44.1kHz)
"""

import math
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 44100
NOTE1_FREQ = 1046.502  # C6
NOTE2_FREQ = 1318.510  # E6 — major third above C6
NOTE1_START = 0.0
NOTE1_DURATION = 0.38
NOTE2_START = 0.16
NOTE2_DURATION = 0.55
TOTAL_DURATION = max(NOTE1_START + NOTE1_DURATION, NOTE2_START + NOTE2_DURATION)  # ~0.71s — within the requested 0.5-1.2s window
ATTACK_SECONDS = 0.008
PEAK_AMPLITUDE = 0.42  # moderate, normalized — not maxed to full scale


def envelope(t: float, duration: float) -> float:
    """Quick linear attack, then exponential decay to silence — no click at
    the start (a hard onset is what makes a synthesized tone sound harsh),
    no abrupt cutoff at the end (what would otherwise cause a pop)."""
    if t < 0 or t > duration:
        return 0.0
    if t < ATTACK_SECONDS:
        return t / ATTACK_SECONDS
    decay_t = (t - ATTACK_SECONDS) / (duration - ATTACK_SECONDS)
    # -5.5 brings the tail under ~0.4% of the note's own peak by the end of
    # its nominal duration, so the hard stop at TOTAL_DURATION lands on
    # near-silence rather than an audible tick.
    return math.exp(-5.5 * decay_t)


def note_sample(t: float, start: float, duration: float, freq: float) -> float:
    local_t = t - start
    env = envelope(local_t, duration)
    if env <= 0:
        return 0.0
    fundamental = math.sin(2 * math.pi * freq * local_t)
    # Soft second harmonic, quieter, for a touch of bell-like color rather
    # than a flat, purely electronic sine tone.
    harmonic = 0.18 * math.sin(2 * math.pi * freq * 2 * local_t)
    return env * (fundamental + harmonic)


def generate() -> bytes:
    total_samples = int(SAMPLE_RATE * TOTAL_DURATION)
    raw = []
    peak = 0.0
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        value = note_sample(t, NOTE1_START, NOTE1_DURATION, NOTE1_FREQ) + note_sample(t, NOTE2_START, NOTE2_DURATION, NOTE2_FREQ)
        raw.append(value)
        peak = max(peak, abs(value))

    # Normalize to PEAK_AMPLITUDE so the two overlapping notes never clip
    # and the result stays at a deliberately moderate, non-aggressive volume.
    scale = (PEAK_AMPLITUDE / peak) if peak > 0 else 0.0
    frames = bytearray()
    for value in raw:
        sample = int(max(-1.0, min(1.0, value * scale)) * 32767)
        frames += struct.pack("<h", sample)
    return bytes(frames)


def main() -> None:
    output_path = Path(__file__).resolve().parent.parent / "public" / "sounds" / "notification.wav"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frames = generate()
    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(frames)
    size_kb = output_path.stat().st_size / 1024
    print(f"Wrote {output_path} — {TOTAL_DURATION:.3f}s, {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
