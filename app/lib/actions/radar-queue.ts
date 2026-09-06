"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoices, crmQuotes, deals, interactions, staffMembers, users } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { getInternalOrganizationId } from "@/lib/notifications";
import { assessQualification } from "@/lib/radar/qualification";
import { assessOpportunity, type Confidence, type Priority } from "@/lib/radar/score";

const PAGE_SIZE = 20;
const HARD_CAP = 500;

const PRIORITY_VALUES: readonly Priority[] = ["LOW", "MEDIUM", "HIGH"];
const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const CONFIDENCE_RANK: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export type RankedProspect = {
  clientId: string;
  name: string;
  industry: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  stage: string;
  priority: Priority;
  confidence: Confidence;
  reasons: string[];
  recommendedNextAction: string;
  lastInteractionAt: Date | null;
  // RADAR-CORE-1B — authoritative assignment (crm_clients.assigned_user_id).
  // NEVER a scoring / ranking signal; resolved only for the paginated slice
  // that is actually returned. assignedUserId === null is the sole meaning
  // of "unassigned" — legacy free-text ownerName is never consulted.
  assignedUserId: string | null;
  // fullName ?? email of the assigned user; null when assignedUserId is
  // null, or when identity/workspace cannot be resolved for enrichment.
  assignedUserName: string | null;
  // true only when the assigned user currently has an ACTIVE staff_members
  // row in the internal workspace. A stale/removed assignee stays assigned
  // (assignedUserId kept) but reads as inactive.
  assignedUserActive: boolean;
};

// RADAR-CORE-1B — assignment filter. Resolved by the page layer: the raw
// "?assignee=me" URL token is turned into { mode: "user", userId } from the
// server session before it reaches here; getRadarQueue never sees "me".
export type RadarAssigneeFilter = { mode: "all" } | { mode: "unassigned" } | { mode: "user"; userId: string };

export type RadarQueueParams = {
  page?: number;
  priority?: Priority[];
  assignee?: RadarAssigneeFilter;
};

export type RadarQueueResult = {
  items: RankedProspect[];
  page: number;
  pageSize: number;
  // Count of QUALIFIED prospects in the bounded candidate universe, before
  // any priority filter is applied and before display pagination — the
  // literal meaning of "total qualified", not "total matching the current
  // filter".
  totalQualified: number;
  insufficientDataCount: number;
  notEligibleCount: number;
};

function sanitizePage(page: number | undefined): number {
  return Number.isInteger(page) && (page as number) >= 1 ? (page as number) : 1;
}

// Invalid entries are dropped silently, matching this codebase's existing
// convention for invalid single-value filters (see the stage filter in
// app/admin/crm/clients/page.tsx): an unrecognized value behaves as if no
// filter had been supplied, rather than erroring or excluding everything.
function sanitizePriorityFilter(priority: Priority[] | undefined): Priority[] {
  if (!priority || priority.length === 0) return [];
  return priority.filter((p): p is Priority => PRIORITY_VALUES.includes(p));
}

// RADAR-CORE-1B — same "unknown value behaves as no filter" convention as
// the priority filter above. A malformed { mode: "user" } with no string
// userId falls back to { mode: "all" } rather than erroring.
function sanitizeAssigneeFilter(assignee: RadarAssigneeFilter | undefined): RadarAssigneeFilter {
  if (!assignee) return { mode: "all" };
  if (assignee.mode === "unassigned") return { mode: "unassigned" };
  if (assignee.mode === "user" && typeof assignee.userId === "string" && assignee.userId.length > 0) {
    return { mode: "user", userId: assignee.userId };
  }
  return { mode: "all" };
}

/**
 * RADAR-CORE-1B — resolve the display identity + ACTIVE-in-internal-workspace
 * flag for the (≤ PAGE_SIZE) assigned user ids on the page actually being
 * returned. ONE batched query, never N+1. If the internal workspace cannot
 * be resolved, identity is still resolved from `users` and every row reads
 * as inactive — the queue must stay readable regardless (RADAR-CORE-1B §12).
 */
async function resolveAssignees(
  userIds: string[],
): Promise<Map<string, { name: string | null; active: boolean }>> {
  const out = new Map<string, { name: string | null; active: boolean }>();
  if (userIds.length === 0) return out;

  const internalOrgId = await getInternalOrganizationId();

  if (!internalOrgId) {
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const row of rows) {
      out.set(row.id, { name: row.fullName ?? row.email ?? null, active: false });
    }
    return out;
  }

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      staffStatus: staffMembers.status,
    })
    .from(users)
    .leftJoin(
      staffMembers,
      and(eq(staffMembers.userId, users.id), eq(staffMembers.workspaceOrgId, internalOrgId)),
    )
    .where(inArray(users.id, userIds));

  for (const row of rows) {
    out.set(row.id, {
      name: row.fullName ?? row.email ?? null,
      active: row.staffStatus === "ACTIVE",
    });
  }
  return out;
}

