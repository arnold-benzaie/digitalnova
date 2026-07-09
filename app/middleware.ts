import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Phase 0: everything under /dashboard requires a signed-in user.
 * Role-based restriction (admin/staff vs client) happens inside each
 * route/layout once membership lookups exist (Phase 1) — middleware only
 * gates authentication, not authorization.
 */
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
