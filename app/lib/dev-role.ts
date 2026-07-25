import { redirect } from "next/navigation";
import { requireSession, type AppRole } from "@/lib/session";

export type DevRole = AppRole;

/**
 * Returns the signed-in user's real role (admin/staff/client), resolved
 * from Clerk + the `memberships` table via lib/session.ts. Redirects —
 * rather than silently defaulting to "client" — when the caller is
 * authenticated with Clerk but has no membership row yet: there is no
 * self-service role assignment in this app, so "no membership" must never
 * fall back to any access at all. See requireSession() for the exact
 * unauthenticated vs. no-membership redirect targets.
 */
export async function getDevRole(): Promise<DevRole> {
  const session = await requireSession();
  return session.role;
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
