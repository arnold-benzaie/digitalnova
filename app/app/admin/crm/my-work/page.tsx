import { requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { getMyWork } from "@/lib/actions/employee-work";
import { listEmployeeColleagues } from "@/lib/actions/employee-colleagues";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";
import { MyWorkSummary } from "@/components/employee/my-work-summary";
import { MyToday } from "@/components/employee/my-today";
import { MyProspects } from "@/components/employee/my-prospects";
import { MyFollowUps } from "@/components/employee/my-follow-ups";
import { MyTasks } from "@/components/employee/my-tasks";
import { MyRecentInteractions } from "@/components/employee/my-recent-interactions";
import { AvailableProspects } from "@/components/employee/available-prospects";
import { EmployeeColleaguesPanel } from "@/components/crm/employee-colleagues-panel";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — the operational self-view for staff who
 * hold RADAR_WORK (OWNER / ADMIN / MANAGER / EMPLOYEE).
 *
 * Authorization is the FIRST statement and the ONLY thing that decides
 * access: requireRadarAccess("RADAR_WORK") — its existing contract
 * redirects to /admin for an unauthenticated / pending / no-membership /
 * inactive / permission-missing caller. getMyWork() re-checks the same
 * permission and resolves identity exclusively from the Clerk session.
 *
 * This is a SELF view. The component takes NO parameters — there is no
 * searchParams / params destructure — so nothing a caller can put in the
 * URL selects another user, workspace or role. No DB write happens here.
 * No raw userId / client / task / interaction UUID is rendered (see the
 * components/employee/* sections and my-work-shared.ts).
 *
 * WORKFORCE — EMPLOYEE "MES COLLÈGUES" (read-only) — captures the return
 * value of requireRadarAccess("RADAR_WORK") (previously discarded, exactly
 * the same pattern app/admin/crm/radar/page.tsx already uses for its own
 * "Mon équipe" panel) so the colleagues panel can be rendered ONLY when the
 * viewer's role is EMPLOYEE — never for OWNER/ADMIN/MANAGER, all of whom
 * can also reach this page via RADAR_WORK. listEmployeeColleagues() itself
 * independently re-verifies this identity server-side and would redirect
 * a non-EMPLOYEE caller anyway; this check only decides whether to even
 * fetch/render the panel, exactly like the radar page's own
 * `viewerRole === "MANAGER"` gate.
 */
export default async function MyWorkPage() {
  const viewerRole = await requireRadarAccess("RADAR_WORK");

  const [work, locale, colleagues] = await Promise.all([
    getMyWork(),
    getLocale(),
    viewerRole === "EMPLOYEE" ? listEmployeeColleagues() : Promise.resolve(null),
  ]);
  const t = dictionaries[locale].employee;

  return (
    <>
      <AdminPageHero title={t.myWorkTitle} subtitle={t.myWorkSubtitle} />

      <MyWorkSummary counts={work.counts} locale={locale} />

      <MyToday followUps={work.followUps} openTasks={work.openTasks} locale={locale} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <MyProspects prospects={work.assignedProspects} withoutFollowUp={work.prospectsWithoutFollowUp} locale={locale} />
        <MyFollowUps groups={work.followUps} locale={locale} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <MyTasks tasks={work.openTasks} locale={locale} />
        <MyRecentInteractions interactions={work.recentInteractions} locale={locale} />
      </div>

      <AvailableProspects prospects={work.claimableUnassigned} locale={locale} />

      {colleagues !== null && <EmployeeColleaguesPanel colleagues={colleagues} locale={locale} />}
    </>
  );
}
