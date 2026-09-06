"use server";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoices, crmQuotes, deals, interactions, staffMembers, tasks, users } from "@/db/schema";
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
  // RADAR-CORE-3B — the earliest OPEN dated follow-up for this prospect.
  // A "follow-up" is a task with this client_id, status IN
  // ("todo","in_progress"), and due_date IS NOT NULL — the 3A lifecycle
  // truth, independent of who created the task or how. done / cancelled /
  // null-due tasks never contribute. null === no such follow-up. NEVER a
  // scoring / ranking signal; resolved in the same pre-slice batch as
  // deals / interactions / quotes / invoices. overdue / dueToday are
  // derived once, server-side, from UTC calendar-day boundaries so the
  // queue filter and the page badge share one definition.
  nextFollowUpDueAt: Date | null;
  nextFollowUpOverdue: boolean;
  nextFollowUpDueToday: boolean;
};

// RADAR-CORE-1B — assignment filter. Resolved by the page layer: the raw
// "?assignee=me" URL token is turned into { mode: "user", userId } from the
// server session before it reaches here; getRadarQueue never sees "me".
export type RadarAssigneeFilter = { mode: "all" } | { mode: "unassigned" } | { mode: "user"; userId: string };

// RADAR-CORE-3B — followup is the raw URL token; sanitized here to a
// closed enum. `now` is injectable ONLY for the follow-up UTC day-window
// computation (mirrors lib/radar/score.ts::OpportunityInput.now) — it is
// never threaded into qualification, scoring, or ranking.
export type RadarFollowUpFilter = "all" | "overdue" | "due-today" | "needs";

