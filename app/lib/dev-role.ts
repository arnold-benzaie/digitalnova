import { redirect } from "next/navigation";
import { requireSession, legacyAppRoleForWorkforce, type AppRole } from "@/lib/session";

export type DevRole = AppRole;

/**
 * Returns the signed-in user's role, in the legacy Axis-A `AppRole` shape
 * this function's ~30 callers still expect. Resolved from Clerk + the
 * unified session (lib/session.ts::requireSession()) — for a CLIENT
 * session this is the real, authoritative Axis-A role; for a WORKFORCE
 * session (SESSION AUTHORITY UNIFICATION) there is no Axis-A role at all,
 * so `legacyAppRoleForWorkforce()` supplies a compatibility value that
 * preserves this function's exact current privilege boundary (see that
 * function's own docstring) — it is never a real Axis-A row and is never
 * written back to one. Redirects — rather than silently defaulting to
 * "client" — when the caller is authenticated with Clerk but has neither
 * a membership row nor an active staff_members row: there is no
 * self-service role assignment in this app, so "no access in either axis"
 * must never fall back to any access at all. See requireSession() for the
 * exact unauthenticated vs. no-access redirect targets.
 */
export async function getDevRole(): Promise<DevRole> {
  const session = await requireSession();
  return session.context === "WORKFORCE" ? legacyAppRoleForWorkforce(session) : session.role;
}

/**
 * A layout can't stop a child page from rendering (and fetching data) —
 * Next resolves the whole matched segment tree regardless of what the
 * layout does with `children`. So the gate has to live in each admin page
 * itself, before any query runs, not just in admin/layout.tsx.
 */
export async function requireStaffRole(): Promise<Exclude<DevRole, "client">> {
  const role = await getDevRole();
  if (role === "client") {
    redirect("/dashboard");
  }
  return role;
}

/**
 * User/role management (invite, change role, revoke access) is admin-only —
 * staff can see the rest of the CRM but must not be able to grant
 * themselves or others elevated access.
 */
export async function requireAdminRole(): Promise<"admin"> {
  const role = await requireStaffRole();
  if (role !== "admin") {
    redirect("/admin");
  }
  return role;
}
