"use client";

import { SignOutButton } from "@clerk/nextjs";

// Catches the "signed in with Clerk but no membership row yet" case thrown
// by lib/session.ts (via lib/dev-role.ts / lib/dev-org.ts / lib/dev-user.ts)
// so it renders as a clear message instead of Next's generic error screen.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-pm-blanc px-6 text-center">
      <h1 className="font-serif text-2xl font-semibold text-pm-noir">Accès refusé</h1>
      <p className="max-w-md text-sm text-pm-gris">{error.message}</p>
      <SignOutButton redirectUrl="/sign-in">
        <button className="rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2">
          Se déconnecter
        </button>
      </SignOutButton>
    </main>
  );
}
