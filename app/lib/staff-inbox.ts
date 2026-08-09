/**
 * Centralized, pure classification rules for the staff "Inbox opérationnelle"
 * (/admin, PHASE 1A §D/E/F/G). Every function here takes plain rows already
 * fetched by the caller (app/admin/page.tsx) and returns plain UI-ready
 * data — no DB access in this file, so the rules are unit-testable without
 * mocking Drizzle, and the four-level classification can't drift between
 * the different sections that use it.
 *
 * Levels are deliberately qualitative (no invented numeric "attention
 * score"), per the approved plan:
 *   URGENT      — broken today, blocks revenue or a client-facing feature
 *   À TRAITER   — needs a human decision/action soon, not on fire
 *   À SURVEILLER — not broken, but drifting toward becoming a problem
 *   INFORMATION — purely informational, no action implied
 */

export type InboxLevel = "urgent" | "to_handle" | "to_watch" | "info";

const LEVEL_RANK: Record<InboxLevel, number> = { urgent: 0, to_handle: 1, to_watch: 2, info: 3 };
export function sortByLevel<T extends { level: InboxLevel }>(items: T[]): T[] {
  return [...items].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

// ---------------------------------------------------------------------------
// Sync health (§G) — built directly from google_oauth_connections rows.
// ---------------------------------------------------------------------------

export type OrgSyncRow = {
  organizationId: string;
  connected: boolean;
  products: { scopeGranted: boolean; state?: "ready_to_sync" | "synced" | "error" }[];
};

export type SyncHealthSummary = {
  totalConnected: number;
  syncedOk: number;
  needsSync: number;
  inError: number;
};

/** One organization counts into exactly one bucket: error beats needs-sync
 * beats synced-ok, so a partial failure still surfaces as "needs
 * attention" rather than being hidden by an unrelated product's success. */
export function computeSyncHealthSummary(rows: OrgSyncRow[]): SyncHealthSummary {
  const connected = rows.filter((r) => r.connected);
  let syncedOk = 0;
  let needsSync = 0;
  let inError = 0;
  for (const row of connected) {
    const granted = row.products.filter((p) => p.scopeGranted);
    if (granted.length === 0) continue;
    if (granted.some((p) => p.state === "error")) inError++;
    else if (granted.some((p) => p.state === "ready_to_sync")) needsSync++;
    else syncedOk++;
  }
  return { totalConnected: connected.length, syncedOk, needsSync, inError };
}

// ---------------------------------------------------------------------------
// Generic inbox item shape shared by every section below.
// ---------------------------------------------------------------------------

export type InboxItem = {
  id: string;
  level: InboxLevel;
  organizationId: string;
  organizationName: string;
  href: string;
  /** Payload the UI needs to render the line — never free text generated here. */
  data: Record<string, unknown>;
};

export type SyncErrorRow = {
  organizationId: string;
  organizationName: string;
  product: "gbp" | "analytics" | "searchConsole";
  href: string;
};

/** Every row here is already a confirmed error (filtered at the query
 * layer from google_oauth_connections) — always URGENT, it blocks a
 * client-facing feature today. */
export function buildSyncErrorItems(rows: SyncErrorRow[]): InboxItem[] {
  return rows.map((r) => ({
    id: `sync-error-${r.organizationId}-${r.product}`,
    level: "urgent" as const,
    organizationId: r.organizationId,
    organizationName: r.organizationName,
    href: r.href,
    data: { product: r.product },
  }));
}

// ---------------------------------------------------------------------------
// §E — Clients à risque d'oubli (deals stuck with no logged interaction).
// ---------------------------------------------------------------------------

/** Clearly-named, easily-changed-later constant — see PHASE 1A plan §E. */
export const CLIENT_AT_RISK_DAYS = 7;

export type DealFollowUpRow = {
  dealId: string;
  clientId: string;
  clientName: string;
  dealTitle: string;
  stage: string;
  /** Null = no interaction ever logged for this client. */
  lastInteractionAt: Date | null;
};

export function buildClientsAtRiskItems(rows: DealFollowUpRow[], now: Date): InboxItem[] {
  const cutoff = new Date(now.getTime() - CLIENT_AT_RISK_DAYS * 24 * 60 * 60 * 1000);
  return rows
    .filter((r) => r.stage !== "won" && r.stage !== "lost")
    .filter((r) => !r.lastInteractionAt || r.lastInteractionAt < cutoff)
    .map((r) => ({
      id: `risk-${r.dealId}`,
      level: "to_handle" as const,
      organizationId: r.clientId,
      organizationName: r.clientName,
      href: `/admin/crm/pipeline`,
      data: { dealTitle: r.dealTitle, stage: r.stage, lastInteractionAt: r.lastInteractionAt },
    }));
}

// ---------------------------------------------------------------------------
// §F — Money follow-up, exclusively from crmInvoices / crmQuotes.
// ---------------------------------------------------------------------------

export type InvoiceFollowUpRow = {
  id: string;
  clientId: string | null;
  clientName: string;
  invoiceNumber: string;
  status: string; // crmInvoices.status
  dueAt: Date | null;
};

export type QuoteFollowUpRow = {
  id: string;
  clientId: string;
  clientName: string;
  quoteNumber: string;
  status: string; // crmQuotes.status
  sentAt: Date | null;
  respondedAt: Date | null;
};

export function buildMoneyFollowUpItems(invoices: InvoiceFollowUpRow[], quotes: QuoteFollowUpRow[], now: Date): InboxItem[] {
  const items: InboxItem[] = [];

  for (const inv of invoices) {
    if (inv.status === "delivery_failed") {
      items.push({
        id: `invoice-failed-${inv.id}`,
        level: "urgent",
        organizationId: inv.clientId ?? inv.id,
        organizationName: inv.clientName,
        href: "/admin/crm/invoices",
        data: { kind: "delivery_failed", invoiceNumber: inv.invoiceNumber },
      });
    } else if (inv.status === "sent" && inv.dueAt && inv.dueAt < now) {
      items.push({
        id: `invoice-overdue-${inv.id}`,
        level: "to_handle",
        organizationId: inv.clientId ?? inv.id,
        organizationName: inv.clientName,
        href: "/admin/crm/invoices",
        data: { kind: "overdue", invoiceNumber: inv.invoiceNumber, dueAt: inv.dueAt },
      });
    }
  }

  for (const q of quotes) {
    if (q.status === "sent" && !q.respondedAt) {
      items.push({
        id: `quote-no-response-${q.id}`,
        level: "to_handle",
        organizationId: q.clientId,
        organizationName: q.clientName,
        href: "/admin/crm/quotes",
        data: { kind: "no_response", quoteNumber: q.quoteNumber, sentAt: q.sentAt },
      });
    } else if (q.status === "accepted") {
      items.push({
        id: `quote-accepted-${q.id}`,
        level: "info",
        organizationId: q.clientId,
        organizationName: q.clientName,
        href: "/admin/crm/quotes",
        data: { kind: "accepted", quoteNumber: q.quoteNumber },
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// §D — dedup: a client with several open problems must appear once in
// "Clients nécessitant attention", at its single highest severity level.
// ---------------------------------------------------------------------------

export function groupClientsNeedingAttention(items: InboxItem[]): { organizationId: string; organizationName: string; level: InboxLevel; count: number }[] {
  const byOrg = new Map<string, { organizationName: string; level: InboxLevel; count: number }>();
  for (const item of items) {
    const existing = byOrg.get(item.organizationId);
    if (!existing) {
      byOrg.set(item.organizationId, { organizationName: item.organizationName, level: item.level, count: 1 });
    } else {
      existing.count += 1;
      if (LEVEL_RANK[item.level] < LEVEL_RANK[existing.level]) existing.level = item.level;
    }
  }
  return sortByLevel(Array.from(byOrg, ([organizationId, v]) => ({ organizationId, ...v })));
}
