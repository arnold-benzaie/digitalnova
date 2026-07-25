/**
 * Resolves a Clerk user's ID by email, live, against whichever Clerk
 * instance CLERK_SECRET_KEY (from .env.local) currently points to — never
 * a hardcoded user ID. A hardcoded ID goes stale the moment the Clerk
 * instance changes: exactly what happened when .env.local moved from
 * Clerk's dev/test keys to Production keys mid-session — the old
 * dev-instance ID for contact@public-map.com had no meaning on the
 * Production instance, and every script/spec that hardcoded it started
 * failing with "resource_not_found". Looking the ID up by email instead
 * is resilient to any future Clerk instance/environment change, as long
 * as a user with this email still exists wherever CLERK_SECRET_KEY points.
 *
 * Plain .mjs (no TypeScript) on purpose: e2e/auth-setup.mjs is invoked
 * directly via `node e2e/auth-setup.mjs` (see .githooks/pre-commit and
 * e2e/README.md), not through Playwright's or tsx's TS loader, so this
 * helper — and anything it imports — must run under plain Node too.
 */
export async function resolveClerkUserIdByEmail(email, clerkSecret) {
  const secret = clerkSecret ?? process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY absent de .env.local");

  const res = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Échec de la recherche d'utilisateur Clerk pour "${email}": ${JSON.stringify(data.errors ?? data)}`);
  }

  // Trust the server-side filter but verify client-side too — cheap, and
  // guarantees correctness even if the API's filtering behavior changes.
  const match = (Array.isArray(data) ? data : []).find((u) =>
    (u.email_addresses ?? []).some((e) => e.email_address?.toLowerCase() === email.toLowerCase()),
  );
  if (!match) {
    throw new Error(
      `Aucun utilisateur Clerk trouvé pour "${email}" sur l'instance actuelle (celle pointée par CLERK_SECRET_KEY dans .env.local). ` +
        "Si l'instance Clerk a changé récemment (ex. bascule clés de test -> Production), ce compte doit exister sur la nouvelle instance avant de relancer les tests E2E — voir e2e/README.md.",
    );
  }
  return match.id;
}
