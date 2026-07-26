import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { auditDb } from "@/db/audit-index";
import {
  auditActivityLog,
  auditNotifications,
  auditProspects,
  auditStaffInvitations,
  gbpAuditFindings,
  gbpAudits,
  gbpCorrectionTasks,
  gbpQuoteRequests,
} from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { buildAuditsOverTimeSeries, daysAgo, DASHBOARD_PERIOD_OPTIONS, isDashboardPeriodDays, type DashboardPeriodDays } from "@/lib/gbp-audit/dashboard-stats";
import { AuditsOverTimeChart, FindingsBySeverityChart, StatusDistributionChart } from "@/components/gbp-audit/dashboard-charts";
import { getAuditStatusLabel, getSeverityLabel } from "@/lib/gbp-audit/checklist";
import { getActivityActionLabel } from "@/lib/gbp-audit/activity-labels";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";

const KPI_ICON = {
  prospects: "userCircle",
  notStarted: "plusCircle",
  inProgress: "trendingUp",
  pendingReview: "clock",
  sent: "fileText",
  quotes: "inbox",
  invitations: "users",
  notifications: "bell",
} as const;

export default async function GbpAuditDashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireAuditStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.dashboard;
  const statusLabel = getAuditStatusLabel(locale);
  const severityLabel = getSeverityLabel(locale);
  const activityLabel = getActivityActionLabel(locale);
  const { days: daysParam } = await searchParams;
  const days: DashboardPeriodDays = isDashboardPeriodDays(Number(daysParam)) ? (Number(daysParam) as DashboardPeriodDays) : 14;

  const [counts] = await auditDb
    .select({
      totalProspects: sql<number>`count(distinct ${auditProspects.id})::int`,
      totalAudits: sql<number>`count(distinct ${gbpAudits.id})::int`,
      notStarted: sql<number>`count(*) filter (where ${gbpAudits.status} = 'not_started')::int`,
      inProgress: sql<number>`count(*) filter (where ${gbpAudits.status} = 'in_progress')::int`,
      pendingReview: sql<number>`count(*) filter (where ${gbpAudits.status} = 'pending_review')::int`,
      sent: sql<number>`count(*) filter (where ${gbpAudits.status} = 'sent')::int`,
    })
    .from(gbpAudits)
    .innerJoin(auditProspects, eq(gbpAudits.prospectId, auditProspects.id));

  const [[{ count: pendingQuoteRequests }], [{ count: pendingInvitations }], [{ count: unreadNotifications }]] = await Promise.all([
    auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpQuoteRequests).where(eq(gbpQuoteRequests.status, "new")),
    auditDb.select({ count: sql<number>`count(*)::int` }).from(auditStaffInvitations).where(eq(auditStaffInvitations.status, "pending")),
    auditDb
      .select({ count: sql<number>`count(*)::int` })
      .from(auditNotifications)
      .where(and(eq(auditNotifications.recipientUserId, session.userId), sql`${auditNotifications.readAt} is null`)),
  ]);

  const kpis = [
    { label: t.kpis.prospects, value: counts?.totalProspects ?? 0, icon: KPI_ICON.prospects },
    { label: t.kpis.notStarted, value: counts?.notStarted ?? 0, icon: KPI_ICON.notStarted },
    { label: t.kpis.inProgress, value: counts?.inProgress ?? 0, icon: KPI_ICON.inProgress },
    { label: t.kpis.pendingReview, value: counts?.pendingReview ?? 0, icon: KPI_ICON.pendingReview },
    { label: t.kpis.sent, value: counts?.sent ?? 0, href: "/admin/audit/rapports", icon: KPI_ICON.sent },
    { label: t.kpis.quotes, value: pendingQuoteRequests, href: "/admin/audit/devis", icon: KPI_ICON.quotes },
    { label: t.kpis.invitations, value: pendingInvitations, href: "/admin/audit/equipe", icon: KPI_ICON.invitations },
    { label: t.kpis.notifications, value: unreadNotifications, href: "/admin/audit/notifications", icon: KPI_ICON.notifications },
  ];

  // Audits created per day, over the selected period.
  const recentAudits = await auditDb.select({ createdAt: gbpAudits.createdAt }).from(gbpAudits).where(gte(gbpAudits.createdAt, daysAgo(days)));
  const auditsOverTime = buildAuditsOverTimeSeries(recentAudits, days);

  // Findings by severity (issues only, not compliant/n-a/n-v).
  const findings = await auditDb
    .select({ severity: gbpAuditFindings.severity })
    .from(gbpAuditFindings)
    .where(and(sql`${gbpAuditFindings.severity} is not null`, sql`${gbpAuditFindings.result} != 'compliant'`));
  const severityCounts = new Map<string, number>();
  for (const f of findings) {
    if (!f.severity) continue;
    severityCounts.set(f.severity, (severityCounts.get(f.severity) ?? 0) + 1);
  }
  const findingsBySeverity = (["critical", "important", "moderate", "opportunity"] as const)
    .map((severity) => ({ severity, label: severityLabel[severity], count: severityCounts.get(severity) ?? 0 }))
    .filter((s) => s.count > 0);

  // Status distribution across all audits.
  const allAudits = await auditDb.select({ status: gbpAudits.status }).from(gbpAudits);
  const statusCounts = new Map<string, number>();
  for (const a of allAudits) statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
  const statusDistribution = Object.entries(statusLabel).map(([status, label]) => ({ status: label, count: statusCounts.get(status) ?? 0 }));

  // Recent activity feed.
  const recentActivity = await auditDb.select().from(auditActivityLog).orderBy(desc(auditActivityLog.createdAt)).limit(10);

  // Priority correction tasks (not done, critical/important first).
  const priorityTasks = await auditDb
    .select()
    .from(gbpCorrectionTasks)
    .where(sql`${gbpCorrectionTasks.status} != 'done'`)
    .orderBy(sql`case ${gbpCorrectionTasks.priority} when 'critical' then 0 when 'important' then 1 when 'moderate' then 2 else 3 end`)
    .limit(8);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{dictionaries[locale].navigation.items.dashboard}</h1>
          <p className="mt-1 text-sm text-pm-gris">{t.greeting(session.fullName ?? session.email)}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/admin/audit/liste"
            className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition-colors hover:bg-pm-gris-2/30"
          >
            {t.viewAllAudits}
          </Link>
          <Link
            href="/admin/audit/nouveau"
            className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pm-noir-2"
          >
            {t.newAudit}
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        {kpis.map((kpi) => {
          const Icon = NAV_ICONS[kpi.icon];
          const card = (
            <div className="rounded-2xl border border-pm-gris-2 bg-white p-4 transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-2xl font-semibold text-pm-noir tabular-nums">{kpi.value}</p>
                <Icon className="text-pm-gris/60" width={16} height={16} />
              </div>
              <p className="mt-1 text-xs text-pm-gris">{kpi.label}</p>
            </div>
          );
          return kpi.href ? (
            <Link key={kpi.label} href={kpi.href}>
              {card}
            </Link>
          ) : (
            <div key={kpi.label}>{card}</div>
          );
        })}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-base font-semibold text-pm-noir">{t.auditsOverTime(days)}</h2>
            <div className="flex gap-1 rounded-lg bg-pm-gris-2/30 p-1">
              {DASHBOARD_PERIOD_OPTIONS.map((option) => (
                <Link
                  key={option}
                  href={`/admin/audit?days=${option}`}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    days === option ? "bg-white text-pm-noir shadow-sm" : "text-pm-gris hover:text-pm-noir"
                  }`}
                >
                  {option}{t.periodSuffix}
                </Link>
              ))}
            </div>
          </div>
          <AuditsOverTimeChart data={auditsOverTime} locale={locale} />
        </div>
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-base font-semibold text-pm-noir">{t.topFindings}</h2>
          {findingsBySeverity.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.noFindings}</p>
          ) : (
            <FindingsBySeverityChart data={findingsBySeverity} locale={locale} />
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-base font-semibold text-pm-noir">{t.statusDistribution}</h2>
          <StatusDistributionChart data={statusDistribution} locale={locale} />
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-base font-semibold text-pm-noir">{t.priorityTasks}</h2>
          {priorityTasks.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.noPriorityTasks}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {priorityTasks.map((task) => (
                <li key={task.id} className="rounded-lg border border-pm-gris-2 px-3 py-2 transition-colors hover:bg-pm-gris-2/20">
                  <Link href={`/admin/audit/${task.auditId}/plan-correction`} className="text-sm font-medium text-pm-noir hover:underline">
                    {task.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-pm-gris">
                    {severityLabel[task.priority as keyof typeof severityLabel] ?? t.priorityFallback}
                    {task.ownerName ? ` · ${task.ownerName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-base font-semibold text-pm-noir">{t.recentActivity}</h2>
          {recentActivity.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.noActivity}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {recentActivity.map((a) => (
                <li key={a.id} className="text-xs text-pm-gris">
                  <span className="font-medium text-pm-noir">{activityLabel[a.action] ?? t.activityFallback}</span>
                  <span className="ml-1">{formatDateTime(a.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
