"use server";

import { getAccessState } from "@/lib/session";

/**
 * Polled from app/access-pending/access-pending-client.tsx while a user
 * waits for admin approval — see lib/session.ts's getAccessState() for
 * why this reuses the exact same resolveAccessState() every other access
 * decision in the app uses, rather than a second approval check. Returns
 * a plain, minimal, serializable shape (Server Actions can't return
 * complex class instances) — `role` is only present when kind is
 * "active", enough for the client to pick /dashboard vs /admin without
 * a second round trip.
 */
export async function checkAccessStatus(): Promise<{
  kind: "unauthenticated" | "pending" | "refused" | "suspended" | "active";
  role?: string;
}> {
  const state = await getAccessState();
  if (state.kind === "active") {
    return { kind: "active", role: state.session.role };
  }
  return { kind: state.kind };
}
