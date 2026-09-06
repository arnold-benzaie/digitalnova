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
  services,
  staffMembers,
  tasks,
  tickets,
  users,
} from "@/db/schema";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope, getGoogleConnection } from "@/lib/google/oauth";
import {
  Badge,
  CONTRACT_STATUS_CLASS,
  getContractStatusLabel,
  getDealStageOptions,
  getProjectStatusOptions,
  getTaskStatusOptions,
  getTicketPriorityLabel,
  getTicketStatusOptions,
  TASK_STATUS_CLASS,
  TICKET_PRIORITY_CLASS,
} from "@/components/crm/badges";
import { ArchiveClientButton, ClientMarketSelect, ClientStageSelect, DeleteClientButton } from "@/components/crm/client-actions";
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
import { requireSession } from "@/lib/session";
import { getRadarCapabilities } from "@/lib/rbac/require-staff-member";
import { listAssignableRadarMembers } from "@/lib/actions/radar-assignment";
import { getInternalOrganizationId } from "@/lib/notifications";
import { RadarAssignmentControls } from "@/components/crm/radar-assignment-controls";
import { FollowUpActions } from "@/components/crm/follow-up-actions";
import { describeAuditEntry } from "@/lib/audit-labels";
import { createQuote } from "@/lib/actions/crm-quotes";
import { createInvoice } from "@/lib/actions/crm-invoices";
import { formatMoney, toCatalogueServiceOptions } from "@/lib/crm-billing";
import { buildCatalogueOfferPriceMap, resolveClientMarket, selectableCatalogueServiceCondition } from "@/lib/crm-service-linking";
import { BillingDocumentForm } from "@/components/crm/billing-document-form";
import {
  ConvertQuoteToInvoiceButton,
  DeleteInvoiceButton,
  DeleteQuoteButton,
  InvoiceStatusSelect,
  QuoteStatusSelect,
} from "@/components/crm/quote-invoice-actions";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate, formatDateTime, formatNumber } from "@/lib/i18n/format";

