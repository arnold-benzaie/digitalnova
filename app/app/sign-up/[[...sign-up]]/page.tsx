// Clerk is temporarily disabled (no valid API keys in .env.local yet) —
// restore the <SignUp /> component here once real keys are set.
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-pm-blanc">
      <p className="text-sm text-pm-gris">
        Authentification désactivée temporairement (clés Clerk manquantes).
      </p>
    </main>
  );
}
