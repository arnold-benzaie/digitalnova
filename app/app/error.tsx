"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { dictionaries, LOCALES, type Locale } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE } from "@/lib/i18n/shared";
import { getClientLocale } from "@/lib/i18n/client-locale";

/**
 * Generic fallback error boundary — genuinely unexpected errors only now
 * (e.g. "Organisation introuvable", a real bug). The "signed in with
 * Clerk but no membership row yet" case this used to catch is handled by
 * requireSession()/requireAuditSession() redirecting to /access-pending
 * instead of throwing (see lib/session.ts, lib/gbp-audit/session.ts) —
 * this boundary no longer sees that case at all.
 *
 * Bilingual per lib/i18n/dictionaries.ts. Locale is resolved client-side
 * (error.tsx must be a Client Component — next/headers isn't available
 * here) via getClientLocale(); starts at "fr" and updates in an effect to
 * avoid any server/client render mismatch, then the switcher below writes
 * the same pm_locale cookie lib/actions/locale.ts's setLocale() uses
 * elsewhere, so a choice made here still sticks on other pages.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [locale, setLocaleState] = useState<Locale>("fr");
  useEffect(() => {
    // One-time read of a browser-only API (cookie/navigator.language) after
    // mount — starting at "fr" and updating here (rather than a lazy
    // useState initializer) is deliberate: error.tsx can be part of the
    // server-rendered error HTML, and a lazy initializer would run
    // differently on the server (no document/navigator) vs the client,
    // causing a hydration mismatch. This runs once, not on every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(getClientLocale());
  }, []);
  const t = dictionaries[locale].accessDenied;

  function chooseLocale(next: Locale) {
    // Writing document.cookie is the standard browser API for this, not a
    // React-managed value — the react-hooks/immutability rule doesn't
    // distinguish it from mutating component state.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
    setLocaleState(next);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-pm-blanc px-6 text-center">
      <h1 className="font-serif text-2xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="max-w-md text-sm text-pm-gris">{error.message}</p>
      <SignOutButton redirectUrl="/sign-in">
        <button className="rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2">
          {t.signOut}
        </button>
      </SignOutButton>

      <div className="mt-2 flex items-center gap-3 text-xs font-medium uppercase tracking-wide">
        {LOCALES.map((option, index) => (
          <span key={option} className="flex items-center gap-3">
            {index > 0 && (
              <span className="text-pm-gris-2" aria-hidden="true">
                /
              </span>
            )}
            <button
              type="button"
              onClick={() => chooseLocale(option)}
              aria-current={option === locale ? "true" : undefined}
              disabled={option === locale}
              className={
                option === locale
                  ? "text-pm-noir underline underline-offset-4"
                  : "text-pm-gris transition hover:text-pm-noir"
              }
            >
              {option.toUpperCase()}
            </button>
          </span>
        ))}
      </div>
    </main>
  );
}
