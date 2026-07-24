import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  analyticsProperties,
  auditLog,
  calendarEvents,
  contracts,
  crmClientDocuments,
  crmClients,
  crmInvoices,
  crmQuotes,
  crmWebsites,
  deals,
  gbpConnections,
  interactions,
  locations,
  projects,
  searchConsoleProperties,
  seoAudits,
  tasks,
  tickets,
  users,
} from "@/db/schema";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope, getGoogleConnection } from "@/lib/google/oauth";
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
import { ArchiveClientButton, ClientStageSelect, DeleteClientButton } from "@/components/crm/client-actions";
import { CreateContractForm } from "@/components/crm/create-contract-form";
import { EditContractForm, SendContractButton, SimulateSignatureButton } from "@/components/crm/contract-actions";
import { CreateDealForm } from "@/components/crm/create-deal-form";
import { CreateEventForm } from "@/components/crm/create-event-form";
import { CreateInteractionForm } from "@/components/crm/create-interaction-form";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { CreateTaskForm } from "@/components/crm/create-task-form";
import { CreateTicketForm } from "@/components/crm/create-ticket-form";
import { EditClientForm } from "@/components/crm/edit-client-form";
import { DeleteCrmDocumentButton, UploadCrmDocumentForm } from "@/components/crm/crm-document-actions";
import { DeleteDealButton, EditDealForm } from "@/components/crm/deal-actions";
import { DeleteEventButton, EditEventForm } from "@/components/crm/event-actions";
import { DeleteProjectButton, EditProjectForm } from "@/components/crm/project-actions";
import { DeleteTaskButton, EditTaskForm } from "@/components/crm/task-actions";
import { DeleteTicketButton, EditTicketForm } from "@/components/crm/ticket-actions";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { updateDealStage } from "@/lib/actions/crm-deals";
import { updateProjectStatus } from "@/lib/actions/crm-projects";
import { updateTaskStatus } from "@/lib/actions/crm-tasks";
import { updateTicketStatus } from "@/lib/actions/crm-tickets";
import { requireStaffRole } from "@/lib/dev-role";
import { describeAuditEntry } from "@/lib/audit-labels";
import { createQuote } from "@/lib/actions/crm-quotes";
import { createInvoice } from "@/lib/actions/crm-invoices";
import { formatMoney } from "@/lib/crm-billing";
import { BillingDocumentForm } from "@/components/crm/billing-document-form";
import {
  ConvertQuoteToInvoiceButton,
  DeleteInvoiceButton,
  DeleteQuoteButton,
  InvoiceStatusSelect,
  QuoteStatusSelect,
} from "@/components/crm/quote-invoice-actions";

