import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type DevRole = "client" | "staff" | "admin";

export const DEV_ROLE_COOKIE = "pm_dev_role";
const DEFAULT_ROLE: DevRole = "client";

/**
 * Clerk is temporarily disabled (no valid API keys in .env.local yet), so
 * there is no real signed-in user/role to read. This cookie-based switcher
 * stands in for the real Clerk session + roles/memberships DB lookup until
 * auth comes back online — replace this with that lookup then, and delete
 * this file, dev-role-actions.ts, and <RoleSwitcher>.
 */
export async function getDevRole(): Promise<DevRole> {
  const store = await cookies();
  const value = store.get(DEV_ROLE_COOKIE)?.value;
  return value === "staff" || value === "admin" ? value : DEFAULT_ROLE;
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
