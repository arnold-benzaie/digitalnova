import Link from "next/link";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, googleOauthConnections, crmClients, deals, interactions, crmInvoices, crmQuotes, audits, documents } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/i18n/format";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { Badge } from "@/components/crm/badges";
import { SEMANTIC_CLASS } from "@/lib/gbp-audit/status-colors";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope } from "@/lib/google/oauth";
import {
  computeSyncHealthSummary,
  buildClientsAtRiskItems,
  buildMoneyFollowUpItems,
  buildSyncErrorItems,
  groupClientsNeedingAttention,
  sortByLevel,
  type InboxLevel,
  type OrgSyncRow,
  type SyncErrorRow,
} from "@/lib/staff-inbox";

const LEVEL_TONE: Record<InboxLevel, "bad" | "warm" | "info" | "neutral"> = {
  urgent: "bad",
  to_handle: "warm",
  to_watch: "info",
  info: "neutral",
};

// Mirrors the private serviceOverview() helper in lib/google/oauth.ts
// exactly (error > synced > ready_to_sync) — that function isn't exported,
// and this needs to run over a bulk-fetched list (not one org at a time
// via getGoogleConnectionOverview, which would be an N+1 query here).
function computeProductState(
  connection: { grantedScopes: unknown },
  scope: string,
  lastSyncedAt: Date | null,
  lastSyncError: string | null,
): { scopeGranted: boolean; state?: "ready_to_sync" | "synced" | "error" } {
  if (!connectionHasScope(connection, scope)) return { scopeGranted: false };
  if (lastSyncError) return { scopeGranted: true, state: "error" };
  if (lastSyncedAt) return { scopeGranted: true, state: "synced" };
  return { scopeGranted: true, state: "ready_to_sync" };
}

