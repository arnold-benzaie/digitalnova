import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { auditDb } from "@/db/audit-index";
import {
  auditActivityLog,
  auditNotifications,
  auditProspects,
  auditStaffInvitations,
  auditStaffUsers,
  gbpAuditFindings,
  gbpAudits,
  gbpCorrectionTasks,
  gbpQuoteRequests,
} from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import {
  activityIconNameFor,
  buildAuditsOverTimeSeries,
  daysAgo,
  DASHBOARD_PERIOD_OPTIONS,
  getAuditsCreatedPeriodComparison,
  isDashboardPeriodDays,
  resolveActivityHref,
  type DashboardPeriodDays,
} from "@/lib/gbp-audit/dashboard-stats";
import { AuditsOverTimeChart, FindingsBySeverityChart, StatusDistributionChart } from "@/components/gbp-audit/dashboard-charts";
import { getAuditStatusLabel, getSeverityLabel } from "@/lib/gbp-audit/checklist";
import { SEMANTIC_DOT, taskPriorityTone, type SemanticTone } from "@/lib/gbp-audit/status-colors";
import { getActivityActionLabel } from "@/lib/gbp-audit/activity-labels";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatRelativeTime } from "@/lib/i18n/format";
import { AdminPageHero, heroPrimaryButtonClass, heroSecondaryButtonClass, panelClass, panelTitleClass } from "@/components/admin/page-hero";

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

  const kpis: { key: string; label: string; value: number; href?: string; icon: keyof typeof NAV_ICONS; tone: SemanticTone }[] = [
    { key: "prospects", label: t.kpis.prospects, value: counts?.totalProspects ?? 0, icon: KPI_ICON.prospects, tone: "info" },
    { key: "notStarted", label: t.kpis.notStarted, value: counts?.notStarted ?? 0, icon: KPI_ICON.notStarted, tone: "neutral" },
    { key: "inProgress", label: t.kpis.inProgress, value: counts?.inProgress ?? 0, icon: KPI_ICON.inProgress, tone: "info" },
    { key: "pendingReview", label: t.kpis.pendingReview, value: counts?.pendingReview ?? 0, icon: KPI_ICON.pendingReview, tone: "warm" },
    { key: "sent", label: t.kpis.sent, value: counts?.sent ?? 0, href: "/admin/audit/rapports", icon: KPI_ICON.sent, tone: "good" },
    { key: "quotes", label: t.kpis.quotes, value: pendingQuoteRequests, href: "/admin/audit/devis", icon: KPI_ICON.quotes, tone: "warm" },
    { key: "invitations", label: t.kpis.invitations, value: pendingInvitations, href: "/admin/audit/equipe", icon: KPI_ICON.invitations, tone: "info" },
    {
      key: "notifications",
      label: t.kpis.notifications,
      value: unreadNotifications,
      href: "/admin/audit/notifications",
      icon: KPI_ICON.notifications,
      tone: unreadNotifications > 0 ? "bad" : "neutral",
    },
  ];

  // Audits created per day, over the selected period.
  const recentAudits = await auditDb.select({ createdAt: gbpAudits.createdAt }).from(gbpAudits).where(gte(gbpAudits.createdAt, daysAgo(days)));
  const auditsOverTime = buildAuditsOverTimeSeries(recentAudits, days);

  // Real period-over-period comparison — distinct from the at-date KPIs above.
  const auditsCreatedComparison = await getAuditsCreatedPeriodComparison(days);

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
  const statusDistribution = Object.entries(statusLabel).map(([statusKey, label]) => ({ statusKey, status: label, count: statusCounts.get(statusKey) ?? 0 }));

  // Recent activity feed — now with the real author (join) and a real resolved link.
  const recentActivityRaw = await auditDb
    .select({
      id: auditActivityLog.id,
      action: auditActivityLog.action,
      targetType: auditActivityLog.targetType,
      targetId: auditActivityLog.targetId,
      metadata: auditActivityLog.metadata,
      createdAt: auditActivityLog.createdAt,
      actorFullName: auditStaffUsers.fullName,
      actorEmail: auditStaffUsers.email,
    })
    .from(auditActivityLog)
    .leftJoin(auditStaffUsers, eq(auditActivityLog.actorUserId, auditStaffUsers.id))
    .orderBy(desc(auditActivityLog.createdAt))
    .limit(10);
  const recentActivity = recentActivityRaw.map((a) => ({
    id: a.id,
    action: a.action,
    label: activityLabel[a.action] ?? t.activityFallback,
    actorName: a.actorFullName ?? a.actorEmail ?? null,
    createdAt: a.createdAt,
    href: resolveActivityHref(a.targetType, a.targetId, a.metadata),
  }));

  // Priority correction tasks (not done, critical/important first).
  const priorityTasksRaw = await auditDb
    .select()
    .from(gbpCorrectionTasks)
    .where(sql`${gbpCorrectionTasks.status} != 'done'`)
    .orderBy(sql`case ${gbpCorrectionTasks.priority} when 'critical' then 0 when 'important' then 1 when 'moderate' then 2 else 3 end`)
    .limit(8);
  const priorityTasks = priorityTasksRaw.map((task) => ({
    id: task.id,
    auditId: task.auditId,
    title: task.title,
    priority: task.priority,
    priorityLabel: severityLabel[task.priority as keyof typeof severityLabel] ?? t.priorityFallback,
  }));

  return (
    <>
      <AdminPageHero
        title={dictionaries[locale].navigation.items.dashboard}
        subtitle={t.greeting(session.fullName ?? session.email)}
        actions={
          <>
            <Link href="/admin/audit/liste" className={heroSecondaryButtonClass}>
              {t.viewAllAudits}
            </Link>
            <Link href="/admin/audit/nouveau" className={heroPrimaryButtonClass}>
              {t.newAudit}
            </Link>
          </>
        }
      />

      {/* KPI — à date, jamais sensibles à la période */}
      <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.currentSituation}</p>
      {/* xl (1280px), not lg (1024px): KpiCard's icon badge + text-sm label are heavier than the
          original compact tile — 8 columns at exactly 1024px overflows (verified), 4 columns fits. */}
      <div className="mt-2 grid grid-cols-2 gap-5 sm:grid-cols-4 xl:grid-cols-8">
        {kpis.map((kpi) => {
          const Icon = NAV_ICONS[kpi.icon];
          const card = <KpiCard label={kpi.label} value={kpi.value} icon={<Icon width={14} height={14} />} tone={kpi.tone} />;
          return kpi.href ? (
            <Link key={kpi.key} href={kpi.href} aria-label={kpi.key === "notifications" ? `${kpi.label} — ${kpi.value}` : undefined}>
              {card}
            </Link>
          ) : (
            <div key={kpi.key}>{card}</div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-pm-gris">{t.currentSituationHint}</p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${panelClass} lg:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className={panelTitleClass}>{t.auditsOverTime(days)}</h2>
              {auditsCreatedComparison.deltaPercent === null ? (
                <p className="mt-0.5 text-xs text-pm-gris">{t.noPreviousPeriodData}</p>
              ) : (
                <p
                  className={`mt-0.5 text-xs font-medium ${
                    auditsCreatedComparison.direction === "up" ? "text-pm-g-green" : auditsCreatedComparison.direction === "down" ? "text-pm-rouge-2" : "text-pm-gris"
                  }`}
                >
                  {auditsCreatedComparison.direction === "up" ? "▲" : auditsCreatedComparison.direction === "down" ? "▼" : "—"}{" "}
                  {t.vsPreviousPeriod(Math.abs(auditsCreatedComparison.deltaPercent), auditsCreatedComparison.previousCount)}
                </p>
              )}
            </div>
            <div className="flex gap-1 rounded-lg bg-pm-gris-2/30 p-1">
              {DASHBOARD_PERIOD_OPTIONS.map((option) => (
                <Link
                  key={option}
                  href={`/admin/audit?days=${option}`}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    days === option ? "bg-pm-g-blue/10 text-pm-bleu-eu shadow-sm" : "text-pm-gris hover:bg-white/70 hover:text-pm-noir"
                  }`}
                  aria-current={days === option ? "true" : undefined}
                >
                  {option}{t.periodSuffix}
                </Link>
              ))}
            </div>
          </div>
          <AuditsOverTimeChart data={auditsOverTime} locale={locale} />
        </div>

        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.topFindings}</h2>
          {findingsBySeverity.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.noFindings}</p>
          ) : (
            <FindingsBySeverityChart data={findingsBySeverity} locale={locale} />
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.statusDistribution}</h2>
          <StatusDistributionChart data={statusDistribution} locale={locale} />
        </div>

        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.priorityTasks}</h2>
          {priorityTasks.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.noPriorityTasks}</p>
          ) : (
            <div className="mt-2">
              {priorityTasks.slice(0, 5).map((task) => (
                <Link
                  key={task.id}
                  href={`/admin/audit/${task.auditId}/plan-correction`}
                  className="flex items-center gap-3 rounded-lg border-t border-pm-gris-2 px-1.5 py-3.5 text-sm transition-colors first:border-t-0 hover:bg-pm-gris-2/15"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SEMANTIC_DOT[taskPriorityTone(task.priority)]}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-pm-noir">{task.title}</span>
                    <span className="block text-xs text-pm-gris">{task.priorityLabel}</span>
                  </span>
                  <span className="text-lg text-pm-gris" aria-hidden="true">›</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.recentActivity}</h2>
          {recentActivity.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.noActivity}</p>
          ) : (
            <div className="mt-2">
              {recentActivity.slice(0, 5).map((a) => {
                const Icon = NAV_ICONS[activityIconNameFor(a.action)];
                const content = (
                  <div className="flex items-center gap-3 border-t border-pm-gris-2 py-3.5 text-sm transition-colors first:border-t-0 hover:bg-pm-gris-2/10">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-pm-g-blue/10 text-pm-bleu-eu">
                      <Icon width={14} height={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-pm-noir">{a.label}</span>
                      {a.actorName && <span className="block truncate text-xs text-pm-gris">{a.actorName}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-pm-gris">{formatRelativeTime(a.createdAt, locale)}</span>
                  </div>
                );
                return (
                  <div key={a.id}>
                    {a.href ? (
                      <Link href={a.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className={`mt-6 flex items-center justify-between gap-4 rounded-2xl border bg-white px-6 py-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)] ${
          unreadNotifications > 0 ? "border-pm-rouge/25" : "border-pm-gris-2 hover:border-[#d9e3ef]"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              unreadNotifications > 0 ? "bg-pm-rouge/10 text-pm-rouge" : "bg-pm-g-blue/10 text-pm-bleu-eu"
            }`}
            aria-hidden="true"
          >
            <NAV_ICONS.bell width={16} height={16} />
          </span>
          <div>
            <p className="text-sm font-semibold text-pm-noir">Notifications</p>
            <p className="text-xs text-pm-gris">{unreadNotifications > 0 ? t.notificationsUnreadCount(unreadNotifications) : t.notificationsEmpty}</p>
          </div>
        </div>
        <Link href="/admin/audit/notifications" className="shrink-0 text-xs font-medium text-pm-bleu-eu transition-colors hover:text-pm-g-blue-2">
          {t.viewNotifications}
        </Link>
      </div>
    </>
  );
}
