import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { qaBypassAllowed } from "@/lib/qa-bypass";

// Only sign-in/sign-up, the two server-to-server endpoints that use their
// own secret-based verification (FastSpring/n8n webhook signatures,
// CRON_SECRET — see app/api/webhooks/**, app/api/cron/**), and the GBP
// Audit client portal (/audit-report/[token]) are public. The portal has
// no Clerk session by design — a prospect authenticates with the token in
// the URL, verified server-side in lib/actions/gbp-audit-portal.ts (see
// db/audit-schema.ts on gbpReportAccessLinks) — this route MUST stay
// public or a prospect could never open their own report. Everything
// else, including "/", requires a valid Clerk session.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/cron(.*)",
  "/audit-report(.*)",
  "/api/audit-report(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // TEMPORARY QA-ONLY BYPASS — removed before this session's work is done. See lib/qa-bypass.ts
  // (throws, blocking every request, if this flag is ever set outside genuine local `next dev`).
  const isAuditRoute = req.nextUrl.pathname.startsWith("/admin/audit") || req.nextUrl.pathname.startsWith("/api/gbp-audit");
  if (
    isAuditRoute &&
    qaBypassAllowed({
      qaBypassFlag: process.env.QA_BYPASS_AUDIT_AUTH,
      nodeEnv: process.env.NODE_ENV,
      vercel: process.env.VERCEL,
      host: req.headers.get("host"),
    })
  ) {
    return;
  }
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
