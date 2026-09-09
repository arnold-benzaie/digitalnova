import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { listAdminGovernanceRoster, listGovernanceHistory } from "@/lib/actions/workforce-admin-ui";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";
import { AdminRoster } from "@/components/owner/admin-roster";
import { GovernanceHistory } from "@/components/owner/governance-history";

/**
 * PHASE OWNER-UI (Slice 2) — the OWNER ADMIN-governance panel.
 *
 * Authorization is the FIRST statement, before any data read or render,
 * and is the ONLY thing that decides access:
 * requireStaffMember("OWNER_MANAGE") — granted only to OWNER
 * (lib/rbac/permissions.ts), so ADMIN / MANAGER / EMPLOYEE, a caller with
 * no staff_members row, a suspended OWNER, and a membership scoped to a
 * non-internal workspace are all redirected to /admin by
 * requireStaffMember's existing contract. The sidebar's `isOwner` signal
 * plays no part here.
 *
 * The page shows the internal workspace's ADMIN roster ONLY
 * (listAdminGovernanceRoster() filters `staff_roles.name = 'ADMIN'`), so
 * the OWNER never appears as an editable row. Every lifecycle control is a
 * client island wired to the requireStaffMember("OWNER_MANAGE")-gated
 * server actions in lib/actions/workforce-admin-ui.ts -> the authoritative
 * lib/actions/workforce-admin.ts (R2D-C). This page performs no DB write.
 *
 * No "Make OWNER", no OWNER selector, no OWNER transfer. No raw UUID is
 * rendered.
 */
export default async function OwnerControlPage() {
  await requireStaffMember("OWNER_MANAGE");

  const [roster, history, locale] = await Promise.all([
    listAdminGovernanceRoster(),
    listGovernanceHistory(),
    getLocale(),
  ]);
  const t = dictionaries[locale].ownerControl;

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />
      <AdminRoster rows={roster} locale={locale} />
      <GovernanceHistory rows={history} locale={locale} />
    </>
  );
}
