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
import { SEMANTIC_CLASS, SEMANTIC_DOT, taskPriorityTone, type SemanticTone } from "@/lib/gbp-audit/status-colors";
import { getActivityActionLabel } from "@/lib/gbp-audit/activity-labels";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { Badge } from "@/components/crm/badges";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

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

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default async function GbpAuditDashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireAuditStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.dashboard;
  const cp = dictionaries[locale].auditModule.correctionPlan;
  const statusLabel = getAuditStatusLabel(locale);
  const severityLabel = getSeverityLabel(locale);
  const activityLabel = getActivityActionLabel(locale);
  const { days: daysParam } = await searchParams;
  const days: DashboardPeriodDays = isDashboardPeriodDays(Number(daysParam)) ? (Number(daysParam) as DashboardPeriodDays) : 14;

  const phaseTitleByNumber = new Map<number, string>(cp.phases.map((p) => [p.phase, p.title]));
  const difficultyLabel: Record<string, string> = { low: cp.form.difficultyLow, medium: cp.form.difficultyMedium, high: cp.form.difficultyHigh };

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
  const now = new Date();
  const activityGroups: { key: string; label: string; items: typeof recentActivity }[] = [];
  for (const item of recentActivity) {
    const dayLabel = isSameDay(item.createdAt, now) ? t.today : formatDate(item.createdAt, locale);
    const last = activityGroups[activityGroups.length - 1];
    if (last && last.label === dayLabel) last.items.push(item);
    else activityGroups.push({ key: item.id, label: dayLabel, items: [item] });
  }

  // Priority correction tasks (not done, critical/important first) — enriched
  // with only fields already present on the row (phase, difficulty).
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
    category: `Phase ${task.phase}`,
    categoryFull: phaseTitleByNumber.get(task.phase) ?? t.priorityFallback,
    ownerName: task.ownerName,
    statusLabel: cp.taskStatus[task.status as keyof typeof cp.taskStatus] ?? task.status,
    etaDays: task.etaDays,
    difficultyLabel: difficultyLabel[task.difficulty] ?? null,
  }));

  const notificationBadgeText = unreadNotifications > 99 ? "99+" : String(unreadNotifications);
  const periodLabel = `${days}${t.periodSuffix}`;

  return (
    <>
      <div className="flex flex-col gap-5 overflow-hidden rounded-2xl border border-pm-bleu-eu/20 bg-[linear-gradient(115deg,#071b3d_0%,#0b347c_58%,#2563eb_100%)] px-5 py-6 shadow-pm-md sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-8">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-white sm:text-4xl">{dictionaries[locale].navigation.items.dashboard}</h1>
          <p className="mt-2 text-sm text-white/80">{t.greeting(session.fullName ?? session.email)}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/admin/audit/liste"
            className="rounded-lg border border-white/35 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-[background-color,border-color,box-shadow,transform] duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-pm-bleu-eu"
          >
            {t.viewAllAudits}
          </Link>
          <Link
            href="/admin/audit/nouveau"
            className="rounded-lg bg-[#2f7df6] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#438afa] hover:shadow-[0_13px_28px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 focus-visible:ring-offset-2 focus-visible:ring-offset-pm-bleu-eu"
          >
            {t.newAudit}
          </Link>
        </div>
      </div>

      {/* KPI — à date, jamais sensibles à la période */}
      <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.currentSituation}</p>
      {/* xl (1280px), not lg (1024px): KpiCard's icon badge + text-sm label are heavier than the
          original compact tile — 8 columns at exactly 1024px overflows (verified), 4 columns fits. */}
      <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
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
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-base font-semibold text-pm-noir">{t.auditsOverTime(days)}</h2>
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

        <div className="flex flex-col justify-center rounded-2xl border border-pm-g-blue/20 bg-pm-g-blue/[0.03] p-5">
          <h2 className="font-serif text-base font-semibold text-pm-noir">{t.auditsCreatedInPeriod}</h2>
          <p className="mt-0.5 text-[11px] text-pm-gris">{t.auditsCreatedInPeriodHint(periodLabel)}</p>
          <p className="mt-4 text-3xl font-bold tabular-nums text-pm-bleu-eu">{auditsCreatedComparison.currentCount}</p>
          {auditsCreatedComparison.deltaPercent === null ? (
            <p className="mt-1 text-xs text-pm-gris">{t.noPreviousPeriodData}</p>
          ) : (
            <p
              className={`mt-1 text-xs font-medium ${
                auditsCreatedComparison.direction === "up" ? "text-pm-g-green" : auditsCreatedComparison.direction === "down" ? "text-pm-rouge-2" : "text-pm-gris"
              }`}
            >
              {auditsCreatedComparison.direction === "up" ? "▲" : auditsCreatedComparison.direction === "down" ? "▼" : "—"}{" "}
              {t.vsPreviousPeriod(Math.abs(auditsCreatedComparison.deltaPercent), auditsCreatedComparison.previousCount)}
            </p>
          )}
        </div>
      </div>

      {/* Répartition + Anomalies : rangée dédiée, items-start pour que ces cartes
          courtes gardent leur propre hauteur naturelle. */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-base font-semibold text-pm-noir">{t.statusDistribution}</h2>
          <StatusDistributionChart data={statusDistribution} locale={locale} />
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

      {/* Tâches prioritaires — sa propre rangée pleine largeur, cartes compactes en grille interne */}
      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-base font-semibold text-pm-noir">{t.priorityTasks}</h2>
        {priorityTasks.length === 0 ? (
          <p className="mt-4 text-sm text-pm-gris">{t.noPriorityTasks}</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {priorityTasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/admin/audit/${task.auditId}/plan-correction`}
                  className="block rounded-xl border border-pm-gris-2 p-2.5 transition-colors hover:bg-pm-gris-2/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20"
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEMANTIC_DOT[taskPriorityTone(task.priority)]}`} aria-hidden="true" />
                    <p className="line-clamp-1 text-sm font-medium text-pm-noir">{task.title}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-4 text-[11px] text-pm-gris">
                    <Badge label={task.priorityLabel} className={`${SEMANTIC_CLASS[taskPriorityTone(task.priority)]} !px-2 !py-0.5`} />
                    <span title={task.categoryFull} className="rounded-full bg-pm-gris-2/60 px-2 py-0.5">
                      {task.category}
                    </span>
                    <span className="rounded-full bg-pm-gris-2/60 px-2 py-0.5">{task.statusLabel}</span>
                    {task.difficultyLabel && <span>· {task.difficultyLabel}</span>}
                    {task.etaDays != null && <span>· {task.etaDays} j</span>}
                    {task.ownerName && <span className="truncate">· {task.ownerName}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Activité récente + Notifications */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-base font-semibold text-pm-noir">{t.recentActivity}</h2>
          {recentActivity.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.noActivity}</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {activityGroups.map((group) => (
                <div key={group.key}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-pm-gris">{group.label}</p>
                  <ul className="flex flex-col gap-1.5">
                    {group.items.map((a) => {
                      const Icon = NAV_ICONS[activityIconNameFor(a.action)];
                      const content = (
                        <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-pm-gris-2/10">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pm-gris-2/40 text-pm-gris">
                            <Icon width={12} height={12} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-pm-noir">{a.label}</span>
                            {a.actorName && <span className="text-pm-gris"> · {a.actorName}</span>}
                          </span>
                          <span className="shrink-0 text-[11px] text-pm-gris">{formatDate(a.createdAt, locale, { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      );
                      return (
                        <li key={a.id}>
                          {a.href ? (
                            <Link href={a.href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20">
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notifications — compteur exact dans la carte, 99+ uniquement dans le badge compact existant */}
        <div className={`rounded-2xl border bg-white p-5 ${unreadNotifications > 0 ? "border-pm-rouge/25" : "border-pm-gris-2"}`}>
          <h2 className="font-serif text-base font-semibold text-pm-noir">Notifications</h2>
          <div className="mt-3 flex items-center gap-4">
            <div>
              <p className="text-3xl font-bold tabular-nums text-pm-noir">{unreadNotifications}</p>
              <p className="text-xs font-medium text-pm-gris">{t.unreadLabel}</p>
            </div>
            <span
              className={`flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                unreadNotifications > 0 ? "bg-pm-rouge text-white" : "bg-pm-gris-2/60 text-pm-gris"
              }`}
              aria-label={`${unreadNotifications} ${t.kpis.notifications}`}
              title={t.compactBadgeHint}
            >
              {notificationBadgeText}
            </span>
            <span className="ml-auto flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-pm-gris" title={t.notificationsSeverityNote}>
              <NAV_ICONS.info width={14} height={14} />
            </span>
          </div>
          <Link href="/admin/audit/notifications" className="mt-4 inline-block rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir hover:bg-pm-gris-2/30">
            {t.viewNotifications}
          </Link>
        </div>
      </div>
    </>
  );
}
