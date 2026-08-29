import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireInternalStaff } from "@/lib/admin-access";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // PHASE 2A.0 — segment-level backstop. requireInternalStaff() keeps the
  // exact redirect behavior getDevRole() had for the unauthenticated /
  // pending / refused / suspended states, and additionally fails closed
  // for `client` (-> /dashboard) so a future admin page that forgets its
  // own requireStaffRole() is still not client-reachable. Each child page
  // keeps its own requireStaffRole()/requireAdminRole() — this does not
  // replace them. Returns the same non-client role AppShell needs.
  const role = await requireInternalStaff();
  return <AppShell role={role}>{children}</AppShell>;
}
