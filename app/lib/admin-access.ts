import { redirect } from "next/navigation";
import { requireSession, legacyAppRoleForWorkforce, type AppRole } from "@/lib/session";

/**
 * PHASE 2A.0 — transitional /admin authorization BACKSTOP.
 *
 * `app/admin/layout.tsx` historically called only `getDevRole()`, which
 * resolves a session but redirects only the unauthenticated / pending /
 * refused / suspended states — it returns normally for `client`. Access
 * control for `client` therefore lived entirely in each admin page's own
 * `requireStaffRole()` call (see lib/dev-role.ts), an opt-in model where a
 * single forgotten gate on a future page would be `client`-reachable.
 *
 * This helper closes that gap at the segment boundary: mounted once in the
 * /admin layout, it makes the whole administrative tree fail closed against
 * `client` regardless of per-page discipline. It is deliberately NOT a
 * replacement for the per-page/per-action guards — those stay exactly as
 * they are. It is a second, coarser line of defense.
 *
 * It is also deliberately NOT Phase 2B RBAC. There is no rank, no
 * permission, no owner/manager/employee concept here. The transitional
 * contract is exactly today's effective model: any active non-`client`
 * identity may enter /admin; `client` may not.
 *
 * SESSION AUTHORITY UNIFICATION — this is now the exact boundary the
 * mission targeted: `session.context === "WORKFORCE"` (a real ACTIVE
 * staff_members row, Axis-C) admits the caller UNCONDITIONALLY, with NO
 * Axis-A `memberships` row required at all — the gap a pure-Workforce
 * identity used to hit here is now closed. A CLIENT-context session is
 * still excluded exactly as before (`session.role === "client"` ->
 * `/dashboard`); any other CLIENT-context role is still admitted, exactly
 * as before. The compatibility value this function returns for a
 * WORKFORCE session is NEVER a real Axis-A row — see
 * legacyAppRoleForWorkforce()'s own docstring.
 *
 * No new DB query and no new write beyond the parallel Axis-C read
 * resolveAccessState() already performs: it delegates every redirect to
 * `requireSession()` (lib/session.ts), which is wrapped in the same
 * per-request React `cache()` every admin page already awaits — so
 * calling this in the layout costs nothing a page wasn't already paying.
 */
export async function requireInternalStaff(): Promise<Exclude<AppRole, "client">> {
  // requireSession() redirects unauthenticated -> /sign-in, pending ->
  // /access-pending?ctx=pending, refused -> /access-refused, suspended ->
  // /access-suspended (all preserved verbatim from lib/session.ts), and is
  // request-cached, so this adds no query the layout's children weren't
  // already making.
  const session = await requireSession();
  if (session.context === "WORKFORCE") {
    return legacyAppRoleForWorkforce(session);
  }
  if (session.role === "client") {
    // Same destination requireStaffRole() already sends a client to
    // (lib/dev-role.ts) — a client's home is the portal, never /admin.
    redirect("/dashboard");
  }
  return session.role;
}