export default async function CrmClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRole();
  const [{ id }, locale] = await Promise.all([params, getLocale()]);
  const t = dictionaries[locale].crm.clientDetail;
  const contractStatusLabel = getContractStatusLabel(locale);
  const dealStageOptions = getDealStageOptions(locale);
  const projectStatusOptions = getProjectStatusOptions(locale);
  const taskStatusOptions = getTaskStatusOptions(locale);
  const ticketPriorityLabel = getTicketPriorityLabel(locale);
  const ticketStatusOptions = getTicketStatusOptions(locale);

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
    catalogueServices,
    catalogueOfferPriceMap,
    clientMarket,
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
    db
      .select({ serviceId: services.serviceId, displayNameFr: services.displayNameFr, displayNameEn: services.displayNameEn })
      .from(services)
      .where(selectableCatalogueServiceCondition()),
    buildCatalogueOfferPriceMap(),
    // Single client already known server-side — not an N+1 concern (see
    // resolveClientMarket's own docstring). P0.2A-3 decision: organizationId
    // null or organizations.market null/invalid both collapse to null here,
    // never a guessed market.
    resolveClientMarket(client.organizationId),
  ]);
  const serviceOptions = toCatalogueServiceOptions(catalogueServices, locale, catalogueOfferPriceMap);

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

  // RADAR-CORE-1C — expose the shipped prospect/client assignment system
  // (crm_clients.assigned_user_id, RADAR-CORE-1A) on the detail page.
  // Read authorization stays requireStaffRole() above; the Axis-C `caps`
  // below drive only the interactive affordances inside
  // <RadarAssignmentControls>, and every mutation re-checks
  // requireStaffMember(...) in the server actions.
  const { userId: currentUserId } = await requireSession();
  const assignmentCaps = await getRadarCapabilities();
  const assignables = assignmentCaps.canAssignOthers ? await listAssignableRadarMembers() : [];

  // Resolve the current assignee's display identity + ACTIVE-in-internal-
  // workspace flag. One targeted lookup, only when someone is assigned.
  // assigned_user_id is the SOLE structured assignment truth — the legacy
  // free-text ownerName is never consulted. Mirrors radar-queue.ts's
  // resolveAssignees(): a stale / removed / suspended assignee stays
  // assigned but reads as inactive; a missing internal workspace still
  // renders the page (identity resolved from `users`, active = false).
  let assignedUserName: string | null = null;
  let assignedUserActive = false;
  if (client.assignedUserId) {
    const internalOrgId = await getInternalOrganizationId();
    const [assigneeRow] = await db
      .select({ fullName: users.fullName, email: users.email, staffStatus: staffMembers.status })
      .from(users)
      .leftJoin(
        staffMembers,
        internalOrgId
          ? and(eq(staffMembers.userId, users.id), eq(staffMembers.workspaceOrgId, internalOrgId))
          : eq(staffMembers.userId, users.id),
      )
      .where(eq(users.id, client.assignedUserId))
      .limit(1);
    assignedUserName = assigneeRow ? (assigneeRow.fullName ?? assigneeRow.email ?? null) : null;
    assignedUserActive = Boolean(internalOrgId) && assigneeRow?.staffStatus === "ACTIVE";
  }

  // RADAR-CORE-3C — a task is a FOLLOW-UP when it is client-linked AND
  // dated (`due_date IS NOT NULL`), regardless of open/terminal status;
  // otherwise it is a generic CRM task. Only follow-up rows get the
  // structured `tasks.assigned_user_id` owner display + <FollowUpActions>.
  const isFollowUpTask = (task: (typeof clientTasks)[number]) => task.clientId !== null && task.dueDate !== null;
  const followUpAssigneeIds = [
    ...new Set(clientTasks.filter(isFollowUpTask).map((task) => task.assignedUserId).filter((v): v is string => Boolean(v))),
  ];
  // One batched lookup for every follow-up assignee id on the page — same
  // shape as the client-assignee resolve above. A stale / removed /
  // suspended assignee stays assigned but reads as inactive; an
  // unresolvable id renders a localized "Former user", never the raw id.
  const followUpAssigneeById = new Map<string, { name: string | null; active: boolean }>();
  if (followUpAssigneeIds.length > 0) {
    const internalOrgId = await getInternalOrganizationId();
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, staffStatus: staffMembers.status })
      .from(users)
      .leftJoin(
        staffMembers,
        internalOrgId
          ? and(eq(staffMembers.userId, users.id), eq(staffMembers.workspaceOrgId, internalOrgId))
          : eq(staffMembers.userId, users.id),
      )
      .where(inArray(users.id, followUpAssigneeIds));
    for (const row of rows) {
      followUpAssigneeById.set(row.id, {
        name: row.fullName ?? row.email ?? null,
        active: Boolean(internalOrgId) && row.staffStatus === "ACTIVE",
      });
    }
  }
  const taskStatusLabel = Object.fromEntries(taskStatusOptions.map((o) => [o.value, o.label]));
  const tFollowUp = dictionaries[locale].crm.clientDetail.followUp;

  return (
    <>
      <div className="flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 shadow-[0_8px_22px_rgba(13,36,67,0.05)] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold text-pm-noir">{client.name}</h1>
            {client.archivedAt && (
              <span className="inline-block rounded-full bg-pm-gris-2/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
                {t.archivedBadge}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-1 text-sm text-pm-gris">
            {client.contactName && <p>{client.contactName}</p>}
            {client.email && <p>{client.email}</p>}
            {client.phone && <p>{client.phone}</p>}
            {client.address && <p>{client.address}</p>}
          </div>
          {client.source && <p className="mt-2 text-xs text-pm-gris">{t.sourceLabel} {client.source}</p>}
          {client.ownerName && <p className="text-xs text-pm-gris">{t.ownerLabel} {client.ownerName}</p>}
          {client.notes && <p className="mt-3 text-sm text-pm-noir">{client.notes}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <ClientStageSelect id={client.id} stage={client.stage} locale={locale} />
          <label className="flex items-center gap-2 text-xs text-pm-gris">
            {t.marketLabel}
            <ClientMarketSelect id={client.id} market={clientMarket} locale={locale} />
          </label>
          <div className="flex items-center gap-3">
            <EditClientForm client={client} locale={locale} />
            <ArchiveClientButton id={client.id} archived={Boolean(client.archivedAt)} locale={locale} />
          </div>
          <DeleteClientButton id={client.id} locale={locale} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)] sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.assignmentTitle}</p>
        <RadarAssignmentControls
          clientId={client.id}
          assignedUserId={client.assignedUserId}
          assignedUserName={assignedUserName}
          assignedUserActive={assignedUserActive}
          currentUserId={currentUserId}
          caps={assignmentCaps}
          assignables={assignables}
          locale={locale}
          t={dictionaries[locale].crm.radar.assignment}
        />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.gbp.title}</p>
          <p className="mt-1 text-sm text-pm-gris">
            {gbpStatus.connected ? t.gbp.connected(gbpStatus.locationCount) : t.gbp.notConnected}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/gbp`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {gbpStatus.connected ? t.gbp.manage : t.gbp.connect} →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.searchConsole.title}</p>
          <p className="mt-1 text-sm text-pm-gris">
            {searchConsoleStatus.connected ? t.searchConsole.connected(searchConsoleStatus.propertyCount) : t.searchConsole.notConnected}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/search-console`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {searchConsoleStatus.connected ? t.searchConsole.manage : t.searchConsole.connect} →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.analytics.title}</p>
          <p className="mt-1 text-sm text-pm-gris">
            {analyticsStatus.connected ? t.analytics.connected(analyticsStatus.propertyCount) : t.analytics.notConnected}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/analytics`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {analyticsStatus.connected ? t.analytics.manage : t.analytics.connect} →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.seo.title}</p>
          <p className="mt-1 text-sm text-pm-gris">
            {seoStatus.websiteCount === 0
              ? t.seo.noWebsites
              : seoStatus.latestScore !== null
                ? t.seo.withScore(seoStatus.websiteCount, seoStatus.latestScore)
                : t.seo.noScoreYet(seoStatus.websiteCount)}
          </p>
        </div>
        <Link
          href={`/admin/crm/clients/${client.id}/seo`}
          className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
        >
          {seoStatus.websiteCount === 0 ? t.seo.addSite : t.seo.manage} →
        </Link>
      </div>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.deals}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientDeals.map((deal) => (
            <div key={deal.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div>
                <p className="font-medium text-pm-noir">{deal.title}</p>
                <p className="text-sm text-pm-gris">{formatNumber(deal.valueEuros, locale)} €</p>
                <div className="mt-1 flex items-center gap-3">
                  <EditDealForm deal={deal} locale={locale} />
                  <DeleteDealButton id={deal.id} locale={locale} />
                </div>
              </div>
              <InlineStatusSelect value={deal.stage} options={dealStageOptions} action={updateDealStage.bind(null, deal.id)} />
            </div>
          ))}
          {clientDeals.length === 0 && <p className="text-sm text-pm-gris">{t.empty.deals}</p>}
        </div>
        <div className="mt-3">
          <CreateDealForm fixedClientId={client.id} locale={locale} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.contracts}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientContracts.map((contract) => (
            <div key={contract.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium text-pm-noir">{contract.title}</p>
                <Badge
                  label={contractStatusLabel[contract.status] ?? contract.status}
                  className={CONTRACT_STATUS_CLASS[contract.status] ?? ""}
                />
              </div>
              {contract.signerName && (
                <p className="mt-1 text-xs text-pm-gris">
                  {t.signerLabel} {contract.signerName} {contract.signerEmail && `(${contract.signerEmail})`}
                </p>
              )}
              <div className="mt-3 flex items-center gap-3">
                {contract.status === "draft" && <EditContractForm contract={contract} locale={locale} />}
                {contract.status === "draft" && <SendContractButton id={contract.id} locale={locale} />}
                {contract.status === "sent" && <SimulateSignatureButton id={contract.id} locale={locale} />}
              </div>
            </div>
          ))}
          {clientContracts.length === 0 && <p className="text-sm text-pm-gris">{t.empty.contracts}</p>}
        </div>
        <div className="mt-3">
          <CreateContractForm
            fixedClientId={client.id}
            dealOptions={clientDeals.map((d) => ({ id: d.id, title: d.title }))}
            locale={locale}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.quotes}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientQuotes.map((quote) => (
            <div key={quote.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-pm-noir">{quote.quoteNumber} — {quote.title}</p>
                  <p className="text-sm text-pm-gris">{formatMoney(quote.totalCents, quote.currency, locale)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/api/crm/quotes/${quote.id}/pdf`}
                    className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
                  >
                    {t.pdfLabel}
                  </a>
                  <QuoteStatusSelect id={quote.id} status={quote.status} locale={locale} />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                {quote.status === "accepted" && <ConvertQuoteToInvoiceButton id={quote.id} locale={locale} />}
                {quote.status === "draft" && <DeleteQuoteButton id={quote.id} locale={locale} />}
              </div>
            </div>
          ))}
          {clientQuotes.length === 0 && <p className="text-sm text-pm-gris">{t.empty.quotes}</p>}
        </div>
        <div className="mt-3">
          <BillingDocumentForm
            action={createQuote}
            submitLabel={t.createQuoteLabel}
            fixedClientId={client.id}
            dealOptions={clientDeals.map((d) => ({ id: d.id, title: d.title }))}
            dateField={{ name: "validUntil", label: t.validUntilLabel }}
            locale={locale}
            serviceOptions={serviceOptions}
            clientMarket={clientMarket}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.invoices}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientInvoices.map((invoice) => (
            <div key={invoice.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-pm-noir">{invoice.invoiceNumber} — {invoice.title}</p>
                  <p className="text-sm text-pm-gris">
                    {formatMoney(invoice.totalCents, invoice.currency, locale)}
                    {invoice.dueAt && ` · ${t.duePrefix} ${formatDate(invoice.dueAt, locale)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/api/crm/invoices/${invoice.id}/pdf`}
                    className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
                  >
                    {t.pdfLabel}
                  </a>
                  <InvoiceStatusSelect id={invoice.id} status={invoice.status} locale={locale} />
                </div>
              </div>
              {invoice.status === "draft" && (
                <div className="mt-2">
                  <DeleteInvoiceButton id={invoice.id} locale={locale} />
                </div>
              )}
            </div>
          ))}
          {clientInvoices.length === 0 && <p className="text-sm text-pm-gris">{t.empty.invoices}</p>}
        </div>
        <div className="mt-3">
          <BillingDocumentForm
            action={createInvoice}
            submitLabel={t.createInvoiceLabel}
            fixedClientId={client.id}
            dealOptions={clientDeals.map((d) => ({ id: d.id, title: d.title }))}
            dateField={{ name: "dueAt", label: t.dueLabel }}
            locale={locale}
            serviceOptions={serviceOptions}
            clientMarket={clientMarket}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.documents}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientDocuments.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]"
            >
              <div>
                <a
                  href={`/api/crm-documents/${doc.id}`}
                  className="text-sm font-medium text-pm-noir hover:underline"
                >
                  {doc.fileName}
                </a>
                <p className="mt-0.5 text-xs text-pm-gris">
                  {(doc.sizeBytes / 1024).toFixed(0)} {t.koUnit} · {formatDate(doc.createdAt, locale)}
                  {doc.uploadedBy && ` · ${doc.uploadedBy}`}
                </p>
              </div>
              <DeleteCrmDocumentButton id={doc.id} locale={locale} />
            </div>
          ))}
          {clientDocuments.length === 0 && <p className="text-sm text-pm-gris">{t.empty.documents}</p>}
        </div>
        <div className="mt-3">
          <UploadCrmDocumentForm clientId={client.id} locale={locale} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.tickets}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientTickets.map((ticket) => (
            <div key={ticket.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium text-pm-noir">{ticket.subject}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge label={ticketPriorityLabel[ticket.priority] ?? ticket.priority} className={TICKET_PRIORITY_CLASS[ticket.priority] ?? ""} />
                  <InlineStatusSelect value={ticket.status} options={ticketStatusOptions} action={updateTicketStatus.bind(null, ticket.id)} />
                </div>
              </div>
              {ticket.description && <p className="mt-1 text-sm text-pm-gris">{ticket.description}</p>}
              <div className="mt-2 flex items-center gap-3">
                <EditTicketForm ticket={ticket} locale={locale} />
                <DeleteTicketButton id={ticket.id} locale={locale} />
              </div>
            </div>
          ))}
          {clientTickets.length === 0 && <p className="text-sm text-pm-gris">{t.empty.tickets}</p>}
        </div>
        <div className="mt-3">
          <CreateTicketForm fixedClientId={client.id} locale={locale} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.tasks}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientTasks.map((task) =>
            isFollowUpTask(task) ? (
              // CLASS A — a client-linked, dated follow-up: read-only status
              // Badge + structured owner + full lifecycle via
              // <FollowUpActions>. No InlineStatusSelect on this row.
              <div key={task.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-pm-noir">{task.title}</p>
                    <p className="text-xs text-pm-gris">
                      {t.duePrefix} {formatDate(task.dueDate!, locale)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge label={taskStatusLabel[task.status] ?? task.status} className={TASK_STATUS_CLASS[task.status] ?? ""} />
                    <EditTaskForm task={task} locale={locale} />
                    <DeleteTaskButton id={task.id} locale={locale} />
                  </div>
                </div>
                <div className="mt-2">
                  <FollowUpActions
                    taskId={task.id}
                    followUpAssignedUserId={task.assignedUserId}
                    assignedUserName={task.assignedUserId ? (followUpAssigneeById.get(task.assignedUserId)?.name ?? null) : null}
                    assignedUserActive={task.assignedUserId ? (followUpAssigneeById.get(task.assignedUserId)?.active ?? false) : false}
                    status={task.status}
                    dueDate={task.dueDate}
                    currentUserId={currentUserId}
                    caps={assignmentCaps}
                    assignables={assignables}
                    locale={locale}
                    t={tFollowUp}
                  />
                </div>
              </div>
            ) : (
              // CLASS B — a generic client task (no due date): existing
              // behavior preserved verbatim, including the legacy free-text
              // `assignee` display and the InlineStatusSelect.
              <div key={task.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
                <div>
                  <p className="font-medium text-pm-noir">{task.title}</p>
                  <p className="text-xs text-pm-gris">{task.assignee ?? t.unassigned}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <InlineStatusSelect value={task.status} options={taskStatusOptions} action={updateTaskStatus.bind(null, task.id)} />
                  <EditTaskForm task={task} locale={locale} />
                  <DeleteTaskButton id={task.id} locale={locale} />
                </div>
              </div>
            ),
          )}
          {clientTasks.length === 0 && <p className="text-sm text-pm-gris">{t.empty.tasks}</p>}
        </div>
        <div className="mt-3">
          <CreateTaskForm fixedClientId={client.id} locale={locale} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.projects}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientProjects.map((project) => (
            <div key={project.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div>
                <p className="font-medium text-pm-noir">{project.name}</p>
                {project.description && <p className="text-sm text-pm-gris">{project.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <InlineStatusSelect value={project.status} options={projectStatusOptions} action={updateProjectStatus.bind(null, project.id)} />
                <EditProjectForm project={project} locale={locale} />
                <DeleteProjectButton id={project.id} locale={locale} />
              </div>
            </div>
          ))}
          {clientProjects.length === 0 && <p className="text-sm text-pm-gris">{t.empty.projects}</p>}
        </div>
        <div className="mt-3">
          <CreateProjectForm fixedClientId={client.id} locale={locale} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.calendar}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {clientEvents.map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <p className="font-medium text-pm-noir">{event.title}</p>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-pm-gris">
                  {formatDate(event.startAt, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <EditEventForm event={event} locale={locale} />
                <DeleteEventButton id={event.id} locale={locale} />
              </div>
            </div>
          ))}
          {clientEvents.length === 0 && <p className="text-sm text-pm-gris">{t.empty.events}</p>}
        </div>
        <div className="mt-3">
          <CreateEventForm fixedClientId={client.id} locale={locale} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.addInteraction}</h2>
        <div className="mt-3 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
          <CreateInteractionForm clientId={client.id} locale={locale} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sections.activityHistory}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {activity.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-pm-noir">{describeAuditEntry(entry, locale)}</p>
                <p className="shrink-0 text-xs text-pm-gris">{formatDateTime(entry.createdAt, locale)}</p>
              </div>
              <p className="mt-1 text-xs text-pm-gris">
                {t.activityByPrefix} {entry.actorUserId ? (actorNameById.get(entry.actorUserId) ?? t.unknownUser) : t.system}
              </p>
            </div>
          ))}
          {activity.length === 0 && <p className="text-sm text-pm-gris">{t.empty.activity}</p>}
        </div>
      </section>
    </>
  );
}
