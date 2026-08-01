import { getLocale } from "@/lib/i18n/locale";
import { CopyLinkClient } from "./copy-link-client";

const SIGN_UP_URL = "https://app.public-map.com/sign-up";

const COPY = {
  fr: {
    title: "Lien d'inscription PUBLIC-MAP",
    description: "Utilisez ce lien pour créer votre compte et activer votre accès à PUBLIC-MAP.",
    copyLabel: "Copier le lien",
    copiedLabel: "Lien copié",
    openLabel: "Ouvrir la page d'inscription",
  },
  en: {
    title: "PUBLIC-MAP sign-up link",
    description: "Use this link to create your account and activate your access to PUBLIC-MAP.",
    copyLabel: "Copy the link",
    copiedLabel: "Link copied",
    openLabel: "Open the sign-up page",
  },
} as const;

/**
 * Public, unauthenticated fallback for the invitation email's secondary
 * button (see lib/email/invitation.ts) — exists only because email
 * clients block JavaScript, so the actual clipboard copy has to happen
 * on a real page instead. Carries no invitation-specific data: no token,
 * no email address, nothing tied to who's viewing it — just the static
 * public sign-up URL, safe to be fully public. Does not touch Clerk or
 * claimPendingInvitation in any way; it's a plain content page.
 */
export default async function InvitationLinkPage() {
  const locale = await getLocale();
  const t = COPY[locale];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-pm-blanc px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="max-w-md text-sm text-pm-gris">{t.description}</p>
      </div>

      <p className="w-full max-w-md select-all break-all rounded-lg border border-pm-gris-2 bg-white px-4 py-3 text-sm text-pm-noir">
        {SIGN_UP_URL}
      </p>

      <CopyLinkClient url={SIGN_UP_URL} copyLabel={t.copyLabel} copiedLabel={t.copiedLabel} openLabel={t.openLabel} />
    </main>
  );
}
