"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

type Period = "morning" | "afternoon" | "evening";

function periodFromHour(hour: number): Period {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/**
 * Time-of-day dashboard greeting ("Bonjour"/"Bon après-midi"/"Bonsoir",
 * or the EN equivalents), based on the visitor's own local clock — which
 * the server can't know. Server (and this component's own first client
 * render, before hydration settles) shows the neutral, time-agnostic
 * `t.greeting` text; a `useEffect` then reads `new Date().getHours()` and
 * swaps to the period-aware text. Both renders are a single text node in
 * the same position, so this never trips a hydration mismatch — just a
 * silent upgrade a moment after paint.
 *
 * The 👋 is separate from the text (not baked into the dictionary string)
 * so it can be animated and marked `aria-hidden` — the adjacent greeting
 * text already says everything a screen reader needs.
 */
export function GreetingText({ name, locale }: { name: string | null; locale: Locale }) {
  const t = dictionaries[locale].dashboard.home;
  const [period, setPeriod] = useState<Period | null>(null);

  useEffect(() => {
    // Deferred to a callback (not called synchronously in the effect body)
    // to avoid the cascading-render this component would otherwise trigger
    // on every mount — see react-hooks/set-state-in-effect.
    const frame = requestAnimationFrame(() => setPeriod(periodFromHour(new Date().getHours())));
    return () => cancelAnimationFrame(frame);
  }, []);

  const text = period ? t.greetingByPeriod(period, name) : t.greeting(name);

  return (
    <>
      {text}{" "}
      <span className="animate-wave inline-block" aria-hidden="true">
        👋
      </span>
    </>
  );
}
