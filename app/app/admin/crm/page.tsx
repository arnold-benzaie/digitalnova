import { desc, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { calendarEvents, crmClients, deals, interactions, projects, tasks, tickets } from "@/db/schema";
import { SeedCrmButton } from "@/components/crm/seed-button";
import { requireStaffRole } from "@/lib/dev-role";

const DEAL_STAGE_LABEL: Record<string, string> = {
  new: "Nouveau",
  contacted: "Contacté",
  qualified: "Qualifié",
  proposal: "Proposition",
  won: "Gagné",
  lost: "Perdu",
};
const DEAL_STAGE_ORDER = ["new", "contacted", "qualified", "proposal", "won", "lost"];

export default async function CrmDashboardPage() {
  await requireStaffRole();

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
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">CRM</h1>
        <p className="mt-2 text-sm text-pm-gris">
          Gérez vos clients, votre pipeline commercial, vos tickets support, tâches et projets.
        </p>
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucune donnée CRM pour le moment</p>
          <p className="mt-1 text-sm text-pm-gris">
            Générez un jeu de données de démonstration pour explorer le module, ou{" "}
            <Link href="/admin/crm/clients" className="underline">
              ajoutez votre premier client
            </Link>
            .
          </p>
          <div className="mt-4 flex justify-center">
            <SeedCrmButton />
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">CRM</h1>
          <p className="mt-1 text-sm text-pm-gris">Vue d&apos;ensemble de votre activité commerciale et support.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Clients</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{allClients.length}</div>
          <p className="mt-1 text-xs text-pm-gris">
            {clientsByStage.client ?? 0} actifs · {clientsByStage.lead ?? 0} leads · {clientsByStage.prospect ?? 0}{" "}
            prospects
            {archivedClients.length > 0 && ` · ${archivedClients.length} archivé(s)`}
          </p>
        </div>
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Pipeline ouvert</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">
            {pipelineValue.toLocaleString("fr-FR")} €
          </div>
          <p className="mt-1 text-xs text-pm-gris">{openDeals.length} opportunité(s) en cours</p>
        </div>
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Tickets ouverts</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{openTickets.length}</div>
          <Link href="/admin/crm/tickets" className="mt-1 inline-block text-xs text-pm-gris underline">
            Voir les tickets
          </Link>
        </div>
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Projets actifs</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{activeProjects.length}</div>
          <p className="mt-1 text-xs text-pm-gris">{wonValue.toLocaleString("fr-FR")} € de contrats gagnés</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-pm-noir">Pipeline par étape</p>
            <Link href="/admin/crm/pipeline" className="text-xs text-pm-gris underline">
              Voir le pipeline
            </Link>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {DEAL_STAGE_ORDER.map((stage) => {
              const count = dealCountByStage[stage] ?? 0;
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-pm-gris">{DEAL_STAGE_LABEL[stage]}</span>
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

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <p className="text-sm font-medium text-pm-noir">Prochains rendez-vous</p>
          {upcomingEvents.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">Aucun événement à venir.</p>
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
                    {new Date(event.startAt).toLocaleString("fr-FR", {
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
            Voir le calendrier
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-pm-noir">Tâches à traiter</p>
            <Link href="/admin/crm/tasks" className="text-xs text-pm-gris underline">
              Voir tout
            </Link>
          </div>
          {upcomingTasks.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">Aucune tâche en attente.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {upcomingTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 text-sm">
                  <p className="text-pm-noir">{task.title}</p>
                  <span className="shrink-0 text-xs text-pm-gris">
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString("fr-FR") : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <p className="text-sm font-medium text-pm-noir">Interactions récentes</p>
          {recentInteractions.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">Aucune interaction enregistrée.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {recentInteractions.map((interaction) => (
                <div key={interaction.id} className="text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-pm-noir">{clientNameById.get(interaction.clientId)}</p>
                    <span className="shrink-0 text-xs text-pm-gris">
                      {new Date(interaction.occurredAt).toLocaleDateString("fr-FR")}
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
