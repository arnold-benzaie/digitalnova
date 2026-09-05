import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireInternalStaff } from "@/lib/admin-access";
import { isCurrentUserOwner } from "@/lib/rbac/require-staff-member";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // PHASE 2A.0 — segment-level backstop. requireInternalStaff() keeps the
  // exact redirect behavior getDevRole() had for the unauthenticated /
  // pending / refused / suspended states, and additionally fails closed
  // for `client` (-> /dashboard) so a future admin page that forgets its
  // own requireStaffRole() is still not client-reachable. Each child page
  // keeps its own requireStaffRole()/requireAdminRole() — this does not
  // replace them. Returns the same non-client role AppShell needs.
  const role = await requireInternalStaff();
  // PHASE OWNER-UI-1 — additional, non-authorizing visibility signal for a
  // future OWNER-only nav entry (OWNER-UI-2). Purely additive: does not
  // change requireInternalStaff()'s own access behavior above, and is
  // never itself a gate — the real internal-staff RBAC axis
  // (staff_members/staff_roles) is a separate identity from the legacy
  // role requireInternalStaff() resolves, so this is a second, independent
  // resolution, not a replacement.
  const isOwner = await isCurrentUserOwner();
  return (
    <AppShell role={role} isOwner={isOwner}>
      {children}
    </AppShell>
  );
}