function groupByClientId<T extends { clientId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.clientId);
    if (bucket) bucket.push(row);
    else map.set(row.clientId, [row]);
  }
  return map;
}

/**
 * AI Commercial Radar / Phase 1D — staff-only batch read model ranking
 * QUALIFIED prospects into an explainable Radar Queue, reusing Phase 1C's
 * pure assessQualification()/assessOpportunity() unchanged. Dynamic
 * computation only: no persistence, no schema change.
 *
 * Candidate universe vs. Radar ranking — two distinct orderings, not to be
 * confused:
 * - The SQL `ORDER BY createdAt DESC, id` below only decides WHICH up to
 *   HARD_CAP prospects are pulled into evaluation. It is NOT the Radar
 *   ranking and must never be read as one.
 * - The actual Radar ranking (priority > confidence > recency > createdAt
 *   ASC > id) is computed afterwards, entirely in memory, once every
 *   candidate's qualification/opportunity is known.
 *
 * Archived and do-not-contact prospects are deliberately NOT filtered out
 * of the candidate query: every candidate is classified by
 * assessQualification(), so archived/DNC prospects still land in
 * notEligibleCount instead of silently vanishing from the bounded
 * universe's accounting. They are never passed to assessOpportunity() and
 * can never appear in `items`.
 */
