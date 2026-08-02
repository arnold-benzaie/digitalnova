import type { Metadata } from "next";
import Image from "next/image";
import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { APP_NAME } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AccessRefusedIcon, ExternalLinkIcon, MailIcon } from "@/components/icons/access-pending-icons";
import { renderNotification } from "@/lib/i18n/notification-templates";
import { getNotificationSoundPath } from "@/lib/notification-sound-availability";
import { AccessRefusedToast } from "./access-refused-toast";

const CONTACT_EMAIL = "contact@public-map.com";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: locale === "en" ? `Access request not accepted — ${APP_NAME}` : `Demande d'accès non acceptée — ${APP_NAME}` };
}

/**
 * Landing spot for users.status === "refused" (see requireSession() in
 * lib/session.ts). Deliberately does NOT call requireSession()/
 * getCurrentSession() itself — same redirect-loop rationale as
 * /access-pending — and deliberately reveals no technical detail (no
 * mention of "status", no internal reason unless an admin chose to record
 * one, which isn't surfaced here either): just a clear, bilingual,
 * human message and a way to get in touch.
 */
export default async function AccessRefusedPage() {
  const [locale, user] = await Promise.all([getLocale(), currentUser()]);
  const t = dictionaries[locale].accessRefused;
  const firstName = user?.firstName ?? null;
  // Same copy as the "user.refused_self" notification row refuseUser()
  // creates (lib/actions/users.ts) — this toast IS that notification's
  // one-time delivery, not a second, independently-worded message.
  const toastCopy = renderNotification({ type: "user.refused_self", title: "", body: null, metadata: {} }, locale);
  const soundPath = getNotificationSoundPath();

  return (
    <main className="pm-auth-page flex min-h-screen flex-col items-center justify-center bg-[var(--surface-bg)] px-4 py-10 sm:px-6 sm:py-14">
      <AccessRefusedToast title={toastCopy.title} body={toastCopy.body} soundPath={soundPath} />
      <div className="animate-auth-card-in w-full max-w-md rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-6 text-center shadow-xl shadow-black/[0.04] sm:p-8">
        <Image src="/brand/public-map-logo.png" alt={APP_NAME} width={500} height={174} className="mx-auto h-auto w-32 sm:w-36" priority />

        <AccessRefusedIcon className="mx-auto mt-6 text-[var(--surface-ink)]" />

        <p className="mt-5 text-sm font-medium text-[var(--surface-muted)]">{t.greeting(firstName)}</p>
        <h1 className="mt-1 text-balance font-serif text-2xl font-semibold text-[var(--surface-ink)] sm:text-[1.75rem]">{t.title}</h1>

        <p className="mt-4 text-sm leading-relaxed text-[var(--surface-ink)]">{t.lead(APP_NAME)}</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--surface-muted)]">{t.body}</p>

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

          <LanguageSwitcher locale={locale} redirectTo="/access-refused" />
        </div>
      </div>
    </main>
  );
}
