import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  calendarEvents,
  contracts,
  crmClients,
  deals,
  interactions,
  projects,
  tasks,
  tickets,
} from "@/db/schema";
import {
  Badge,
  CONTRACT_STATUS_CLASS,
  CONTRACT_STATUS_LABEL,
  DEAL_STAGE_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  TASK_STATUS_OPTIONS,
  TICKET_PRIORITY_CLASS,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_OPTIONS,
} from "@/components/crm/badges";
import { ClientStageSelect, DeleteClientButton } from "@/components/crm/client-actions";
import { CreateContractForm } from "@/components/crm/create-contract-form";
import { SendContractButton, SimulateSignatureButton } from "@/components/crm/contract-actions";
import { CreateDealForm } from "@/components/crm/create-deal-form";
import { CreateEventForm } from "@/components/crm/create-event-form";
import { CreateInteractionForm } from "@/components/crm/create-interaction-form";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { CreateTaskForm } from "@/components/crm/create-task-form";
import { CreateTicketForm } from "@/components/crm/create-ticket-form";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { updateDealStage } from "@/lib/actions/crm-deals";
import { updateProjectStatus } from "@/lib/actions/crm-projects";
import { updateTaskStatus } from "@/lib/actions/crm-tasks";
import { updateTicketStatus } from "@/lib/actions/crm-tickets";
import { requireStaffRole } from "@/lib/dev-role";

