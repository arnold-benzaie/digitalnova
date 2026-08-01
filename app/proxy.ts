import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only sign-in/sign-up, the server-to-server endpoints that use their own
// secret-based verification (FastSpring/n8n webhook signatures,
// CRON_SECRET — see app/api/webhooks/**, app/api/cron/**), the public
// versioned REST API (its own API-key verification — see
// lib/api-v1/auth.ts's authenticateApiRequest(), called by every /api/v1
// route as its sole gate; this entry deliberately covers only that one
// prefix, not the rest of /api/**), the public developer portal
// (/developers — Stage 1 of the developer-ecosystem plan: static docs +
// the OpenAPI reference are meant to be readable by anyone, no sign-in;
// a future auth-gated Console under /developers/console will call
// requireSession() itself, same as any other authenticated page — it
// does not need this entry to change), the GBP Audit client portal
// (/audit-report/[token]), and the e2e-db-target diagnostic route (own
// NODE_ENV/VERCEL guard, see its own file) are public. The portal has no
// Clerk session by design — a prospect authenticates with the token in
// the URL, verified server-side in lib/actions/gbp-audit-portal.ts (see
// db/audit-schema.ts on gbpReportAccessLinks) — this route MUST stay
// public or a prospect could never open their own report. /invitation-link
// is a static, tokenless fallback page for the invitation email's
// secondary "copy link" button (see lib/email/invitation.ts) — reached
// by someone who by definition has no PUBLIC-MAP session yet.
// /accept-invitation (the email's primary button destination) MUST also
// stay public for the same reason — a signed-out invitee has to reach it
// without being bounced to /sign-in first — and it needs to keep working
// for an ALREADY-signed-in visitor too (it renders a different message
// in that case via Clerk's useAuth() hook client-side, see
// app/accept-invitation/accept-invitation-client.tsx), so gating it
// behind auth.protect() would defeat its purpose either way. Everything
// else, including "/", requires a valid Clerk session.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/cron(.*)",
  "/api/v1(.*)",
  "/developers(.*)",
  "/audit-report(.*)",
  "/api/audit-report(.*)",
  "/api/gbp-audit/e2e-db-target",
  // Static, non-sensitive fallback for the invitation email's secondary
  // "copy link" button (see lib/email/invitation.ts /
  // app/invitation-link/page.tsx) — no token, no email, must be reachable
  // by someone who has no PUBLIC-MAP session at all.
  "/invitation-link",
  // Invitation email's primary button destination — see the comment
  // above and app/accept-invitation/page.tsx.
  "/accept-invitation",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
