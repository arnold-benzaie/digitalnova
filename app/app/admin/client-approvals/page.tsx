import {
  requireEmployeeForClientApprovals,
  listPendingClientApprovals,
  listRecentlyApprovedClientConnections,
  listClientOrganizations,
} from "@/lib/actions/client-connection-approval";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";
import { ClientConnectionApprovals } from "@/components/crm/client-connection-approvals";

/**
 * MISSION RADAR/CLIENT APPROVAL — PHASE 2 — EMPLOYEE-only dedicated
 * surface for approving pending CLIENT accounts.
 *
 * Authorization is the FIRST statement and the ONLY thing that decides
 * access: requireEmployeeForClientApprovals() (lib/actions/client-
 * connection-approval.ts) redirects any non-ACTIVE-EMPLOYEE caller to
 * /admin. Every query below independently re-verifies the same identity —
 * this page never trusts its own gate as a substitute for each function's
 * own check.
 *
 * OWNER/ADMIN reach the same underlying capability through the existing,
 * richer /admin/users screen — that screen is completely untouched by
 * this mission, and this page is never offered to them (the nav item is
 * EMPLOYEE-only; a direct visit still redirects them to /admin).
 */
export default async function ClientApprovalsPage() {
  await requireEmployeeForClientApprovals();

  const [pending, recentlyApproved, organizations, locale] = await Promise.all([
    listPendingClientApprovals(),
    listRecentlyApprovedClientConnections(),
    listClientOrganizations(),
    getLocale(),
  ]);
  const t = dictionaries[locale].clientApprovals;

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />
      <ClientConnectionApprovals pending={pending} recentlyApproved={recentlyApproved} organizations={organizations} locale={locale} />
    </>
  );
}
