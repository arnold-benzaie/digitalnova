import { getLocale } from "@/lib/i18n/locale";
import { AcceptInvitationClient } from "./accept-invitation-client";

const COPY = {
  fr: {
    signedOutTitle: "Accepter l'invitation",
    signedOutBody:
      "Cette invitation doit être acceptée avec l'adresse e-mail qui l'a reçue. Créez votre compte avec cette adresse pour activer votre accès automatiquement.",
    createAccount: "Créer mon compte",
    signedInRedirecting: "Vous êtes déjà connecté(e) à PUBLIC-MAP avec un autre compte. Déconnexion et redirection en cours…",
    copyLabel: "Copier le lien",
    copiedLabel: "Lien copié",
    openLabel: "Ouvrir la page d'inscription",
  },
  en: {
    signedOutTitle: "Accept invitation",
    signedOutBody:
      "This invitation must be accepted with the email address it was sent to. Create your account with that address to activate your access automatically.",
    createAccount: "Create my account",
    signedInRedirecting: "You are already signed in to PUBLIC-MAP with another account. Signing out and redirecting…",
    copyLabel: "Copy the link",
    copiedLabel: "Link copied",
    openLabel: "Open the sign-up page",
  },
} as const;

/**
 * Public destination for the invitation email's primary button (see
 * lib/email/invitation.ts) — replaces a direct link to /sign-up so an
 * already-authenticated browser gets an explanation and a way to sign
 * out, instead of Clerk's <SignUp/> silently redirecting to that
 * session's own dashboard. Carries no invitation-specific data (no
 * token, no email) — the actual matching still happens entirely by
 * email address inside claimPendingInvitation() once the real account is
 * created on /sign-up, exactly as before. This page doesn't call it,
 * doesn't touch Clerk configuration, and doesn't gate anything: it's a
 * plain public content page that branches on Clerk's own client-side
 * session state (see accept-invitation-client.tsx).
 *
 * __clerk_ticket (optional): forwarded from a real Clerk invitation link
 * (see lib/actions/users.ts's createClerkInvitationTicket()) — passed
 * through untouched to whichever /sign-up link the client component
 * renders, so Clerk's ticket strategy can lock the email field there.
 * Absent for older emails or if ticket creation failed at invite time;
 * everything below degrades to the previous plain /sign-up behavior.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ __clerk_ticket?: string }>;
}) {
  const [locale, params] = await Promise.all([getLocale(), searchParams]);
  const t = COPY[locale];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-pm-blanc px-6 text-center">
      <AcceptInvitationClient copy={t} clerkTicket={params.__clerk_ticket} />
    </main>
  );
}