export type RadarQueueParams = {
  page?: number;
  priority?: Priority[];
  assignee?: RadarAssigneeFilter;
  followup?: string;
  now?: Date;
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
  // RADAR-CORE-3B — exact number of ranked rows surviving ALL active row
  // filters (priority + assignee + followup), computed in memory before
  // the page slice. Equals totalQualified when no row filter is active.
  // Never a second DB count; it is filtered.length. This is the sole
  // source of pagination truth on the page.
  filteredTotal: number;
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

// RADAR-CORE-3B — same "unknown value behaves as no filter" convention as
// the priority / assignee filters above: any token other than the three
// active modes falls back to "all".
const FOLLOWUP_VALUES: readonly RadarFollowUpFilter[] = ["all", "overdue", "due-today", "needs"];

function sanitizeFollowUpFilter(followup: string | undefined): RadarFollowUpFilter {
  return followup && (FOLLOWUP_VALUES as readonly string[]).includes(followup)
    ? (followup as RadarFollowUpFilter)
    : "all";
}

/**
 * RADAR-CORE-3B — UTC calendar-day boundaries from the server `now`. The
 * 3A follow-up create form stores date-only `due_date` values as UTC
 * midnight (`new Date("YYYY-MM-DD")`), so the day window is computed in
 * UTC to stay consistent with the stored data — never the browser
 * timezone, and no timezone redesign. `overdue` = due < startOfToday;
 * `dueToday` = startOfToday <= due < startOfTomorrow; `upcoming` =
 * due >= startOfTomorrow.
 */
function utcDayWindow(now: Date): { startOfToday: number; startOfTomorrow: number } {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { startOfToday, startOfTomorrow: startOfToday + 24 * 60 * 60 * 1000 };
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
  const followUpFilter = sanitizeFollowUpFilter(params.followup);
  // Server-side only. Injectable purely so the follow-up day-window tests
  // are deterministic — identical role to score.ts::OpportunityInput.now.
  const { startOfToday, startOfTomorrow } = utcDayWindow(params.now ?? new Date());

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
    return { items: [], page, pageSize: PAGE_SIZE, totalQualified, filteredTotal: 0, insufficientDataCount, notEligibleCount };
  }

  const qualifiedIds = qualified.map((c) => c.id);

  // Batched (one query per child table, not N+1): bounded inArray() reads
  // over the QUALIFIED subset only, mirroring the existing precedent in
  // lib/api-v1/audits.ts's getIssueCountsForAudits(). Never loop over the
  // qualified subset calling the single-client Phase 1C action here.
  const [clientDeals, clientInteractions, clientQuotes, clientInvoices, clientOpenFollowUps] = await Promise.all([
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
    // RADAR-CORE-3B — OPEN dated follow-ups for the qualified subset. One
    // bounded read, same batched shape as the four above; earliest
    // due_date per client is reduced in JS below (never relying on DB row
    // order). done / cancelled / null-due are excluded in the predicate,
    // so a terminal or undated task can never surface as a follow-up.
    db
      .select({ clientId: tasks.clientId, dueDate: tasks.dueDate })
      .from(tasks)
      .where(
        and(
          inArray(tasks.clientId, qualifiedIds),
          inArray(tasks.status, ["todo", "in_progress"]),
          isNotNull(tasks.dueDate),
        ),
      ),
  ]);

  const dealsByClient = groupByClientId(clientDeals);
  const interactionsByClient = groupByClientId(clientInteractions);
  const quotesByClient = groupByClientId(clientQuotes);
  // RADAR-CORE-3B — earliest OPEN dated follow-up per qualified client.
  // clientId is non-null for every row (the inArray predicate guarantees
  // it); the type-narrowing filter only satisfies groupByClientId's
  // { clientId: string } bound, exactly like invoicesByClient below.
  const followUpsByClient = groupByClientId(
    clientOpenFollowUps.filter(
      (t): t is typeof t & { clientId: string; dueDate: Date } => t.clientId !== null && t.dueDate !== null,
    ),
  );
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
    const nextFollowUpDueAt = (followUpsByClient.get(client.id) ?? []).reduce<Date | null>(
      (earliest, t) => (!earliest || t.dueDate < earliest ? t.dueDate : earliest),
      null,
    );
    const dueMs = nextFollowUpDueAt?.getTime();
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
      // RADAR-CORE-3B — display / filter context only. overdue and
      // dueToday are derived from the single server-side UTC day window so
      // the followup filter and the page badge never disagree.
      nextFollowUpDueAt,
      nextFollowUpOverdue: dueMs !== undefined && dueMs < startOfToday,
      nextFollowUpDueToday: dueMs !== undefined && dueMs >= startOfToday && dueMs < startOfTomorrow,
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

  // All three filters are applied to the ALREADY-RANKED array, after sort
  // and before pagination, so relative Radar order is preserved within the
  // filtered subset. They compose by pure predicate intersection.
  // totalQualified / insufficientDataCount / notEligibleCount are NOT
  // touched — they keep their pre-filter meaning.
  const priorityFiltered =
    priorityFilter.length > 0 ? ranked.filter((r) => priorityFilter.includes(r.priority)) : ranked;
  const assigneeFiltered =
    assigneeFilter.mode === "unassigned"
      ? priorityFiltered.filter((r) => r.assignedUserId === null)
      : assigneeFilter.mode === "user"
        ? priorityFiltered.filter((r) => r.assignedUserId === assigneeFilter.userId)
        : priorityFiltered;
  const filtered =
    followUpFilter === "overdue"
      ? assigneeFiltered.filter((r) => r.nextFollowUpOverdue)
      : followUpFilter === "due-today"
        ? assigneeFiltered.filter((r) => r.nextFollowUpDueToday)
        : followUpFilter === "needs"
          ? assigneeFiltered.filter((r) => r.nextFollowUpDueAt === null)
          : assigneeFiltered;

  // Exact post-filter count — the sole source of pagination truth on the
  // page. Computed in memory before the slice; never a second DB count.
  const filteredTotal = filtered.length;

  const start = (page - 1) * PAGE_SIZE;
  const pageSlice = filtered.slice(start, page * PAGE_SIZE);

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
      nextFollowUpDueAt: r.nextFollowUpDueAt,
      nextFollowUpOverdue: r.nextFollowUpOverdue,
      nextFollowUpDueToday: r.nextFollowUpDueToday,
    };
  });

  return { items, page, pageSize: PAGE_SIZE, totalQualified, filteredTotal, insufficientDataCount, notEligibleCount };
}
