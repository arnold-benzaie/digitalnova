"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAuth, useClerk } from "@clerk/nextjs";
import { CopyLinkClient } from "../invitation-link/copy-link-client";

const SIGN_UP_URL = "https://app.public-map.com/sign-up";

/**
 * Branches on Clerk's own client-side session state (useAuth()'s
 * isSignedIn) — this route itself stays public (see proxy.ts), only the
 * CONTENT branches.
 *
 * clerkTicket (optional): forwarded from a real Clerk invitation (see
 * lib/actions/users.ts's createClerkInvitationTicket()) — preserved
 * through BOTH branches below into /sign-up's __clerk_ticket, so Clerk's
 * own ticket strategy can lock the email field there. This is why the
 * signed-in branch can't just point at a bare /sign-up: doing so would
 * silently drop the ticket (verified live — Clerk ignores a sign-up
 * ticket outright when the browser already has a different active
 * session, and just continues in that session), so the sign-out here
 * must happen FIRST, with the ticket carried into the post-sign-out
 * redirect target.
 *
 * The signed-in case auto-signs-out and redirects instead of requiring a
 * manual click (previously: an explanation + a "Sign out and continue"
 * button) — same underlying reasoning as before (avoid Clerk's <SignUp/>
 * silently redirecting an already-authenticated browser to that
 * session's own dashboard with zero explanation), but now automatic: the
 * brief message below is shown for the fraction of a second the
 * sign-out+redirect takes, not a step requiring input.
 *
 * Uses useAuth() rather than Clerk's SignedIn/SignedOut wrapper
 * components — this Clerk version doesn't export them from
 * @clerk/nextjs (confirmed against node_modules' own .d.ts files, not
 * assumed — see AGENTS.md).
 */
export function AcceptInvitationClient({
  copy,
  clerkTicket,
}: {
  copy: {
    signedOutTitle: string;
    signedOutBody: string;
    createAccount: string;
    signedInRedirecting: string;
    copyLabel: string;
    copiedLabel: string;
    openLabel: string;
  };
  clerkTicket?: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();

  const signUpPath = clerkTicket ? `/sign-up?__clerk_ticket=${encodeURIComponent(clerkTicket)}` : "/sign-up";
  const signUpUrl = clerkTicket ? `${SIGN_UP_URL}?__clerk_ticket=${encodeURIComponent(clerkTicket)}` : SIGN_UP_URL;

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      signOut({ redirectUrl: signUpPath });
    }
  }, [isLoaded, isSignedIn, signUpPath, signOut]);

  // Avoids a flash of the wrong branch before Clerk resolves the actual
  // session state — genuinely brief (Clerk is already loaded app-wide
  // via the root ClerkProvider by the time this page is reachable).
  if (!isLoaded) return null;

  if (isSignedIn) {
    return (
      <div className="flex flex-col gap-2">
        <p className="max-w-md text-sm text-pm-noir">{copy.signedInRedirecting}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-semibold text-pm-noir">{copy.signedOutTitle}</h1>
        <p className="max-w-md text-sm text-pm-gris">{copy.signedOutBody}</p>
      </div>
      <Link
        href={signUpPath}
        className="rounded-lg bg-pm-noir px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pm-noir-2"
      >
        {copy.createAccount}
      </Link>
      <CopyLinkClient url={signUpUrl} copyLabel={copy.copyLabel} copiedLabel={copy.copiedLabel} openLabel={copy.openLabel} />
    </>
  );
}
