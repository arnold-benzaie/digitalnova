import type { Metadata } from "next";
import Image from "next/image";
import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { APP_NAME } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { LanguageSwitcher } from "@/components/language-switcher";
import { CheckBulletIcon, ExternalLinkIcon, MailIcon, PendingApprovalIcon } from "@/components/icons/access-pending-icons";

const CONTACT_EMAIL = "contact@public-map.com";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title =
    locale === "en"
      ? `Account awaiting approval — ${APP_NAME}`
      : `Compte en attente d'autorisation — ${APP_NAME}`;
  return { title };
}

/**
 * Landing spot for "authenticated with Clerk, but no role/membership yet"
 * (see requireSession() in lib/session.ts and requireAuditSession() in
 * lib/gbp-audit/session.ts) — replaces the old raw "Accès refusé" throw.
 * Deliberately does NOT call requireSession()/getCurrentSession() itself:
 * this page must render for exactly the users those functions redirect
 * here, so re-checking here would either be a no-op or, if it ever
 * disagreed, a redirect loop. proxy.ts's clerkMiddleware already ensures
 * only authenticated requests reach this route at all — currentUser()
 * below is a read of the already-established Clerk session (same call
 * lib/session.ts makes), purely for a "Bonjour {firstName}," greeting,
 * not an access decision.
 *
 * Bilingual per lib/i18n/dictionaries.ts: getLocale() auto-detects from
 * the browser's Accept-Language header (falling back to French, this
 * app's only language everywhere else), and the LanguageSwitcher below
 * lets the visitor override that — the override is what setLocale() then
 * remembers via cookie for later visits.
 *
 * Dark mode is scoped to this page only (see .pm-auth-page in
 * globals.css) — nothing else in the app supports it yet.
 */
export default async function AccessPendingPage() {
  const [locale, user] = await Promise.all([getLocale(), currentUser()]);
  const t = dictionaries[locale].accessPending;
  const firstName = user?.firstName ?? null;

  return (
    <main className="pm-auth-page flex min-h-screen flex-col items-center justify-center bg-[var(--surface-bg)] px-4 py-10 sm:px-6 sm:py-14">
      <div className="animate-auth-card-in w-full max-w-md rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-6 text-center shadow-xl shadow-black/[0.04] sm:p-8">
        <Image
          src="/brand/public-map-logo.png"
          alt={APP_NAME}
          width={500}
          height={174}
          className="mx-auto h-auto w-32 sm:w-36"
          priority
        />

        <PendingApprovalIcon className="mx-auto mt-6 text-[var(--surface-ink)]" />

        <p className="mt-5 text-sm font-medium text-[var(--surface-muted)]">{t.greeting(firstName)}</p>
        <h1 className="mt-1 text-balance font-serif text-2xl font-semibold text-[var(--surface-ink)] sm:text-[1.75rem]">
          {t.welcomeTitle(APP_NAME)}
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-[var(--surface-ink)]">{t.lead}</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--surface-muted)]">{t.body}</p>

        <div className="mt-6 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-chip)] p-4 text-left">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--surface-muted)]">{t.infoTitle}</h2>
          <ul className="mt-3 space-y-2.5">
            {t.infoItems.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-[var(--surface-ink)]">
                <CheckBulletIcon className="mt-0.5 shrink-0 text-pm-rouge" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-7 flex flex-col gap-2.5">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="rounded-lg bg-[var(--surface-primary-bg)] px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[var(--surface-primary-ink)] transition hover:bg-[var(--surface-primary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2"
          >
            {t.contact(APP_NAME)}
          </a>

          <a
            href="https://www.public-map.com"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--surface-border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[var(--surface-ink)] transition hover:bg-[var(--surface-chip)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2"
          >
            {t.backToSite(APP_NAME)}
            <ExternalLinkIcon />
          </a>

          <SignOutButton redirectUrl="/sign-in">
            <button className="mt-1 rounded text-xs font-medium text-[var(--surface-muted)] underline-offset-4 transition hover:text-[var(--surface-ink)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2">
              {t.signOut}
            </button>
          </SignOutButton>
        </div>

        <div className="mt-7 flex flex-col items-center gap-4 border-t border-[var(--surface-border)] pt-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--surface-muted)]">{t.supportLabel(APP_NAME)}</p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-1 inline-flex items-center gap-1.5 rounded text-sm text-[var(--surface-ink)] transition hover:text-pm-rouge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2"
            >
              <MailIcon />
              {CONTACT_EMAIL}
            </a>
          </div>

          <LanguageSwitcher locale={locale} redirectTo="/access-pending" />
        </div>
      </div>
    </main>
  );
}
