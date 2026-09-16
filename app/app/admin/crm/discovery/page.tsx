import { requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";
import { DiscoverySearchPanel } from "@/components/crm/discovery-search-panel";

/**
 * MISSION C-2C-1 — RADAR DISCOVERY UI.
 *
 * A separate surface from /admin/crm/radar (RADAR Core, unmodified by this
 * mission): that page scores/ranks EXISTING crm_clients rows; this one
 * searches an EXTERNAL provider (Google Places, via the Phase C-2A
 * orchestration) for NEW prospects. See components/crm/discovery-search-
 * panel.tsx's own header for the full data-discipline rationale.
 *
 * Gate: requireRadarAccess("RADAR_QUEUE_VIEW") — the SAME permission
 * searchRadarDiscovery() itself re-checks as its own first statement
 * (defense in depth, matching every other RADAR-gated page in this
 * codebase, e.g. app/admin/crm/radar/page.tsx). OWNER/ADMIN/MANAGER/
 * EMPLOYEE pass only when their own staff_members.radar_access is true;
 * CLIENT can never reach this permission (not a StaffRole at all) and is
 * redirected before any content renders. No new permission is introduced.
 *
 * This page itself performs NO search and reads NO Discovery/CRM data —
 * the entire interactive flow (form, search, pagination, results) lives
 * in the client island below, which calls searchRadarDiscovery() directly
 * on submit. There is deliberately no automatic search on load.
 */
export default async function CrmDiscoveryPage() {
  await requireRadarAccess("RADAR_QUEUE_VIEW");
  const locale = await getLocale();
  const t = dictionaries[locale].crm.discovery;

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />
      <DiscoverySearchPanel t={t} />
    </>
  );
}
