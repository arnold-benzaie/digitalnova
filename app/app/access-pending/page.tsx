import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { APP_NAME } from "@/lib/brand";
import { getAccessState } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { LanguageSwitcher } from "@/components/language-switcher";
import { CheckBulletIcon, ExternalLinkIcon, MailIcon, PendingApprovalIcon } from "@/components/icons/access-pending-icons";
import { AccessPendingClient } from "./access-pending-client";

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
 * Does NOT call requireSession() itself (that would try to redirect a
 * still-pending user back to this same page — an actual loop). Instead
 * uses getAccessState() (lib/session.ts's non-redirecting variant, same
 * resolveAccessState() underneath) and only redirects for the non-
 * "pending" outcomes — active, refused, suspended, unauthenticated —
 * which are all different destinations and can never loop back here.
 * This closes the original gap: a user landing here mid-approval, or an
 * already-approved user hitting a stale bookmark, used to sit on this
 * "pending" copy indefinitely instead of going straight to their real
 * destination. Ongoing polling for the case where the admin approves
 * *while this page is already open* is AccessPendingClient's job (see
 * access-pending-client.tsx) — this initial check only covers page load.
 * proxy.ts's clerkMiddleware already ensures only authenticated requests
 * reach this route at all — currentUser() below is a read of the
 * already-established Clerk session (same call lib/session.ts makes),
 * purely for a "Bonjour {firstName}," greeting, not an access decision.
 *
 * This page is ALSO the shared landing spot for requireAuditSession()
 * (lib/gbp-audit/session.ts) when a user is fully "active" in the MAIN app
 * (e.g. an admin) but lacks an audit_staff_memberships row — a separate
 * gate this page has no polling logic for. That case is indistinguishable
 * here from a genuine main-app approval UNLESS we know this visit came
 * from requireSession()'s own pending redirect: requireSession() marks
 * that redirect `?ctx=pending` specifically so this page can tell "just
 * resolved from a real pending wait" (safe to redirect away once active,
 * whatever the eventual role) apart from "always was active, just blocked
 * by the unrelated audit gate" (must NOT redirect away — see
 * e2e/access-pending.spec.ts's "no redirect loop" and "no audit role"
 * cases, which cover exactly this with an active admin account). Absent
 * that marker, only role === "client" is trusted to redirect on its own —
 * a client has no legitimate reason to hit the audit gate, so it's safe
 * either way, and it's the exact case this feature was reported for
 * (a newly-approved client stuck on this page). AccessPendingClient
 * (polling for admin approval WHILE this page is open) only ever mounts
 * when accessState.kind is "pending" — by construction that's always a
 * real main-app wait, never the audit-gate case, so its own "active →
 * redirect" logic needs no extra guard.
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
export default async function AccessPendingPage({ searchParams }: { searchParams: Promise<{ ctx?: string }> }) {
  const [locale, user, accessState, params] = await Promise.all([getLocale(), currentUser(), getAccessState(), searchParams]);
  const cameFromPendingGate = params.ctx === "pending";

  if (accessState.kind === "active" && (cameFromPendingGate || accessState.session.role === "client")) {
    redirect(accessState.session.role === "client" ? "/dashboard" : "/admin");
  }
  if (accessState.kind === "refused") {
    redirect("/access-refused");
  }
  if (accessState.kind === "suspended") {
    redirect("/access-suspended");
  }
  if (accessState.kind === "unauthenticated") {
    redirect("/sign-in");
  }

  const t = dictionaries[locale].accessPending;
  const firstName = user?.firstName ?? null;
  const pendingPageUrl = cameFromPendingGate ? "/access-pending?ctx=pending" : "/access-pending";

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
        {accessState.kind === "pending" && (
          <AccessPendingClient copy={{ waitingMessage: t.waitingMessage, checkingStatus: t.checkingStatus, approvedRedirecting: t.approvedRedirecting }} />
        )}

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

          <LanguageSwitcher locale={locale} redirectTo={pendingPageUrl} />
        </div>
      </div>
    </main>
  );
}