export default async function CrmClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRole();
  const { id } = await params;

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1);
  if (!client) notFound();

  const [clientDeals, clientTickets, clientTasks, clientProjects, clientEvents, clientInteractions, clientContracts] =
    await Promise.all([
      db.select().from(deals).where(eq(deals.clientId, id)).orderBy(desc(deals.createdAt)),
      db.select().from(tickets).where(eq(tickets.clientId, id)).orderBy(desc(tickets.createdAt)),
      db.select().from(tasks).where(eq(tasks.clientId, id)).orderBy(desc(tasks.createdAt)),
      db.select().from(projects).where(eq(projects.clientId, id)).orderBy(desc(projects.createdAt)),
      db.select().from(calendarEvents).where(eq(calendarEvents.clientId, id)).orderBy(desc(calendarEvents.startAt)),
      db.select().from(interactions).where(eq(interactions.clientId, id)).orderBy(desc(interactions.occurredAt)),
      db.select().from(contracts).where(eq(contracts.clientId, id)).orderBy(desc(contracts.createdAt)),
    ]);

  return (
    <>
      <div className="flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{client.name}</h1>
          <div className="mt-2 flex flex-col gap-1 text-sm text-pm-gris">
            {client.contactName && <p>{client.contactName}</p>}
            {client.email && <p>{client.email}</p>}
            {client.phone && <p>{client.phone}</p>}
            {client.address && <p>{client.address}</p>}
          </div>
          {client.source && <p className="mt-2 text-xs text-pm-gris">Source : {client.source}</p>}
          {client.ownerName && <p className="text-xs text-pm-gris">Conseiller : {client.ownerName}</p>}
          {client.notes && <p className="mt-3 text-sm text-pm-noir">{client.notes}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <ClientStageSelect id={client.id} stage={client.stage} />
          <DeleteClientButton id={client.id} />
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Opportunités</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientDeals.map((deal) => (
            <div key={deal.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div>
                <p className="font-medium text-pm-noir">{deal.title}</p>
                <p className="text-sm text-pm-gris">{deal.valueEuros.toLocaleString("fr-FR")} €</p>
              </div>
              <InlineStatusSelect value={deal.stage} options={DEAL_STAGE_OPTIONS} action={updateDealStage.bind(null, deal.id)} />
            </div>
          ))}
          {clientDeals.length === 0 && <p className="text-sm text-pm-gris">Aucune opportunité.</p>}
        </div>
        <div className="mt-3">
          <CreateDealForm fixedClientId={client.id} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Contrats &amp; devis</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientContracts.map((contract) => (
            <div key={contract.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium text-pm-noir">{contract.title}</p>
                <Badge
                  label={CONTRACT_STATUS_LABEL[contract.status] ?? contract.status}
                  className={CONTRACT_STATUS_CLASS[contract.status] ?? ""}
                />
              </div>
              {contract.signerName && (
                <p className="mt-1 text-xs text-pm-gris">
                  Signataire : {contract.signerName} {contract.signerEmail && `(${contract.signerEmail})`}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                {contract.status === "draft" && <SendContractButton id={contract.id} />}
                {contract.status === "sent" && <SimulateSignatureButton id={contract.id} />}
              </div>
            </div>
          ))}
          {clientContracts.length === 0 && <p className="text-sm text-pm-gris">Aucun contrat.</p>}
        </div>
        <div className="mt-3">
          <CreateContractForm
            fixedClientId={client.id}
            dealOptions={clientDeals.map((d) => ({ id: d.id, title: d.title }))}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Tickets support</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientTickets.map((ticket) => (
            <div key={ticket.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium text-pm-noir">{ticket.subject}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge label={TICKET_PRIORITY_LABEL[ticket.priority] ?? ticket.priority} className={TICKET_PRIORITY_CLASS[ticket.priority] ?? ""} />
                  <InlineStatusSelect value={ticket.status} options={TICKET_STATUS_OPTIONS} action={updateTicketStatus.bind(null, ticket.id)} />
                </div>
              </div>
              {ticket.description && <p className="mt-1 text-sm text-pm-gris">{ticket.description}</p>}
            </div>
          ))}
          {clientTickets.length === 0 && <p className="text-sm text-pm-gris">Aucun ticket.</p>}
        </div>
        <div className="mt-3">
          <CreateTicketForm fixedClientId={client.id} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Tâches</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientTasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div>
                <p className="font-medium text-pm-noir">{task.title}</p>
                <p className="text-xs text-pm-gris">
                  {task.assignee ?? "Non assigné"}
                  {task.dueDate ? ` · échéance ${new Date(task.dueDate).toLocaleDateString("fr-FR")}` : ""}
                </p>
              </div>
              <InlineStatusSelect value={task.status} options={TASK_STATUS_OPTIONS} action={updateTaskStatus.bind(null, task.id)} />
            </div>
          ))}
          {clientTasks.length === 0 && <p className="text-sm text-pm-gris">Aucune tâche.</p>}
        </div>
        <div className="mt-3">
          <CreateTaskForm fixedClientId={client.id} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Projets</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientProjects.map((project) => (
            <div key={project.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div>
                <p className="font-medium text-pm-noir">{project.name}</p>
                {project.description && <p className="text-sm text-pm-gris">{project.description}</p>}
              </div>
              <InlineStatusSelect value={project.status} options={PROJECT_STATUS_OPTIONS} action={updateProjectStatus.bind(null, project.id)} />
            </div>
          ))}
          {clientProjects.length === 0 && <p className="text-sm text-pm-gris">Aucun projet.</p>}
        </div>
        <div className="mt-3">
          <CreateProjectForm fixedClientId={client.id} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Calendrier</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientEvents.map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
              <p className="font-medium text-pm-noir">{event.title}</p>
              <p className="text-xs text-pm-gris">
                {new Date(event.startAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          ))}
          {clientEvents.length === 0 && <p className="text-sm text-pm-gris">Aucun événement.</p>}
        </div>
        <div className="mt-3">
          <CreateEventForm fixedClientId={client.id} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Historique des interactions</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientInteractions.map((interaction) => (
            <div key={interaction.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-medium uppercase tracking-wide text-pm-gris">{interaction.type}</p>
                <p className="text-xs text-pm-gris">{new Date(interaction.occurredAt).toLocaleString("fr-FR")}</p>
              </div>
              <p className="mt-1 text-sm text-pm-noir">{interaction.summary}</p>
              {interaction.createdBy && <p className="mt-1 text-xs text-pm-gris">— {interaction.createdBy}</p>}
            </div>
          ))}
          {clientInteractions.length === 0 && <p className="text-sm text-pm-gris">Aucune interaction enregistrée.</p>}
        </div>
        <div className="mt-3">
          <CreateInteractionForm clientId={client.id} />
        </div>
      </section>
    </>
  );
}
