import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireInternalStaff } from "@/lib/admin-access";
import {
  isCurrentUserOwner,
  canCurrentUserManageWorkforce,
  canCurrentUserWorkRadar,
  canCurrentUserManageAiPolicy,
  isCurrentUserEmployeeTier,
} from "@/lib/rbac/require-staff-member";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // PHASE 2A.0 — segment-level backstop. requireInternalStaff() keeps the
  // exact redirect behavior getDevRole() had for the unauthenticated /
  // pending / refused / suspended states, and additionally fails closed
  // for `client` (-> /dashboard) so a future admin page that forgets its
  // own requireStaffRole() is still not client-reachable. Each child page
  // keeps its own requireStaffRole()/requireAdminRole() — this does not
  // replace them. Returns the same non-client role AppShell needs.
  const role = await requireInternalStaff();
  // PHASE OWNER-UI-1 / OWNER-UI-3B / EMPLOYEE-OPS / RADAR INTELLIGENCE
  // V2.1 Phase C / WORKFORCE — FINALIZE EMPLOYEE EXPERIENCE — additional,
  // non-authorizing visibility signals for conditional nav entries. Purely
  // additive: none changes requireInternalStaff()'s own access behavior
  // above, and none is itself a gate — /admin/owner, /admin/workforce,
  // /admin/crm/my-work and /admin/owner/ai-providers each re-check their
  // own permission server-side (requireStaffMember("OWNER_MANAGE") /
  // requireStaffMember("WORKFORCE_MANAGE") / requireStaffMember("RADAR_WORK")
  // / requireStaffMember("RADAR_AI_POLICY_MANAGE")); /admin/users keeps its
  // own legacy requireAdminRole() gate unchanged. All are resolved on
  // the new internal-staff RBAC axis (staff_members/staff_roles),
  // independent of the legacy role requireInternalStaff() returns, and
  // each is derived from its permission-catalogue entry only — never from
  // `role`, `isOwner`, an email, or any client value. `isEmployeeTier` is
  // the ONE flag here that HIDES a nav entry rather than adding one: the
  // "Utilisateurs" link is otherwise unconditional, but requireAdminRole()
  // already refuses EMPLOYEE on that route today (see
  // isCurrentUserEmployeeTier()'s own doc comment) — this only stops the
  // sidebar from offering a link that already redirects EMPLOYEE away.
  // OWNER/ADMIN/MANAGER's own nav is completely unaffected.
  const [isOwner, canManageWorkforce, canWorkRadar, canManageAiPolicy, isEmployeeTier] = await Promise.all([
    isCurrentUserOwner(),
    canCurrentUserManageWorkforce(),
    canCurrentUserWorkRadar(),
    canCurrentUserManageAiPolicy(),
    isCurrentUserEmployeeTier(),
  ]);
  return (
    <AppShell
      role={role}
      isOwner={isOwner}
      canManageWorkforce={canManageWorkforce}
      canWorkRadar={canWorkRadar}
      canManageAiPolicy={canManageAiPolicy}
      isEmployeeTier={isEmployeeTier}
    >
      {children}
    </AppShell>
  );
}