export default async function AdminOverviewPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].dashboard.adminOverview;
  const inboxT = dictionaries[locale].dashboard.adminInbox;
  const now = new Date();

  const [orgs, syncConnections, clientLinks, dealRows, lastInteractionRows, invoiceRows, quoteRows, recentAuditRows, recentDocRows] = await Promise.all([
    db
      .select({ id: organizations.id, name: organizations.name, createdAt: organizations.createdAt, memberCount: sql<number>`count(${memberships.userId})::int` })
      .from(organizations)
      .leftJoin(memberships, eq(memberships.organizationId, organizations.id))
      .groupBy(organizations.id)
      .orderBy(organizations.createdAt),
    db.select().from(googleOauthConnections),
    // organizationId → crm_clients.id, needed because the CRM's per-client
    // staff pages (/admin/crm/clients/[id]/*) are keyed by crm_clients.id,
    // not organizations.id — not every portal organization has a matching
    // CRM record yet, so this is intentionally a partial map.
    db.select({ id: crmClients.id, organizationId: crmClients.organizationId }).from(crmClients).where(sql`${crmClients.organizationId} is not null`),
    db
      .select({ id: deals.id, clientId: deals.clientId, clientName: crmClients.name, title: deals.title, stage: deals.stage })
      .from(deals)
      .innerJoin(crmClients, eq(deals.clientId, crmClients.id))
      .where(or(eq(deals.stage, "new"), eq(deals.stage, "contacted"), eq(deals.stage, "qualified"), eq(deals.stage, "proposal"))),
    db
      .select({ clientId: interactions.clientId, lastInteractionAt: sql<Date>`max(${interactions.occurredAt})` })
      .from(interactions)
      .groupBy(interactions.clientId),
    db
      .select({
        id: crmInvoices.id,
        clientId: crmInvoices.clientId,
        clientSnapshot: crmInvoices.clientSnapshot,
        clientName: crmClients.name,
        invoiceNumber: crmInvoices.invoiceNumber,
        status: crmInvoices.status,
        dueAt: crmInvoices.dueAt,
      })
      .from(crmInvoices)
      .leftJoin(crmClients, eq(crmInvoices.clientId, crmClients.id))
      .where(or(eq(crmInvoices.status, "delivery_failed"), and(eq(crmInvoices.status, "sent"), lt(crmInvoices.dueAt, now)))),
    db
      .select({ id: crmQuotes.id, clientId: crmQuotes.clientId, clientName: crmClients.name, quoteNumber: crmQuotes.quoteNumber, status: crmQuotes.status, sentAt: crmQuotes.sentAt, respondedAt: crmQuotes.respondedAt })
      .from(crmQuotes)
      .innerJoin(crmClients, eq(crmQuotes.clientId, crmClients.id))
      .where(or(and(eq(crmQuotes.status, "sent"), isNull(crmQuotes.respondedAt)), eq(crmQuotes.status, "accepted"))),
    db
      .select({ id: audits.id, organizationId: audits.organizationId, organizationName: organizations.name, score: audits.score, createdAt: audits.createdAt })
      .from(audits)
      .innerJoin(organizations, eq(audits.organizationId, organizations.id))
      .orderBy(desc(audits.createdAt))
      .limit(8),
    db
      .select({ id: documents.id, organizationId: documents.organizationId, organizationName: organizations.name, fileName: documents.fileName, createdAt: documents.createdAt })
      .from(documents)
      .innerJoin(organizations, eq(documents.organizationId, organizations.id))
      .orderBy(desc(documents.createdAt))
      .limit(8),
  ]);

  const orgToClientId = new Map(clientLinks.map((c) => [c.organizationId as string, c.id]));
  const clientHref = (organizationId: string, sub = "") => {
    const clientId = orgToClientId.get(organizationId);
    if (!clientId) return "/admin/crm/clients";
    return sub ? `/admin/crm/clients/${clientId}/${sub}` : `/admin/crm/clients/${clientId}`;
  };

  // --- §G Sync health + sync-error items ---------------------------------
  const syncHealthRows: OrgSyncRow[] = syncConnections.map((c) => ({
    organizationId: c.organizationId,
    connected: true,
    products: [
      computeProductState(c, GOOGLE_OAUTH_SCOPES.gbp, c.gbpLastSyncedAt, c.gbpLastSyncError),
      computeProductState(c, GOOGLE_OAUTH_SCOPES.analytics, c.analyticsLastSyncedAt, c.analyticsLastSyncError),
      computeProductState(c, GOOGLE_OAUTH_SCOPES.searchConsole, c.searchConsoleLastSyncedAt, c.searchConsoleLastSyncError),
    ],
  }));
  const syncHealth = computeSyncHealthSummary(syncHealthRows);

  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
  const syncErrorRows: SyncErrorRow[] = [];
  for (const c of syncConnections) {
    const orgName = orgNameById.get(c.organizationId) ?? "—";
    const gbp = computeProductState(c, GOOGLE_OAUTH_SCOPES.gbp, c.gbpLastSyncedAt, c.gbpLastSyncError);
    const analytics = computeProductState(c, GOOGLE_OAUTH_SCOPES.analytics, c.analyticsLastSyncedAt, c.analyticsLastSyncError);
    const searchConsole = computeProductState(c, GOOGLE_OAUTH_SCOPES.searchConsole, c.searchConsoleLastSyncedAt, c.searchConsoleLastSyncError);
    if (gbp.state === "error") syncErrorRows.push({ organizationId: c.organizationId, organizationName: orgName, product: "gbp", href: clientHref(c.organizationId, "gbp") });
    if (analytics.state === "error") syncErrorRows.push({ organizationId: c.organizationId, organizationName: orgName, product: "analytics", href: clientHref(c.organizationId, "analytics") });
    if (searchConsole.state === "error") syncErrorRows.push({ organizationId: c.organizationId, organizationName: orgName, product: "searchConsole", href: clientHref(c.organizationId, "search-console") });
  }
  const syncErrorItems = buildSyncErrorItems(syncErrorRows);

  // --- §E Clients at risk --------------------------------------------------
  const lastInteractionByClient = new Map(lastInteractionRows.map((r) => [r.clientId, r.lastInteractionAt]));
  const clientsAtRiskItems = buildClientsAtRiskItems(
    dealRows.map((d) => ({ dealId: d.id, clientId: d.clientId, clientName: d.clientName, dealTitle: d.title, stage: d.stage, lastInteractionAt: lastInteractionByClient.get(d.clientId) ?? null })),
    now,
  );

  // --- §F Money follow-up ---------------------------------------------------
  const moneyItems = buildMoneyFollowUpItems(
    invoiceRows.map((i) => ({
      id: i.id,
      clientId: i.clientId,
      clientName: i.clientId ? (i.clientName ?? "—") : ((i.clientSnapshot as { name?: string } | null)?.name ?? "—"),
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      dueAt: i.dueAt,
    })),
    quoteRows,
    now,
  );

  // --- Clients needing attention (deduped, per §D) --------------------------
  const clientsNeedingAttention = groupClientsNeedingAttention([...syncErrorItems, ...clientsAtRiskItems, ...moneyItems]);

  return (
    <>
      <AdminPageHero title={inboxT.title} subtitle={inboxT.subtitle} />

      <div className={`mt-6 ${panelClass}`}>
        <p className={panelTitleClass}>{inboxT.sections.clientsNeedingAttention}</p>
        {clientsNeedingAttention.length === 0 ? (
          <EmptyState icon={<NAV_ICONS.checkSquare width={20} height={20} />} title={inboxT.empty.clientsNeedingAttention} />
        ) : (
          <div className="mt-3 flex flex-col">
            {clientsNeedingAttention.map((c) => (
              <div key={c.organizationId} className="flex items-center justify-between gap-3 border-t border-pm-gris-2 py-3 first:border-t-0">
                <div className="flex items-center gap-3">
                  <Badge label={inboxT.levels[c.level]} className={SEMANTIC_CLASS[LEVEL_TONE[c.level]]} />
                  <span className="text-sm font-medium text-pm-noir">{c.organizationName}</span>
                  <span className="text-xs text-pm-gris">({formatNumber(c.count, locale)})</span>
                </div>
                <Link href={clientHref(c.organizationId, "")} className="text-xs font-medium text-pm-bleu-eu hover:text-pm-g-blue-2">
                  {inboxT.viewClient}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className={panelClass}>
          <p className={panelTitleClass}>{inboxT.sections.syncErrors}</p>
          {syncErrorItems.length === 0 ? (
            <EmptyState icon={<NAV_ICONS.gauge width={20} height={20} />} title={inboxT.empty.syncErrors} />
          ) : (
            <div className="mt-3 flex flex-col">
              {sortByLevel(syncErrorItems).map((item) => (
                <Link key={item.id} href={item.href} className="flex items-center justify-between gap-3 border-t border-pm-gris-2 py-3 text-sm first:border-t-0 hover:bg-pm-gris-2/15">
                  <span className="font-medium text-pm-noir">{item.organizationName}</span>
                  <Badge label={String(item.data.product)} className={SEMANTIC_CLASS.bad} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{inboxT.sections.clientsAtRisk}</p>
          {clientsAtRiskItems.length === 0 ? (
            <EmptyState icon={<NAV_ICONS.users width={20} height={20} />} title={inboxT.empty.clientsAtRisk} />
          ) : (
            <div className="mt-3 flex flex-col">
              {clientsAtRiskItems.map((item) => (
                <Link key={item.id} href={item.href} className="flex flex-col gap-0.5 border-t border-pm-gris-2 py-3 text-sm first:border-t-0 hover:bg-pm-gris-2/15">
                  <span className="font-medium text-pm-noir">{item.organizationName}</span>
                  <span className="text-xs text-pm-gris">
                    {item.data.lastInteractionAt
                      ? inboxT.clientsAtRiskLastInteraction(Math.floor((now.getTime() - (item.data.lastInteractionAt as Date).getTime()) / (24 * 60 * 60 * 1000)))
                      : inboxT.clientsAtRiskNever}
                  </span>
                  <span className="text-xs text-pm-gris">{inboxT.activeDeal(String(item.data.dealTitle))}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className={panelClass}>
          <p className={panelTitleClass}>{inboxT.sections.moneyFollowUp}</p>
          {moneyItems.length === 0 ? (
            <EmptyState icon={<NAV_ICONS.creditCard width={20} height={20} />} title={inboxT.empty.moneyFollowUp} />
          ) : (
            <div className="mt-3 flex flex-col">
              {sortByLevel(moneyItems).map((item) => {
                const kind = String(item.data.kind);
                const number = String(item.data.invoiceNumber ?? item.data.quoteNumber ?? "");
                const label =
                  kind === "delivery_failed"
                    ? inboxT.invoiceDeliveryFailed(number)
                    : kind === "overdue"
                      ? inboxT.invoiceOverdue(number)
                      : kind === "no_response"
                        ? inboxT.quoteNoResponse(number)
                        : inboxT.quoteAccepted(number);
                return (
                  <Link key={item.id} href={item.href} className="flex items-center justify-between gap-3 border-t border-pm-gris-2 py-3 text-sm first:border-t-0 hover:bg-pm-gris-2/15">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-pm-noir">{item.organizationName}</span>
                      <span className="text-xs text-pm-gris">{label}</span>
                    </div>
                    <Badge label={inboxT.levels[item.level]} className={SEMANTIC_CLASS[LEVEL_TONE[item.level]]} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{inboxT.sections.syncHealth}</p>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-pm-gris">{inboxT.syncHealthConnected(syncHealth.totalConnected)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-pm-gris">{inboxT.syncHealthOk(syncHealth.syncedOk)}</span>
              <Badge label={formatNumber(syncHealth.syncedOk, locale)} className={SEMANTIC_CLASS.good} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-pm-gris">{inboxT.syncHealthNeeds(syncHealth.needsSync)}</span>
              <Badge label={formatNumber(syncHealth.needsSync, locale)} className={SEMANTIC_CLASS.warm} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-pm-gris">{inboxT.syncHealthError(syncHealth.inError)}</span>
              <Badge label={formatNumber(syncHealth.inError, locale)} className={SEMANTIC_CLASS.bad} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className={panelClass}>
          <p className={panelTitleClass}>{inboxT.sections.recentAudits}</p>
          {recentAuditRows.length === 0 ? (
            <EmptyState icon={<NAV_ICONS.fileText width={20} height={20} />} title={inboxT.empty.recentAudits} />
          ) : (
            <div className="mt-3 flex flex-col">
              {recentAuditRows.map((row) => (
                <Link key={row.id} href={clientHref(row.organizationId, "audits")} className="flex items-center justify-between gap-3 border-t border-pm-gris-2 py-3 text-sm first:border-t-0 hover:bg-pm-gris-2/15">
                  <span className="font-medium text-pm-noir">{row.organizationName}</span>
                  <span className="text-xs text-pm-gris">{formatRelativeTime(row.createdAt, locale)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{inboxT.sections.recentDocuments}</p>
          {recentDocRows.length === 0 ? (
            <EmptyState icon={<NAV_ICONS.folder width={20} height={20} />} title={inboxT.empty.recentDocuments} />
          ) : (
            <div className="mt-3 flex flex-col">
              {recentDocRows.map((row) => (
                <Link key={row.id} href={clientHref(row.organizationId, "")} className="flex items-center justify-between gap-3 border-t border-pm-gris-2 py-3 text-sm first:border-t-0 hover:bg-pm-gris-2/15">
                  <span className="min-w-0 flex-1 truncate font-medium text-pm-noir">{row.fileName}</span>
                  <span className="shrink-0 text-xs text-pm-gris">{formatRelativeTime(row.createdAt, locale)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`mt-5 ${panelClass}`}>
        <p className={panelTitleClass}>{t.title}</p>
        <p className="text-xs text-pm-gris">{t.subtitle}</p>

        {orgs.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
            <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
            <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">{t.columns.name}</th>
                  <th className="px-5 py-3">{t.columns.members}</th>
                  <th className="px-5 py-3">{t.columns.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr key={org.id} className="border-t border-pm-gris-2">
                    <td className="px-5 py-3 font-medium text-pm-noir">{org.name}</td>
                    <td className="px-5 py-3 text-pm-gris">{formatNumber(org.memberCount, locale)}</td>
                    <td className="px-5 py-3 text-pm-gris">{formatDate(org.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
