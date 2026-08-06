import { desc, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { calendarEvents, crmClients, deals, interactions, projects, tasks, tickets } from "@/db/schema";
import { SeedCrmButton } from "@/components/crm/seed-button";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

const DEAL_STAGE_ORDER = ["new", "contacted", "qualified", "proposal", "won", "lost"];

export default async function CrmDashboardPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].crm.dashboard;

  const [allClients, archivedClients, allDeals, openTickets, upcomingTasks, activeProjects, recentInteractions, upcomingEvents] =
    await Promise.all([
      db.select().from(crmClients).where(isNull(crmClients.archivedAt)),
      db.select().from(crmClients).where(isNotNull(crmClients.archivedAt)),
      db.select().from(deals),
      db.select().from(tickets).where(inArray(tickets.status, ["open", "in_progress"])),
      db
        .select()
        .from(tasks)
        .where(ne(tasks.status, "done"))
        .orderBy(tasks.dueDate)
        .limit(5),
      db.select().from(projects).where(inArray(projects.status, ["planning", "in_progress"])),
      db.select().from(interactions).orderBy(desc(interactions.occurredAt)).limit(5),
      db
        .select()
        .from(calendarEvents)
        .where(gte(calendarEvents.startAt, new Date()))
        .orderBy(calendarEvents.startAt)
        .limit(5),
    ]);

  if (allClients.length === 0 && archivedClients.length === 0) {
    return (
      <>
        <AdminPageHero title={t.title} subtitle={t.subtitle} />
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.emptyTitle}</p>
          <p className="mt-1 text-sm text-pm-gris">
            {t.emptyDescriptionPrefix}{" "}
            <Link href="/admin/crm/clients" className="underline">
              {t.emptyDescriptionLink}
            </Link>
            .
          </p>
          <div className="mt-4 flex justify-center">
            <SeedCrmButton locale={locale} />
          </div>
        </div>
      </>
    );
  }

  const clientsByStage = allClients.reduce<Record<string, number>>((acc, c) => {
    acc[c.stage] = (acc[c.stage] ?? 0) + 1;
    return acc;
  }, {});

  const openDeals = allDeals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const pipelineValue = openDeals.reduce((sum, d) => sum + d.valueEuros, 0);
  const wonValue = allDeals.filter((d) => d.stage === "won").reduce((sum, d) => sum + d.valueEuros, 0);

  const dealCountByStage = allDeals.reduce<Record<string, number>>((acc, d) => {
    acc[d.stage] = (acc[d.stage] ?? 0) + 1;
    return acc;
  }, {});
  const maxStageCount = Math.max(1, ...Object.values(dealCountByStage));

  const clientNameById = new Map([...allClients, ...archivedClients].map((c) => [c.id, c.name]));

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.overviewSubtitle} />

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t.cards.clients}
          value={allClients.length}
          icon={<NAV_ICONS.users width={14} height={14} />}
          tone="info"
          footer={
            <p className="mt-1 text-xs text-pm-gris">
              {t.cards.clientsSummary(clientsByStage.client ?? 0, clientsByStage.lead ?? 0, clientsByStage.prospect ?? 0, archivedClients.length)}
            </p>
          }
        />
        <KpiCard
          label={t.cards.openPipeline}
          value={`${formatNumber(pipelineValue, locale)} €`}
          icon={<NAV_ICONS.creditCard width={14} height={14} />}
          tone="good"
          footer={<p className="mt-1 text-xs text-pm-gris">{t.cards.openDealsSummary(openDeals.length)}</p>}
        />
        <KpiCard
          label={t.cards.openTickets}
          value={openTickets.length}
          icon={<NAV_ICONS.lifeBuoy width={14} height={14} />}
          tone="warm"
          footer={
            <Link href="/admin/crm/tickets" className="mt-1 inline-block text-xs text-pm-gris underline">
              {t.cards.viewTickets}
            </Link>
          }
        />
        <KpiCard
          label={t.cards.activeProjects}
          value={activeProjects.length}
          icon={<NAV_ICONS.briefcase width={14} height={14} />}
          tone="info"
          footer={<p className="mt-1 text-xs text-pm-gris">{t.cards.wonValueSummary(`${formatNumber(wonValue, locale)} €`)}</p>}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={panelClass}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-pm-noir">{t.pipelineByStage}</p>
            <Link href="/admin/crm/pipeline" className="text-xs text-pm-gris underline">
              {t.viewPipeline}
            </Link>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {DEAL_STAGE_ORDER.map((stage) => {
              const count = dealCountByStage[stage] ?? 0;
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-pm-gris">{t.dealStageLabel[stage]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-pm-gris-2/40">
                    <div
                      className="h-full rounded-full bg-pm-noir"
                      style={{ width: `${(count / maxStageCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-4 shrink-0 text-right text-xs text-pm-noir">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className={panelClass}>
          <p className="text-sm font-medium text-pm-noir">{t.upcomingEvents}</p>
          {upcomingEvents.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">{t.noUpcomingEvents}</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {upcomingEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-pm-noir">{event.title}</p>
                    {event.clientId && (
                      <p className="text-xs text-pm-gris">{clientNameById.get(event.clientId)}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-pm-gris">
                    {formatDate(event.startAt, locale, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
          <Link href="/admin/crm/calendar" className="mt-3 inline-block text-xs text-pm-gris underline">
            {t.viewCalendar}
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={panelClass}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-pm-noir">{t.pendingTasks}</p>
            <Link href="/admin/crm/tasks" className="text-xs text-pm-gris underline">
              {t.viewAll}
            </Link>
          </div>
          {upcomingTasks.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">{t.noPendingTasks}</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {upcomingTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 text-sm">
                  <p className="text-pm-noir">{task.title}</p>
                  <span className="shrink-0 text-xs text-pm-gris">
                    {task.dueDate ? formatDate(task.dueDate, locale) : t.noValue}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={panelClass}>
          <p className="text-sm font-medium text-pm-noir">{t.recentInteractions}</p>
          {recentInteractions.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">{t.noRecentInteractions}</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {recentInteractions.map((interaction) => (
                <div key={interaction.id} className="text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-pm-noir">{clientNameById.get(interaction.clientId)}</p>
                    <span className="shrink-0 text-xs text-pm-gris">
                      {formatDate(interaction.occurredAt, locale)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-pm-gris">{interaction.summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