export default async function CrmClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRole();
  const { id } = await params;

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1);
  if (!client) notFound();

  const gbpStatus = client.organizationId
    ? await (async () => {
        const [connection] = await db
          .select()
          .from(gbpConnections)
          .where(eq(gbpConnections.organizationId, client.organizationId!))
          .limit(1);
        if (!connection || connection.status !== "connected") return { connected: false, locationCount: 0 };
        const orgLocations = await db.select({ id: locations.id }).from(locations).where(eq(locations.organizationId, client.organizationId!));
        return { connected: true, locationCount: orgLocations.length };
      })()
    : { connected: false, locationCount: 0 };

  const googleAccount = client.organizationId ? await getGoogleConnection(client.organizationId) : null;
  const searchConsoleStatus = client.organizationId
    ? await (async () => {
        const hasScope = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.searchConsole));
        if (!hasScope) return { connected: false, propertyCount: 0 };
        const props = await db.select({ id: searchConsoleProperties.id }).from(searchConsoleProperties).where(eq(searchConsoleProperties.organizationId, client.organizationId!));
        return { connected: true, propertyCount: props.length };
      })()
    : { connected: false, propertyCount: 0 };
  const analyticsStatus = client.organizationId
    ? await (async () => {
        const hasScope = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.analytics));
        if (!hasScope) return { connected: false, propertyCount: 0 };
        const props = await db.select({ id: analyticsProperties.id }).from(analyticsProperties).where(eq(analyticsProperties.organizationId, client.organizationId!));
        return { connected: true, propertyCount: props.length };
      })()
    : { connected: false, propertyCount: 0 };

  const clientWebsites = await db.select().from(crmWebsites).where(eq(crmWebsites.clientId, id));
  const seoStatus = await (async () => {
    if (clientWebsites.length === 0) return { websiteCount: 0, latestScore: null as number | null };
    const websiteIds = clientWebsites.map((w) => w.id);
    const [latestAudit] = await db
      .select()
      .from(seoAudits)
      .where(and(inArray(seoAudits.websiteId, websiteIds), eq(seoAudits.status, "completed")))
      .orderBy(desc(seoAudits.createdAt))
      .limit(1);
    return { websiteCount: clientWebsites.length, latestScore: latestAudit?.score ?? null };
  })();

  const [
    clientDeals,
    clientTickets,
    clientTasks,
    clientProjects,
    clientEvents,
    clientInteractions,
    clientContracts,
    clientDocuments,
    clientQuotes,
    clientInvoices,
  ] = await Promise.all([
    db.select().from(deals).where(eq(deals.clientId, id)).orderBy(desc(deals.createdAt)),
    db.select().from(tickets).where(eq(tickets.clientId, id)).orderBy(desc(tickets.createdAt)),
    db.select().from(tasks).where(eq(tasks.clientId, id)).orderBy(desc(tasks.createdAt)),
    db.select().from(projects).where(eq(projects.clientId, id)).orderBy(desc(projects.createdAt)),
    db.select().from(calendarEvents).where(eq(calendarEvents.clientId, id)).orderBy(desc(calendarEvents.startAt)),
    db.select().from(interactions).where(eq(interactions.clientId, id)).orderBy(desc(interactions.occurredAt)),
    db.select().from(contracts).where(eq(contracts.clientId, id)).orderBy(desc(contracts.createdAt)),
    db.select().from(crmClientDocuments).where(eq(crmClientDocuments.clientId, id)).orderBy(desc(crmClientDocuments.createdAt)),
    db.select().from(crmQuotes).where(eq(crmQuotes.clientId, id)).orderBy(desc(crmQuotes.createdAt)),
    db.select().from(crmInvoices).where(eq(crmInvoices.clientId, id)).orderBy(desc(crmInvoices.issuedAt)),
  ]);

  // Unified activity timeline — every logAudit() call across the CRM domain
  // (client/deal/ticket/task/project/event/contract/interaction) already
  // records a row keyed by the sub-entity's own id, not the client's, so we
  // gather every id we already fetched for this client and pull every audit
  // entry that targets one of them, rather than adding a clientId column to
  // audit_log.
  const activityTargetIds = [
    id,
    ...clientDeals.map((d) => d.id),
    ...clientTickets.map((t) => t.id),
    ...clientTasks.map((t) => t.id),
    ...clientProjects.map((p) => p.id),
    ...clientEvents.map((e) => e.id),
    ...clientContracts.map((c) => c.id),
    ...clientInteractions.map((i) => i.id),
    ...clientDocuments.map((d) => d.id),
    ...clientQuotes.map((q) => q.id),
    ...clientInvoices.map((i) => i.id),
  ];
  const activity = await db
    .select()
    .from(auditLog)
    .where(inArray(auditLog.targetId, activityTargetIds))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  const actorIds = [...new Set(activity.map((e) => e.actorUserId).filter((v): v is string => Boolean(v)))];
  const actors = actorIds.length
    ? await db.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(inArray(users.id, actorIds))
    : [];
  const actorNameById = new Map(actors.map((a) => [a.id, a.fullName ?? a.email]));

  return (
    <>
      <div className="flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold text-pm-noir">{client.name}</h1>
            {client.archivedAt && (
              <span className="inline-block rounded-full bg-pm-gris-2/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
                Archivé
              </span>
            )}
          </div>
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
          <div className="flex items-center gap-3">
            <EditClientForm client={client} />
            <ArchiveClientButton id={client.id} archived={Boolean(client.archivedAt)} />
          </div>
          <DeleteClientButton id={client.id} />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Google Business Profile</p>
          <p className="mt-1 text-sm text-pm-gris">
            {gbpStatus.connected
              ? `Connecté — ${gbpStatus.locationCount} établissement(s)`
              : "Non connecté"}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/gbp`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {gbpStatus.connected ? "Gérer" : "Connecter"} →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Google Search Console</p>
          <p className="mt-1 text-sm text-pm-gris">
            {searchConsoleStatus.connected
              ? `Connecté — ${searchConsoleStatus.propertyCount} propriété(s)`
              : "Non connecté"}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/search-console`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {searchConsoleStatus.connected ? "Gérer" : "Connecter"} →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Google Analytics</p>
          <p className="mt-1 text-sm text-pm-gris">
            {analyticsStatus.connected
              ? `Connecté — ${analyticsStatus.propertyCount} propriété(s)`
              : "Non connecté"}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/analytics`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {analyticsStatus.connected ? "Gérer" : "Connecter"} →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">SEO</p>
          <p className="mt-1 text-sm text-pm-gris">
            {seoStatus.websiteCount === 0
              ? "Aucun site web suivi"
              : seoStatus.latestScore !== null
                ? `${seoStatus.websiteCount} site(s) suivi(s) — dernier score : ${seoStatus.latestScore}/100`
                : `${seoStatus.websiteCount} site(s) suivi(s) — aucun audit encore réalisé`}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/seo`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {seoStatus.websiteCount === 0 ? "Ajouter un site" : "Gérer"} →
        </Link>
      </div>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Opportunités</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientDeals.map((deal) => (
            <div key={deal.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div>
                <p className="font-medium text-pm-noir">{deal.title}</p>
                <p className="text-sm text-pm-gris">{deal.valueEuros.toLocaleString("fr-FR")} €</p>
                <div className="mt-1 flex items-center gap-3">
                  <EditDealForm deal={deal} />
                  <DeleteDealButton id={deal.id} />
                </div>
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
              <div className="mt-3 flex items-center gap-3">
                {contract.status === "draft" && <EditContractForm contract={contract} />}
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
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Devis</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientQuotes.map((quote) => (
            <div key={quote.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-pm-noir">{quote.quoteNumber} — {quote.title}</p>
                  <p className="text-sm text-pm-gris">{formatMoney(quote.totalCents, quote.currency)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/api/crm/quotes/${quote.id}/pdf`}
                    className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
                  >
                    PDF
                  </a>
                  <QuoteStatusSelect id={quote.id} status={quote.status} />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                {quote.status === "accepted" && <ConvertQuoteToInvoiceButton id={quote.id} />}
                {quote.status === "draft" && <DeleteQuoteButton id={quote.id} />}
              </div>
            </div>
          ))}
          {clientQuotes.length === 0 && <p className="text-sm text-pm-gris">Aucun devis.</p>}
        </div>
        <div className="mt-3">
          <BillingDocumentForm
            action={createQuote}
            submitLabel="Créer le devis"
            fixedClientId={client.id}
            dealOptions={clientDeals.map((d) => ({ id: d.id, title: d.title }))}
            dateField={{ name: "validUntil", label: "Valable jusqu'au" }}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Factures</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientInvoices.map((invoice) => (
            <div key={invoice.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-pm-noir">{invoice.invoiceNumber} — {invoice.title}</p>
                  <p className="text-sm text-pm-gris">
                    {formatMoney(invoice.totalCents, invoice.currency)}
                    {invoice.dueAt && ` · échéance ${new Date(invoice.dueAt).toLocaleDateString("fr-FR")}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/api/crm/invoices/${invoice.id}/pdf`}
                    className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
                  >
                    PDF
                  </a>
                  <InvoiceStatusSelect id={invoice.id} status={invoice.status} />
                </div>
              </div>
              {invoice.status === "draft" && (
                <div className="mt-2">
                  <DeleteInvoiceButton id={invoice.id} />
                </div>
              )}
            </div>
          ))}
          {clientInvoices.length === 0 && <p className="text-sm text-pm-gris">Aucune facture.</p>}
        </div>
        <div className="mt-3">
          <BillingDocumentForm
            action={createInvoice}
            submitLabel="Créer la facture"
            fixedClientId={client.id}
            dealOptions={clientDeals.map((d) => ({ id: d.id, title: d.title }))}
            dateField={{ name: "dueAt", label: "Échéance" }}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Documents</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientDocuments.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4"
            >
              <div>
                <a
                  href={`/api/crm-documents/${doc.id}`}
                  className="text-sm font-medium text-pm-noir hover:underline"
                >
                  {doc.fileName}
                </a>
                <p className="mt-0.5 text-xs text-pm-gris">
                  {(doc.sizeBytes / 1024).toFixed(0)} Ko · {new Date(doc.createdAt).toLocaleDateString("fr-FR")}
                  {doc.uploadedBy && ` · ${doc.uploadedBy}`}
                </p>
              </div>
              <DeleteCrmDocumentButton id={doc.id} />
            </div>
          ))}
          {clientDocuments.length === 0 && <p className="text-sm text-pm-gris">Aucun document.</p>}
        </div>
        <div className="mt-3">
          <UploadCrmDocumentForm clientId={client.id} />
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
              <div className="mt-2 flex items-center gap-3">
                <EditTicketForm ticket={ticket} />
                <DeleteTicketButton id={ticket.id} />
              </div>
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
              <div className="flex shrink-0 items-center gap-3">
                <InlineStatusSelect value={task.status} options={TASK_STATUS_OPTIONS} action={updateTaskStatus.bind(null, task.id)} />
                <EditTaskForm task={task} />
                <DeleteTaskButton id={task.id} />
              </div>
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
              <div className="flex shrink-0 items-center gap-3">
                <InlineStatusSelect value={project.status} options={PROJECT_STATUS_OPTIONS} action={updateProjectStatus.bind(null, project.id)} />
                <EditProjectForm project={project} />
                <DeleteProjectButton id={project.id} />
              </div>
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
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-pm-gris">
                  {new Date(event.startAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <EditEventForm event={event} />
                <DeleteEventButton id={event.id} />
              </div>
            </div>
          ))}
          {clientEvents.length === 0 && <p className="text-sm text-pm-gris">Aucun événement.</p>}
        </div>
        <div className="mt-3">
          <CreateEventForm fixedClientId={client.id} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Ajouter une interaction</h2>
        <div className="mt-3 rounded-2xl border border-pm-gris-2 bg-white p-4">
          <CreateInteractionForm clientId={client.id} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Historique des activités</h2>
        <div className="mt-3 flex flex-col gap-3">
          {activity.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-pm-noir">{describeAuditEntry(entry)}</p>
                <p className="shrink-0 text-xs text-pm-gris">{new Date(entry.createdAt).toLocaleString("fr-FR")}</p>
              </div>
              <p className="mt-1 text-xs text-pm-gris">
                Par {entry.actorUserId ? (actorNameById.get(entry.actorUserId) ?? "utilisateur inconnu") : "système"}
              </p>
            </div>
          ))}
          {activity.length === 0 && <p className="text-sm text-pm-gris">Aucune activité enregistrée pour le moment.</p>}
        </div>
      </section>
    </>
  );
}
