import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireInternalStaff } from "@/lib/admin-access";
import { isCurrentUserOwner, canCurrentUserManageWorkforce } from "@/lib/rbac/require-staff-member";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // PHASE 2A.0 — segment-level backstop. requireInternalStaff() keeps the
  // exact redirect behavior getDevRole() had for the unauthenticated /
  // pending / refused / suspended states, and additionally fails closed
  // for `client` (-> /dashboard) so a future admin page that forgets its
  // own requireStaffRole() is still not client-reachable. Each child page
  // keeps its own requireStaffRole()/requireAdminRole() — this does not
  // replace them. Returns the same non-client role AppShell needs.
  const role = await requireInternalStaff();
  // PHASE OWNER-UI-1 / OWNER-UI-3B — additional, non-authorizing visibility
  // signals for conditional nav entries. Purely additive: neither changes
  // requireInternalStaff()'s own access behavior above, and neither is
  // itself a gate — /admin/owner and /admin/workforce each re-check their
  // own permission server-side (requireStaffMember("OWNER_MANAGE") /
  // requireStaffMember("WORKFORCE_MANAGE")). Both are resolved on the new
  // internal-staff RBAC axis (staff_members/staff_roles), independent of
  // the legacy role requireInternalStaff() returns. `canManageWorkforce`
  // is derived from the WORKFORCE_MANAGE permission catalogue only — never
  // from `role`, `isOwner`, an email, or any client value.
  const [isOwner, canManageWorkforce] = await Promise.all([isCurrentUserOwner(), canCurrentUserManageWorkforce()]);
  return (
    <AppShell role={role} isOwner={isOwner} canManageWorkforce={canManageWorkforce}>
      {children}
    </AppShell>
  );
}
