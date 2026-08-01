"use client";

import Link from "next/link";
import { useAuth, useClerk } from "@clerk/nextjs";
import { CopyLinkClient } from "../invitation-link/copy-link-client";

const SIGN_UP_URL = "https://app.public-map.com/sign-up";

/**
 * Branches on Clerk's own client-side session state (useAuth()'s
 * isSignedIn) — this route itself stays public (see proxy.ts), only the
 * CONTENT branches. Replaces the previous behavior of letting Clerk's
 * <SignUp/> silently redirect an already-authenticated browser straight
 * to its own dashboard: that redirect is still exactly what Clerk would
 * do on /sign-up itself (unrelated to and unchanged by this page), this
 * page just gives the person a chance to understand why and sign out
 * first, instead of landing them somewhere unexplained.
 *
 * Uses useAuth() rather than Clerk's SignedIn/SignedOut wrapper
 * components — this Clerk version doesn't export them from
 * @clerk/nextjs (confirmed against node_modules' own .d.ts files, not
 * assumed — see AGENTS.md).
 */
export function AcceptInvitationClient({
  copy,
}: {
  copy: {
    signedOutTitle: string;
    signedOutBody: string;
    createAccount: string;
    signedInBody: string;
    signOutAndContinue: string;
    copyLabel: string;
    copiedLabel: string;
    openLabel: string;
  };
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();

  // Avoids a flash of the wrong branch before Clerk resolves the actual
  // session state — genuinely brief (Clerk is already loaded app-wide
  // via the root ClerkProvider by the time this page is reachable).
  if (!isLoaded) return null;

  if (isSignedIn) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <p className="max-w-md text-sm text-pm-noir">{copy.signedInBody}</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ redirectUrl: "/sign-up" })}
          className="rounded-lg bg-pm-noir px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pm-noir-2"
        >
          {copy.signOutAndContinue}
        </button>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-semibold text-pm-noir">{copy.signedOutTitle}</h1>
        <p className="max-w-md text-sm text-pm-gris">{copy.signedOutBody}</p>
      </div>
      <Link
        href="/sign-up"
        className="rounded-lg bg-pm-noir px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pm-noir-2"
      >
        {copy.createAccount}
      </Link>
      <CopyLinkClient url={SIGN_UP_URL} copyLabel={copy.copyLabel} copiedLabel={copy.copiedLabel} openLabel={copy.openLabel} />
    </>
  );
}
