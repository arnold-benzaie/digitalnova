"use server";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoices, crmQuotes, crmWebsites, deals, discoveryResults, interactions, staffMembers, tasks, users } from "@/db/schema";
import { requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { getInternalOrganizationId } from "@/lib/notifications";
import { assessQualification } from "@/lib/radar/qualification";
import {
  assessOpportunity,
  type Confidence,
  type Priority,
  type RadarNextActionCode,
  type RadarReason,
} from "@/lib/radar/score";
import { assessSignals, type RadarSignal } from "@/lib/radar/signals";
import { assessOpportunities, type RadarOpportunity } from "@/lib/radar/opportunities";
import { assessPriority, type PriorityAdjustment } from "@/lib/radar/priority";

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
  // RADAR-CORE-3F — semantic reason descriptors + a next-action code, not
  // localized prose. The RADAR page maps these to FR/EN copy; the read
  // model stays locale-free. NEVER a scoring / ranking / filter signal.
  reasons: RadarReason[];
  recommendedNextAction: RadarNextActionCode;
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
  // RADAR-CORE-3E — the id + structured assignee of that SAME next
  // follow-up, so a queue quick action (Claim / Complete) mutates one
  // unambiguous task. The row is picked deterministically: due_date ASC,
  // then created_at ASC, then id ASC (pickNextFollowUp below) — never DB
  // row order. Both null when there is no such follow-up;
  // nextFollowUpAssignedUserId is also null when the follow-up is
  // unassigned. Display / action context ONLY — never fed to
  // qualification, scoring, ranking, or the filter predicates. The
  // assignee is NOT resolved to a name here: the queue's Owner column is
  // the PROSPECT owner, and a second owner name would compete with it.
  nextFollowUpTaskId: string | null;
  nextFollowUpAssignedUserId: string | null;
  // MICRO-STEP 1 — read-only visibility of the Discovery row already linked
  // to this prospect (discoveryResults.crmClientId), when one exists. Pure
  // display context, exactly like assignedUserName/nextFollowUpTaskId
  // above: NEVER read by assessQualification / assessOpportunity / the
  // ranking comparator, and never a filter predicate. null when the
  // prospect has no linked discovery_results row (e.g. created manually,
  // or converted before this field existed).
  discoverySource: { category: string | null; website: string | null; businessStatus: string | null } | null;
  // MICRO-STEP 2 — pure, deterministic, read-only Signals Engine output
  // (lib/radar/signals.ts::assessSignals()). Display context ONLY — same
  // discipline as discoverySource above: NEVER read by
  // assessQualification / assessOpportunity / the ranking comparator, and
  // never a filter predicate. An empty array is a valid, real outcome.
  signals: RadarSignal[];
  // MICRO-STEP 3 — pure, deterministic, read-only Opportunity Engine
  // output (lib/radar/opportunities.ts::assessOpportunities()), computed
  // from `signals` above and nothing else. Same display-context
  // discipline: NEVER read by assessQualification / assessOpportunity /
  // the ranking comparator, never a filter predicate. An empty array is a
  // valid, real outcome.
  opportunities: RadarOpportunity[];
  // MICRO-STEP 4B/4D.2 — Priority V2 (lib/radar/priority.ts). basePriority
  // always equals `priority` above (kept for compatibility). Since 4D.2 the
  // ranking comparator (finalPriority, then basePriority), the priority
  // filter and the page badge all read finalPriority; priorityAdjustments
  // stays informational only.
  basePriority: Priority;
  finalPriority: Priority;
  priorityAdjustments: PriorityAdjustment[];
};

/**
 * MICRO-STEP 4F.7.3 — deterministic choice between two discovery_results rows
 * linked to the SAME crm_client (not expected — convertDiscoveryResult() links
 * exactly one row per created client — but not DB-enforced). True when
 * `candidate` must replace `current`: the more recent discoveredAt wins; on a
 * tie, the lexicographically greater id. Independent of DB row order.
 */
function isPreferredDiscoveryRow(candidate: { id: string; discoveredAt: Date }, current: { id: string; discoveredAt: Date }): boolean {
  const discoveredDiff = candidate.discoveredAt.getTime() - current.discoveredAt.getTime();
  if (discoveredDiff !== 0) return discoveredDiff > 0;
  return candidate.id > current.id;
}

