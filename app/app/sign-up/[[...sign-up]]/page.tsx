import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-pm-blanc">
      {/* fallbackRedirectUrl only applies when Clerk itself has nowhere
          else to send the browser (no ?redirect_url, no forceRedirectUrl)
          — the normal case for a brand-new self-service signup. This is
          the ONE deliberate hook for the new /sign-up/market capture step
          (see lib/actions/signup-market.ts) — every other Clerk flow
          (invitations, sign-in) is untouched. */}
      <SignUp fallbackRedirectUrl="/sign-up/market" />
    </main>
  );
}
