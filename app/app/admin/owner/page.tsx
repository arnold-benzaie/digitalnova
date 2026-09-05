import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";

/**
 * PHASE OWNER-UI-2 — first visible OWNER-only control surface.
 *
 * Authorization is the FIRST statement, before any data read or render,
 * and is the ONLY thing that decides access:
 * requireStaffMember("OWNER_MANAGE") — the new internal-staff RBAC axis
 * (staff_roles / staff_members), never the legacy AppRole and never a
 * GBP-Audit role. OWNER_MANAGE is granted only to OWNER
 * (lib/rbac/permissions.ts), so ADMIN / MANAGER / EMPLOYEE, a caller with
 * no staff_members row, a suspended OWNER, and a membership scoped to a
 * non-internal workspace are all redirected to /admin by
 * requireStaffMember's existing contract. The sidebar's `isOwner` signal
 * plays no part here — a client that forges it can at most render a dead
 * link in its own browser.
 *
 * Read-only placeholder: no workforce listing/mutation, no role change,
 * no OWNER transfer, no DB write. Later slices add real capability behind
 * this same guard.
 */
export default async function OwnerControlPage() {
  await requireStaffMember("OWNER_MANAGE");

  const locale = await getLocale();
  const t = dictionaries[locale].ownerControl;

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      <div className={`mt-6 ${panelClass}`}>
        <h2 className={panelTitleClass}>{t.placeholderHeading}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-pm-gris">{t.placeholderBody}</p>
      </div>
    </>
  );
}
