import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only sign-in/sign-up, the two server-to-server endpoints that use their
// own secret-based verification (FastSpring/n8n webhook signatures,
// CRON_SECRET — see app/api/webhooks/**, app/api/cron/**), the GBP Audit
// client portal (/audit-report/[token]), and the e2e-db-target diagnostic
// route (own NODE_ENV/VERCEL guard, see its own file) are public. The
// portal has no Clerk session by design — a prospect authenticates with
// the token in the URL, verified server-side in
// lib/actions/gbp-audit-portal.ts (see db/audit-schema.ts on
// gbpReportAccessLinks) — this route MUST stay public or a prospect could
// never open their own report. Everything else, including "/", requires a
// valid Clerk session.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/cron(.*)",
  "/audit-report(.*)",
  "/api/audit-report(.*)",
  "/api/gbp-audit/e2e-db-target",
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