/**
 * RADAR-CORE-3E — total order over a prospect's OPEN dated follow-ups so a
 * queue quick action targets ONE unambiguous task: earlier due_date wins;
 * on a tie, earlier created_at; on a further tie, the lexicographically
 * smaller id. Mirrors the ranking comparator's createdAt -> id final
 * tie-break. Pure and independent of DB row order (the caller passes the
 * already-fetched batch rows). Not exported — a "use server" module may
 * only export async server actions.
 */
function pickNextFollowUp<T extends { id: string; dueDate: Date; createdAt: Date }>(
  rows: readonly T[],
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null) {
      best = row;
      continue;
    }
    const dueDiff = row.dueDate.getTime() - best.dueDate.getTime();
    if (dueDiff < 0) {
      best = row;
      continue;
    }
    if (dueDiff > 0) continue;
    const createdDiff = row.createdAt.getTime() - best.createdAt.getTime();
    if (createdDiff < 0) {
      best = row;
      continue;
    }
    if (createdDiff > 0) continue;
    if (row.id < best.id) best = row;
  }
  return best;
}

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
 * RADAR GATE UNIFICATION — the access gate is requireStaffMember(
 * "RADAR_QUEUE_VIEW") (Axis-C: OWNER/ADMIN/MANAGER/EMPLOYEE via a real
 * ACTIVE staff_members row), never the legacy Axis-A requireStaffRole().
 * An Axis-A "agent"/"supervisor"/"staff"/"admin" identity with no matching
 * Axis-C staff_members row is denied — Axis-A no longer decides RADAR
 * read access on its own. This aligns the read gate with the mutation
 * gates in radar-assignment.ts (RADAR_WORK / RADAR_ASSIGN), which were
 * already Axis-C-only.
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
  await requireRadarAccess("RADAR_QUEUE_VIEW");

  const page = sanitizePage(params.page);
  const priorityFilter = sanitizePriorityFilter(params.priority);
  const assigneeFilter = sanitizeAssigneeFilter(params.assignee);
  const followUpFilter = sanitizeFollowUpFilter(params.followup);
  // Server-side only. Injectable purely so the follow-up day-window tests
  // are deterministic — identical role to score.ts::OpportunityInput.now.
  // MICRO-STEP 2 — the same resolved `now` is also passed to
  // assessSignals() below, so the whole queue computation shares ONE
  // instant, exactly like utcDayWindow's own role for follow-ups.
  const now = params.now ?? new Date();
  const { startOfToday, startOfTomorrow } = utcDayWindow(now);

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
      // MICRO-STEP 2 — read-only, for assessSignals()'s DISCOVERY_NEW
      // check only. Never fed to assessQualification / assessOpportunity /
      // the ranking comparator.
      source: crmClients.source,
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
  const [clientDeals, clientInteractions, clientQuotes, clientInvoices, clientOpenFollowUps, clientDiscoverySources, clientCrmWebsites] = await Promise.all([
    db
      .select({ id: deals.id, clientId: deals.clientId, stage: deals.stage, expectedCloseDate: deals.expectedCloseDate })
      .from(deals)
      .where(inArray(deals.clientId, qualifiedIds)),
    db
      .select({ clientId: interactions.clientId, dealId: interactions.dealId, occurredAt: interactions.occurredAt })
      .from(interactions)
      .where(inArray(interactions.clientId, qualifiedIds)),
    db
      .select({ id: crmQuotes.id, clientId: crmQuotes.clientId, dealId: crmQuotes.dealId, status: crmQuotes.status, sentAt: crmQuotes.sentAt, respondedAt: crmQuotes.respondedAt, validUntil: crmQuotes.validUntil })
      .from(crmQuotes)
      .where(inArray(crmQuotes.clientId, qualifiedIds)),
    db
      .select({ clientId: crmInvoices.clientId, paidAt: crmInvoices.paidAt })
      .from(crmInvoices)
      .where(inArray(crmInvoices.clientId, qualifiedIds)),
    // RADAR-CORE-3B — OPEN dated follow-ups for the qualified subset. One
    // bounded read, same batched shape as the four above; the exact next
    // follow-up per client is reduced in JS below (never relying on DB row
    // order). done / cancelled / null-due are excluded in the predicate,
    // so a terminal or undated task can never surface as a follow-up.
    // RADAR-CORE-3E — the select also carries id / created_at /
    // assigned_user_id so pickNextFollowUp can choose ONE deterministic
    // row for the queue quick actions. Still ONE query, same WHERE.
    db
      .select({
        clientId: tasks.clientId,
        id: tasks.id,
        dueDate: tasks.dueDate,
        createdAt: tasks.createdAt,
        assignedUserId: tasks.assignedUserId,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.clientId, qualifiedIds),
          inArray(tasks.status, ["todo", "in_progress"]),
          isNotNull(tasks.dueDate),
        ),
      ),
    // MICRO-STEP 1 — the Discovery row already linked to a qualified
    // prospect, when one exists (discoveryResults.crmClientId). Same
    // batched inArray() shape as the four reads above — no N+1. Only the
    // three fields this micro-step exposes are read; everything else on
    // discovery_results (status, enrichmentClaimedAt, coordinates, etc.)
    // stays untouched and unread here.
    db
      .select({
        // MICRO-STEP 4F.7.3 — internal tie-break only, never exposed.
        id: discoveryResults.id,
        crmClientId: discoveryResults.crmClientId,
        category: discoveryResults.category,
        website: discoveryResults.website,
        businessStatus: discoveryResults.businessStatus,
        // MICRO-STEP 2 — read-only, for assessSignals()'s DISCOVERY_NEW
        // check only; never added to the publicly-exposed discoverySource
        // shape below (that shape stays exactly {category, website,
        // businessStatus}, unchanged since MICRO-STEP 1).
        discoveredAt: discoveryResults.discoveredAt,
      })
      .from(discoveryResults)
      .where(inArray(discoveryResults.crmClientId, qualifiedIds)),
    // MICRO-STEP 4F.7.1 — presence only: which qualified prospects have at
    // least one crm_websites row. clientId is the ONLY column read (never
    // url/label/id/createdAt); same batched inArray() shape, never joined
    // with discovery_results (crm_websites is 1-N).
    db
      .select({ clientId: crmWebsites.clientId })
      .from(crmWebsites)
      .where(inArray(crmWebsites.clientId, qualifiedIds)),
  ]);

  const dealsByClient = groupByClientId(clientDeals);
  // 4F.7.1 — a Set, not a count: one CRM website is enough, several are never counted.
  const crmWebsiteClientIds = new Set(clientCrmWebsites.map((row) => row.clientId));
  const interactionsByClient = groupByClientId(clientInteractions);
  const quotesByClient = groupByClientId(clientQuotes);
  // RADAR-CORE-3B/3E — OPEN dated follow-ups per qualified client;
  // pickNextFollowUp chooses the one deterministic next row below.
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
  // MICRO-STEP 1 — at most one discovery_results row per crm_client in
  // practice (convertDiscoveryResult() only ever links the ONE row that
  // created the client; an EXACT_MATCH against an existing client never
  // sets crmClientId at all — see that function's own contract), but this
  // is not a DB-enforced uniqueness constraint, so a plain Map is used rather
  // than groupByClientId's array buckets. MICRO-STEP 4F.7.3 — on a
  // hypothetical duplicate the kept row is chosen explicitly
  // (isPreferredDiscoveryRow: latest discoveredAt, then greatest id), never by
  // SQL row order.
  // MICRO-STEP 2 — discoveredAt is carried in this SAME map (one batched
  // read, no second query) purely for assessSignals()'s internal use; the
  // publicly-exposed discoverySource field below still only ever picks the
  // three MICRO-STEP 1 fields out of it, unchanged.
  const discoveryRowByClient = new Map<
    string,
    { id: string; category: string | null; website: string | null; businessStatus: string | null; discoveredAt: Date }
  >();
  for (const row of clientDiscoverySources) {
    if (row.crmClientId === null) continue;
    const current = discoveryRowByClient.get(row.crmClientId);
    if (current && !isPreferredDiscoveryRow(row, current)) continue;
    discoveryRowByClient.set(row.crmClientId, {
      id: row.id,
      category: row.category,
      website: row.website,
      businessStatus: row.businessStatus,
      discoveredAt: row.discoveredAt,
    });
  }

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
    // RADAR-CORE-3E — one deterministic next follow-up (due_date ASC,
    // created_at ASC, id ASC). nextFollowUpDueAt stays exactly
    // bestRow.dueDate, so overdue / dueToday / the followup filter are
    // behaviourally unchanged from 3B.
    const nextFollowUp = pickNextFollowUp(followUpsByClient.get(client.id) ?? []);
    const nextFollowUpDueAt = nextFollowUp?.dueDate ?? null;
    const dueMs = nextFollowUpDueAt?.getTime();
    // Computed once and shared by the RankedProspect field and the
    // FOLLOW_UP_OVERDUE signal, so "overdue" has a single definition.
    const nextFollowUpOverdue = dueMs !== undefined && dueMs < startOfToday;
    // MICRO-STEP 1 — unchanged shape: exactly the three fields, picked
    // out of the richer discoveryRowByClient map (MICRO-STEP 2 added
    // discoveredAt to that map, never to this exposed field).
    const discoveryRow = discoveryRowByClient.get(client.id) ?? null;
    const discoverySource = discoveryRow
      ? { category: discoveryRow.category, website: discoveryRow.website, businessStatus: discoveryRow.businessStatus }
      : null;
    // MICRO-STEP 2 — pure, deterministic, read-only. Never feeds back into
    // assessQualification/assessOpportunity above, and its own output is
    // never read by either.
    const signals = assessSignals({
      source: client.source,
      discoverySource,
      discoveredAt: discoveryRow?.discoveredAt ?? null,
      // MICRO-STEP 4F.7.1 — presence-only CRM fact, consumed by NO_WEBSITE only.
      hasCrmWebsite: crmWebsiteClientIds.has(client.id),
      lastInteractionAt,
      // MICRO-STEP 4F.8.7 — the same already-loaded rows (dealId + occurredAt
      // only used), for the per-deal contact state of overdue deals.
      interactions: clientInteractionRows,
      // MICRO-STEP 4E.2 — already-loaded / already-derived values only.
      assignedUserId: client.assignedUserId,
      nextFollowUpDueAt,
      nextFollowUpOverdue,
      deals: dealsByClient.get(client.id) ?? [],
      quotes: quotesByClient.get(client.id) ?? [],
      now,
    });
    // MICRO-STEP 3 — consumes `signals` above and nothing else; no new DB
    // read, no re-derivation of any raw fact.
    const opportunities = assessOpportunities(signals);
    // MICRO-STEP 4B — computed from already-derived values only; not read
    // by the ranking comparator or any filter (inert exposure).
    const priorityV2 = assessPriority({ basePriority: opportunity.priority, signals, opportunities });
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
      nextFollowUpOverdue,
      nextFollowUpDueToday: dueMs !== undefined && dueMs >= startOfToday && dueMs < startOfTomorrow,
      // RADAR-CORE-3E — action context only; never scored / ranked /
      // filtered. null when there is no next follow-up (id + assignee) or
      // when it is unassigned (assignee only).
      nextFollowUpTaskId: nextFollowUp?.id ?? null,
      nextFollowUpAssignedUserId: nextFollowUp?.assignedUserId ?? null,
      discoverySource,
      signals,
      opportunities,
      basePriority: priorityV2.basePriority,
      finalPriority: priorityV2.finalPriority,
      priorityAdjustments: priorityV2.priorityAdjustments,
      _createdAt: client.createdAt,
      _id: client.id,
    };
  });

  // Deterministic Radar order: priority first, confidence/recency/createdAt
  // are tie-breakers only — none of them re-rank across a priority tier,
  // preserving Phase 1C's deliberate priority/confidence independence.
  ranked.sort((a, b) => {
    const finalDiff = PRIORITY_RANK[b.finalPriority] - PRIORITY_RANK[a.finalPriority];
    if (finalDiff !== 0) return finalDiff;

    const baseDiff = PRIORITY_RANK[b.basePriority] - PRIORITY_RANK[a.basePriority];
    if (baseDiff !== 0) return baseDiff;

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
    priorityFilter.length > 0 ? ranked.filter((r) => priorityFilter.includes(r.finalPriority)) : ranked;
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
      nextFollowUpTaskId: r.nextFollowUpTaskId,
      nextFollowUpAssignedUserId: r.nextFollowUpAssignedUserId,
      discoverySource: r.discoverySource,
      signals: r.signals,
      opportunities: r.opportunities,
      basePriority: r.basePriority,
      finalPriority: r.finalPriority,
      priorityAdjustments: r.priorityAdjustments,
    };
  });

  return { items, page, pageSize: PAGE_SIZE, totalQualified, filteredTotal, insufficientDataCount, notEligibleCount };
}
