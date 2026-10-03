"use client";

import { useEffect, useState } from "react";
import { getClientLocale } from "@/lib/i18n/client-locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import { categorizeGenericError } from "@/lib/errors/categorize-generic-error";
import { reportUiError } from "@/lib/actions/report-ui-error";
import "./globals.css";

/**
 * Root-level fallback — only reached when the root layout itself throws
 * (app/error.tsx can't catch that; see Next.js docs on global-error).
 * Next.js replaces the ENTIRE root layout with this file when active, so
 * none of the root layout's providers exist here: no ClerkProvider (no
 * SignOutButton), no inherited <head>/globals.css (imported directly
 * above). Kept deliberately dependency-light for that reason — this is
 * the one place where "the rest of the app's own machinery is what just
 * broke" is a real possibility, not a hypothetical.
 *
 * Never shows error.message — unlike the segment-level app/error.tsx,
 * a root-layout failure is far more likely to originate from framework/
 * provider wiring than from "Organisation introuvable"-style expected
 * app errors, so there's no safe assumption that the message itself is
 * presentable.
 *
 * Reporting is the same fire-and-forget, never-throw pattern as
 * app/error.tsx: categorize client-side (categorizeGenericError is a
 * plain isomorphic module, safe in the browser), send only the closed
 * category label to reportUiError, and never let that call's outcome
 * affect what's rendered here.
 */
const COPY: Record<Locale, { title: string; body: string; retry: string }> = {
  fr: {
    title: "Une erreur est survenue",
    body: "Quelque chose s'est mal passé. Vous pouvez réessayer ; si le problème persiste, revenez un peu plus tard.",
    retry: "Réessayer",
  },
  en: {
    title: "Something went wrong",
    body: "Something went wrong. You can try again; if the problem persists, please come back a little later.",
    retry: "Try again",
  },
};

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [locale, setLocaleState] = useState<Locale>("fr");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(getClientLocale());
  }, []);

  useEffect(() => {
    const category = categorizeGenericError(error);
    const pathname = typeof window !== "undefined" ? window.location.pathname : "unknown";
    void reportUiError(category, pathname);
  }, [error]);

  const t = COPY[locale];

  return (
    <html lang={locale}>
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-pm-blanc px-6 text-center">
          <h1 className="font-serif text-2xl font-semibold text-pm-noir">{t.title}</h1>
          <p className="max-w-md text-sm text-pm-gris">{t.body}</p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2"
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