export async function getRadarQueue(params: RadarQueueParams = {}): Promise<RadarQueueResult> {
  await requireStaffRole();

  const page = sanitizePage(params.page);
  const priorityFilter = sanitizePriorityFilter(params.priority);
  const assigneeFilter = sanitizeAssigneeFilter(params.assignee);

  const candidates = await db
    .select({
      id: crmClients.id,
      name: crmClients.name,
      email: crmClients.email,
      phone: crmClients.phone,
      industry: crmClients.industry,
      country: crmClients.country,
      region: crmClients.region,
      city: crmClients.city,
      stage: crmClients.stage,
      organizationId: crmClients.organizationId,
      doNotContact: crmClients.doNotContact,
      archivedAt: crmClients.archivedAt,
      createdAt: crmClients.createdAt,
      // RADAR-CORE-1B — carried through for the Assignee column + filter
      // ONLY. Never read by assessQualification / assessOpportunity / the
      // ranking comparator below.
      assignedUserId: crmClients.assignedUserId,
    })
    .from(crmClients)
    .orderBy(desc(crmClients.createdAt), crmClients.id)
    .limit(HARD_CAP);

  let insufficientDataCount = 0;
  let notEligibleCount = 0;
  const qualified: typeof candidates = [];

  for (const candidate of candidates) {
    const qualification = assessQualification({
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      doNotContact: candidate.doNotContact,
      archivedAt: candidate.archivedAt,
    });
    if (qualification.qualificationStatus === "QUALIFIED") {
      qualified.push(candidate);
    } else if (qualification.qualificationStatus === "INSUFFICIENT_DATA") {
      insufficientDataCount += 1;
    } else {
      notEligibleCount += 1;
    }
  }

  const totalQualified = qualified.length;

  if (qualified.length === 0) {
    return { items: [], page, pageSize: PAGE_SIZE, totalQualified, insufficientDataCount, notEligibleCount };
  }

  const qualifiedIds = qualified.map((c) => c.id);

  // Batched (one query per child table, not N+1): bounded inArray() reads
  // over the QUALIFIED subset only, mirroring the existing precedent in
  // lib/api-v1/audits.ts's getIssueCountsForAudits(). Never loop over the
  // qualified subset calling the single-client Phase 1C action here.
  const [clientDeals, clientInteractions, clientQuotes, clientInvoices] = await Promise.all([
    db
      .select({ clientId: deals.clientId, stage: deals.stage })
      .from(deals)
      .where(inArray(deals.clientId, qualifiedIds)),
    db
      .select({ clientId: interactions.clientId, occurredAt: interactions.occurredAt })
      .from(interactions)
      .where(inArray(interactions.clientId, qualifiedIds)),
    db
      .select({ clientId: crmQuotes.clientId, status: crmQuotes.status, sentAt: crmQuotes.sentAt, respondedAt: crmQuotes.respondedAt })
      .from(crmQuotes)
      .where(inArray(crmQuotes.clientId, qualifiedIds)),
    db
      .select({ clientId: crmInvoices.clientId, paidAt: crmInvoices.paidAt })
      .from(crmInvoices)
      .where(inArray(crmInvoices.clientId, qualifiedIds)),
  ]);

  const dealsByClient = groupByClientId(clientDeals);
  const interactionsByClient = groupByClientId(clientInteractions);
  const quotesByClient = groupByClientId(clientQuotes);
  // crmInvoices.clientId is nullable at the schema level (manual invoices
  // with no CRM client), but the inArray() filter above already guarantees
  // every returned row's clientId is one of our known qualifiedIds — this
  // filter only narrows the type to match, it never actually drops a row.
  const invoicesByClient = groupByClientId(
    clientInvoices.filter((inv): inv is typeof inv & { clientId: string } => inv.clientId !== null),
  );

  type Ranked = RankedProspect & { _createdAt: Date; _id: string };

  const ranked: Ranked[] = qualified.map((client) => {
    const clientInteractionRows = interactionsByClient.get(client.id) ?? [];
    const opportunity = assessOpportunity({
      industry: client.industry,
      country: client.country,
      region: client.region,
      city: client.city,
      organizationId: client.organizationId,
      deals: dealsByClient.get(client.id) ?? [],
      interactions: clientInteractionRows,
      quotes: quotesByClient.get(client.id) ?? [],
      invoices: invoicesByClient.get(client.id) ?? [],
    });
    const lastInteractionAt = clientInteractionRows.reduce<Date | null>(
      (latest, i) => (!latest || i.occurredAt > latest ? i.occurredAt : latest),
      null,
    );
    return {
      clientId: client.id,
      name: client.name,
      industry: client.industry,
      country: client.country,
      region: client.region,
      city: client.city,
      stage: client.stage,
      priority: opportunity.priority,
      confidence: opportunity.confidence,
      reasons: opportunity.reasons,
      recommendedNextAction: opportunity.recommendedNextAction,
      lastInteractionAt,
      // Assignment is carried, never scored. Name / active are resolved
      // after ranking + pagination, only for the returned slice.
      assignedUserId: client.assignedUserId,
      assignedUserName: null,
      assignedUserActive: false,
      _createdAt: client.createdAt,
      _id: client.id,
    };
  });

  // Deterministic Radar order: priority first, confidence/recency/createdAt
  // are tie-breakers only — none of them re-rank across a priority tier,
  // preserving Phase 1C's deliberate priority/confidence independence.
  ranked.sort((a, b) => {
    const priorityDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (priorityDiff !== 0) return priorityDiff;

    const confidenceDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (confidenceDiff !== 0) return confidenceDiff;

    const aTime = a.lastInteractionAt ? a.lastInteractionAt.getTime() : -Infinity;
    const bTime = b.lastInteractionAt ? b.lastInteractionAt.getTime() : -Infinity;
    if (aTime !== bTime) return bTime - aTime; // most recent interaction first; no interaction sorts last

    const createdDiff = a._createdAt.getTime() - b._createdAt.getTime(); // older prospect first
    if (createdDiff !== 0) return createdDiff;

    return a._id < b._id ? -1 : a._id > b._id ? 1 : 0; // absolute deterministic final tie-break
  });

  // Both filters are applied to the ALREADY-RANKED array, after sort and
  // before pagination, so relative Radar order is preserved within the
  // filtered subset. They compose by intersection. totalQualified /
  // insufficientDataCount / notEligibleCount are NOT touched — they keep
  // their pre-filter meaning.
  const priorityFiltered =
    priorityFilter.length > 0 ? ranked.filter((r) => priorityFilter.includes(r.priority)) : ranked;
  const filtered =
    assigneeFilter.mode === "unassigned"
      ? priorityFiltered.filter((r) => r.assignedUserId === null)
      : assigneeFilter.mode === "user"
        ? priorityFiltered.filter((r) => r.assignedUserId === assigneeFilter.userId)
        : priorityFiltered;

  const start = (page - 1) * PAGE_SIZE;
  const pageSlice = filtered.slice(start, start + PAGE_SIZE);

  const assigneeInfo = await resolveAssignees([
    ...new Set(pageSlice.map((r) => r.assignedUserId).filter((id): id is string => id !== null)),
  ]);

  const items: RankedProspect[] = pageSlice.map((r) => {
    const info = r.assignedUserId ? assigneeInfo.get(r.assignedUserId) : undefined;
    return {
      clientId: r.clientId,
      name: r.name,
      industry: r.industry,
      country: r.country,
      region: r.region,
      city: r.city,
      stage: r.stage,
      priority: r.priority,
      confidence: r.confidence,
      reasons: r.reasons,
      recommendedNextAction: r.recommendedNextAction,
      lastInteractionAt: r.lastInteractionAt,
      assignedUserId: r.assignedUserId,
      assignedUserName: info?.name ?? null,
      assignedUserActive: info?.active ?? false,
    };
  });

  return { items, page, pageSize: PAGE_SIZE, totalQualified, insufficientDataCount, notEligibleCount };
}
