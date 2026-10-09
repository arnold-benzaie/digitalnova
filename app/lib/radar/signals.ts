/**
 * AI Commercial Radar / Signals Engine v1 — MICRO-STEP 2.
 *
 * DATA -> SIGNALS is the first layer of the Radar target architecture
 * (DATA -> SIGNALS -> SCORING -> OPPORTUNITY -> PRIORITY/ACTION ->
 * AI ADVISOR -> CRM/WORKFLOW). This file implements ONLY that layer.
 * No I/O, no database, no AI, no provider call — a plain function over
 * already-fetched facts, exactly like lib/radar/qualification.ts and
 * lib/radar/score.ts. Deliberately separate from both and never calls
 * either: qualification asks "is this record usable at all," scoring
 * asks "how promising is it," signals ask "what concrete, explainable
 * facts were detected about it." Nothing in this file is ever fed back
 * into assessQualification() or assessOpportunity(), and this file never
 * reads either of their outputs — the three stay independent per the
 * mission's own explicit constraint ("aucun changement du scoring
 * actuel... aucun changement de qualification").
 *
 * COLOR SEMANTICS — colors are NOT a generic severity ramp; each one has
 * one fixed meaning, per the mission's own spec:
 *   blue   = new detection / event
 *   green  = favorable signal
 *   yellow = attention
 *   orange = important problem/opportunity
 *   red    = critical
 *   purple = RESERVED for a future AI-origin signal — this deterministic
 *            engine never emits it.
 *
 * SIGNAL_SPEC is the single source of truth for each signal type's
 * color/severity/reason code — never hand-duplicated per call site, so
 * the two can never drift apart.
 */
import { RECENT_INTERACTION_THRESHOLD_DAYS } from "./score";
export { RECENT_INTERACTION_THRESHOLD_DAYS } from "./score";

export type SignalColor = "blue" | "green" | "yellow" | "orange" | "red";
export type SignalSeverity = "info" | "favorable" | "attention" | "important" | "critical";

export const RADAR_SIGNAL_TYPES = [
  "DISCOVERY_NEW",
  "NO_WEBSITE",
  "BUSINESS_CLOSED",
  "NO_RECENT_INTERACTION",
  "RECENT_ACTIVITY",
  "UNASSIGNED",
  "FOLLOW_UP_OVERDUE",
  "NO_FOLLOW_UP_SCHEDULED",
  "DEAL_ACTIVE",
  "QUOTE_PENDING",
  "DEAL_PAST_EXPECTED_CLOSE",
  "QUOTE_PAST_VALIDITY",
] as const;
export type RadarSignalType = (typeof RADAR_SIGNAL_TYPES)[number];

export const RADAR_SIGNAL_REASON_CODES = [
  "DISCOVERED_VIA_RADAR_DISCOVERY_RECENTLY",
  "DISCOVERY_WEBSITE_ABSENT",
  "DISCOVERY_BUSINESS_CLOSED_PERMANENTLY",
  "NO_INTERACTION_WITHIN_THRESHOLD",
  "INTERACTION_WITHIN_THRESHOLD",
  "PROSPECT_UNASSIGNED",
  "FOLLOW_UP_PAST_DUE",
  "NO_OPEN_DATED_FOLLOW_UP",
  "OPEN_DEAL_PRESENT",
  "QUOTE_AWAITING_RESPONSE",
  "DEAL_EXPECTED_CLOSE_PASSED",
  "QUOTE_VALIDITY_PASSED",
] as const;
export type RadarSignalReasonCode = (typeof RADAR_SIGNAL_REASON_CODES)[number];

/** Single source of truth for type -> color/severity/reason. Locale-free,
 * like lib/radar/score.ts's own RADAR_REASON_CODES — a presentation layer
 * localizes `reason`, never this module. */
const SIGNAL_SPEC = {
  DISCOVERY_NEW: { color: "blue", severity: "info", reason: "DISCOVERED_VIA_RADAR_DISCOVERY_RECENTLY" },
  NO_WEBSITE: { color: "orange", severity: "important", reason: "DISCOVERY_WEBSITE_ABSENT" },
  BUSINESS_CLOSED: { color: "red", severity: "critical", reason: "DISCOVERY_BUSINESS_CLOSED_PERMANENTLY" },
  NO_RECENT_INTERACTION: { color: "yellow", severity: "attention", reason: "NO_INTERACTION_WITHIN_THRESHOLD" },
  RECENT_ACTIVITY: { color: "green", severity: "favorable", reason: "INTERACTION_WITHIN_THRESHOLD" },
  UNASSIGNED: { color: "yellow", severity: "attention", reason: "PROSPECT_UNASSIGNED" },
  FOLLOW_UP_OVERDUE: { color: "orange", severity: "important", reason: "FOLLOW_UP_PAST_DUE" },
  NO_FOLLOW_UP_SCHEDULED: { color: "yellow", severity: "attention", reason: "NO_OPEN_DATED_FOLLOW_UP" },
  DEAL_ACTIVE: { color: "green", severity: "favorable", reason: "OPEN_DEAL_PRESENT" },
  QUOTE_PENDING: { color: "yellow", severity: "attention", reason: "QUOTE_AWAITING_RESPONSE" },
  DEAL_PAST_EXPECTED_CLOSE: { color: "orange", severity: "important", reason: "DEAL_EXPECTED_CLOSE_PASSED" },
  QUOTE_PAST_VALIDITY: { color: "orange", severity: "important", reason: "QUOTE_VALIDITY_PASSED" },
} as const satisfies Record<RadarSignalType, { color: SignalColor; severity: SignalSeverity; reason: RadarSignalReasonCode }>;

export type RadarSignalEvidence =
  | { discoveredAt: Date }
  | SignalNoWebsiteEvidence
  | { businessStatus: "CLOSED_PERMANENTLY" }
  | { lastInteractionAt: Date; thresholdDays: number }
  | { assignedUserId: null }
  | { nextFollowUpDueAt: Date }
  | { nextFollowUpDueAt: null }
  | { openDealCount: number }
  | { pendingQuoteCount: number }
  | { overdueDealCount: number; overdueDeals: SignalOverdueDeal[] }
  | { expiredQuoteCount: number; expiredQuotes: SignalExpiredQuote[] };

/** NO_WEBSITE evidence (4F.6.6): the absent Discovery website plus the
 * provenance of that Discovery row, copied verbatim from the input — never a
 * further confirmation that the business has no website. discoveredAt is the
 * Discovery date (not the date a website was checked); it is typed nullable
 * only because SignalsInput.discoveredAt is, the queue always supplies it with
 * discoverySource (same NOT NULL column of the same row). */
export type SignalNoWebsiteEvidence = {
  website: null;
  discoveryCategory: string | null;
  discoveryBusinessStatus: string | null;
  discoveredAt: Date | null;
};

/** Signals V2 fact shapes — owned here, never borrowed from score.ts.
 * A null (or absent) date means "not set" and never triggers a past-date
 * signal. */
export type SignalDealFact = { id: string; stage: string; expectedCloseDate: Date | null };
/** One open deal past its expectedCloseDate (4F.6.2 evidence). overdueDays =
 * whole UTC days between that date and the start of now's UTC day (>= 1).
 * 4F.8.7 — lastDealInteractionAt = the latest interaction that counts for THIS
 * deal: the ones linked to it (dealId === deal.id) and the client's general
 * ones (dealId NULL); interactions linked to ANOTHER deal never count.
 * dealContactState: NONE_RECORDED (none) | RECENT (within the 30-day
 * threshold) | STALE (older). */
export type SignalOverdueDeal = {
  dealId: string;
  stage: string;
  expectedCloseDate: Date;
  overdueDays: number;
  lastDealInteractionAt: Date | null;
  dealContactState: "NONE_RECORDED" | "RECENT" | "STALE";
};
/** 4F.8.7 — one interaction of the prospect, reduced to what the per-deal
 * contact state needs (never summary/type/direction/outcome/author). */
export type SignalInteractionFact = { dealId: string | null; occurredAt: Date };
export type SignalQuoteFact = { id: string; dealId: string | null; status: string; respondedAt: Date | null; validUntil: Date | null };
/** One sent, unanswered quote past its validUntil (4F.6.4 evidence). dealId is
 * the stored value verbatim (null when the quote is linked to no deal).
 * daysPastValidity = whole UTC days between validUntil and the start of now's
 * UTC day (>= 1) — a validity date passed, never a payment delay. */
export type SignalExpiredQuote = { quoteId: string; validUntil: Date; dealId: string | null; daysPastValidity: number };

export type RadarSignal = {
  type: RadarSignalType;
  color: SignalColor;
  severity: SignalSeverity;
  reason: RadarSignalReasonCode;
  evidence: RadarSignalEvidence;
  detectedAt: Date;
};

/**
 * The literal `crm_clients.source` value written exclusively by
 * convertDiscoveryResult() (lib/actions/radar-discovery-convert.ts) at the
 * moment a Discovery result becomes a CRM prospect. Kept as a local,
 * explicit literal rather than importing from that Server Action module
 * (a "use server" actions file is the wrong layer for a pure lib/radar/*
 * module to depend on) — must stay byte-for-byte identical to that file's
 * own literal.
 */
const DISCOVERY_SOURCE_LABEL = "RADAR Discovery";

/**
 * A prospect discovered via RADAR Discovery more than this many days ago
 * no longer counts as "new." A named, explicit policy threshold — not a
 * guess at product intent — deliberately distinct from
 * RECENT_INTERACTION_THRESHOLD_DAYS below: "freshly discovered" and
 * "recently engaged" are different facts about a prospect and must not
 * share one magic number.
 */
export const DISCOVERY_NEW_THRESHOLD_DAYS = 14;

// RECENT_INTERACTION_THRESHOLD_DAYS (imported above) is reused, never
// duplicated: the same 30-day interaction-recency policy threshold
// lib/radar/score.ts already established for its own INTERACTION_RECENT /
// INTERACTION_STALE reasons. One definition of "recent," shared by
// scoring and signals.

export type SignalsInput = {
  /** crm_clients.source, verbatim — never guessed from discoverySource's
   * mere presence. */
  source: string | null;
  /** The same shape lib/actions/radar-queue.ts already exposes on
   * RankedProspect.discoverySource (MICRO-STEP 1) — null when this
   * prospect has no linked discovery_results row. */
  discoverySource: { category: string | null; website: string | null; businessStatus: string | null } | null;
  /** discovery_results.discoveredAt for the SAME linked row, or null when
   * there is none. Independent of discoverySource's own null-ness check
   * only for defensive symmetry — in practice both are null/non-null
   * together (same source row). */
  discoveredAt: Date | null;
  /** MICRO-STEP 4F.7.1 — true when the prospect has at least one crm_websites
   * row (presence only, never a URL/label/id/count). Read by NO_WEBSITE only. */
  hasCrmWebsite: boolean;
  lastInteractionAt: Date | null;
  /** 4F.8.7 — every interaction of this prospect (general ones with dealId
   * NULL, and deal-linked ones), for the per-deal contact state only. The
   * prospect-level lastInteractionAt above is unchanged and still drives
   * RECENT_ACTIVITY / NO_RECENT_INTERACTION. */
  interactions: readonly SignalInteractionFact[];
  /** crm_clients.assigned_user_id — null means unassigned. */
  assignedUserId: string | null;
  /** The queue's already-computed next OPEN dated follow-up and its
   * overdue flag (UTC day window, lib/actions/radar-queue.ts) — passed
   * through verbatim so "overdue" keeps exactly one definition. */
  nextFollowUpDueAt: Date | null;
  nextFollowUpOverdue: boolean;
  deals: readonly SignalDealFact[];
  quotes: readonly SignalQuoteFact[];
  /** Injectable for deterministic tests — defaults to the real current
   * time. Mirrors lib/radar/score.ts::OpportunityInput.now. */
  now?: Date;
};

function daysSince(now: Date, past: Date): number {
  return (now.getTime() - past.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Pure, deterministic signal detection. Returns zero or more signals —
 * zero is a real, valid outcome (e.g. an assigned prospect with a future
 * follow-up, no Discovery link, no interaction, deal or quote has nothing
 * to flag). Each signal type is independently evaluated; several may
 * co-occur (e.g. DISCOVERY_NEW + NO_WEBSITE). Two pairs are mutually
 * exclusive by construction: RECENT_ACTIVITY / NO_RECENT_INTERACTION and
 * FOLLOW_UP_OVERDUE / NO_FOLLOW_UP_SCHEDULED. DEAL_ACTIVE /
 * DEAL_PAST_EXPECTED_CLOSE and QUOTE_PENDING / QUOTE_PAST_VALIDITY are
 * exclusive per deal / per quote, not per prospect (see below).
 */
export function assessSignals(input: SignalsInput): RadarSignal[] {
  const now = input.now ?? new Date();
  const signals: RadarSignal[] = [];

  // DISCOVERY_NEW — provenance must be the literal RADAR Discovery label
  // (never inferred from discoverySource alone, which could theoretically
  // be non-null while source diverges under a future code path) AND a
  // known discoveredAt within the policy threshold.
  if (input.source === DISCOVERY_SOURCE_LABEL && input.discoveredAt !== null) {
    if (daysSince(now, input.discoveredAt) <= DISCOVERY_NEW_THRESHOLD_DAYS) {
      signals.push({
        type: "DISCOVERY_NEW",
        ...SIGNAL_SPEC.DISCOVERY_NEW,
        evidence: { discoveredAt: input.discoveredAt },
        detectedAt: now,
      });
    }
  }

  // NO_WEBSITE — only representable when Discovery data actually confirms
  // the absence (discoverySource !== null). No linked Discovery row at
  // all is never read as "no website" — that would fabricate a claim
  // about a fact nothing ever checked. 4F.7.1 (model C): a website already
  // recorded in the CRM (crm_websites) also rules it out. A never-enriched
  // Discovery row remains a known, accepted limitation.
  if (input.discoverySource !== null && input.discoverySource.website === null && !input.hasCrmWebsite) {
    signals.push({
      type: "NO_WEBSITE",
      ...SIGNAL_SPEC.NO_WEBSITE,
      evidence: {
        website: null,
        discoveryCategory: input.discoverySource.category,
        discoveryBusinessStatus: input.discoverySource.businessStatus,
        discoveredAt: input.discoveredAt,
      },
      detectedAt: now,
    });
  }

  // BUSINESS_CLOSED — exact string match against the one CHECK-constrained
  // value that means "permanently closed" (db/schema.ts
  // discovery_results_business_status_check); CLOSED_TEMPORARILY and
  // OPERATIONAL never trigger this signal.
  if (input.discoverySource !== null && input.discoverySource.businessStatus === "CLOSED_PERMANENTLY") {
    signals.push({
      type: "BUSINESS_CLOSED",
      ...SIGNAL_SPEC.BUSINESS_CLOSED,
      evidence: { businessStatus: "CLOSED_PERMANENTLY" },
      detectedAt: now,
    });
  }

  // RECENT_ACTIVITY / NO_RECENT_INTERACTION — mutually exclusive by
  // construction: a prospect with a logged interaction gets exactly one
  // of the two, decided by the same recency threshold score.ts already
  // uses. A prospect with NO interaction history at all (lastInteractionAt
  // === null) gets NEITHER — there is nothing yet to call "recent" or
  // "not recent," mirroring score.ts's own INTERACTION_NONE being purely
  // informational, never a negative claim.
  if (input.lastInteractionAt !== null) {
    if (daysSince(now, input.lastInteractionAt) <= RECENT_INTERACTION_THRESHOLD_DAYS) {
      signals.push({
        type: "RECENT_ACTIVITY",
        ...SIGNAL_SPEC.RECENT_ACTIVITY,
        evidence: { lastInteractionAt: input.lastInteractionAt, thresholdDays: RECENT_INTERACTION_THRESHOLD_DAYS },
        detectedAt: now,
      });
    } else {
      signals.push({
        type: "NO_RECENT_INTERACTION",
        ...SIGNAL_SPEC.NO_RECENT_INTERACTION,
        evidence: { lastInteractionAt: input.lastInteractionAt, thresholdDays: RECENT_INTERACTION_THRESHOLD_DAYS },
        detectedAt: now,
      });
    }
  }

  // ---- Signals V2 (MICRO-STEP 4E.2) — CRM-internal facts only ----

  if (input.assignedUserId === null) {
    signals.push({ type: "UNASSIGNED", ...SIGNAL_SPEC.UNASSIGNED, evidence: { assignedUserId: null }, detectedAt: now });
  }

  // Mutually exclusive by construction: overdue requires a dated follow-up.
  if (input.nextFollowUpDueAt === null) {
    signals.push({
      type: "NO_FOLLOW_UP_SCHEDULED",
      ...SIGNAL_SPEC.NO_FOLLOW_UP_SCHEDULED,
      evidence: { nextFollowUpDueAt: null },
      detectedAt: now,
    });
  } else if (input.nextFollowUpOverdue === true) {
    signals.push({
      type: "FOLLOW_UP_OVERDUE",
      ...SIGNAL_SPEC.FOLLOW_UP_OVERDUE,
      evidence: { nextFollowUpDueAt: input.nextFollowUpDueAt },
      detectedAt: now,
    });
  }

  // Exclusion is per DEAL (4E.3): an open deal past its expectedCloseDate
  // counts toward DEAL_PAST_EXPECTED_CLOSE only; every other open deal
  // (future date, or none) counts toward DEAL_ACTIVE. A prospect with one
  // deal of each kind therefore carries both signals.
  // expectedCloseDate / validUntil are calendar dates stored as UTC midnight
  // (new Date("YYYY-MM-DD")): a date is past only once its whole UTC day is
  // over — same convention as utcDayWindow() for follow-ups in
  // lib/actions/radar-queue.ts. The due day itself is never past.
  const startOfTodayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const openDeals = input.deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const isDealPastClose = (d: SignalDealFact) =>
    d.expectedCloseDate != null && d.expectedCloseDate.getTime() < startOfTodayUtcMs;
  // 4F.8.7 — latest general interaction (dealId NULL) and latest interaction
  // per linked deal, in one pass. Only the date is ever published, so equal
  // occurredAt values cannot make the result depend on input order.
  let latestGeneralInteractionAt: Date | null = null;
  const latestInteractionAtByDeal = new Map<string, Date>();
  for (const interaction of input.interactions) {
    if (interaction.dealId == null) {
      if (latestGeneralInteractionAt === null || interaction.occurredAt > latestGeneralInteractionAt) {
        latestGeneralInteractionAt = interaction.occurredAt;
      }
    } else {
      const current = latestInteractionAtByDeal.get(interaction.dealId);
      if (current === undefined || interaction.occurredAt > current) latestInteractionAtByDeal.set(interaction.dealId, interaction.occurredAt);
    }
  }

  // Same detection as before; the overdue deals are now also listed (sorted by
  // expectedCloseDate, then dealId — never by input/SQL order).
  const overdueDeals: SignalOverdueDeal[] = openDeals
    .filter(isDealPastClose)
    .map((d) => {
      const expectedCloseDate = d.expectedCloseDate as Date;
      const linkedAt = latestInteractionAtByDeal.get(d.id) ?? null;
      const lastDealInteractionAt =
        linkedAt === null ? latestGeneralInteractionAt
        : latestGeneralInteractionAt === null || linkedAt > latestGeneralInteractionAt ? linkedAt
        : latestGeneralInteractionAt;
      return {
        dealId: d.id,
        stage: d.stage,
        expectedCloseDate,
        overdueDays: Math.ceil(daysSince(new Date(startOfTodayUtcMs), expectedCloseDate)),
        lastDealInteractionAt,
        dealContactState:
          lastDealInteractionAt === null ? "NONE_RECORDED"
          : daysSince(now, lastDealInteractionAt) <= RECENT_INTERACTION_THRESHOLD_DAYS ? "RECENT"
          : "STALE",
      } satisfies SignalOverdueDeal;
    })
    .sort((a, b) => a.expectedCloseDate.getTime() - b.expectedCloseDate.getTime() || (a.dealId < b.dealId ? -1 : a.dealId > b.dealId ? 1 : 0));
  const overdueDealCount = overdueDeals.length;
  const openDealCount = openDeals.length - overdueDealCount;
  if (openDealCount > 0) {
    signals.push({ type: "DEAL_ACTIVE", ...SIGNAL_SPEC.DEAL_ACTIVE, evidence: { openDealCount }, detectedAt: now });
  }
  if (overdueDealCount > 0) {
    signals.push({
      type: "DEAL_PAST_EXPECTED_CLOSE",
      ...SIGNAL_SPEC.DEAL_PAST_EXPECTED_CLOSE,
      evidence: { overdueDealCount, overdueDeals },
      detectedAt: now,
    });
  }

  // Same per-QUOTE exclusion: a sent, unanswered quote is either past its
  // validUntil (QUOTE_PAST_VALIDITY) or not (QUOTE_PENDING). A missing
  // validUntil never counts as past. The stored "expired" status is not
  // used: it is not reliably written.
  const awaitingQuotes = input.quotes.filter((q) => q.status === "sent" && q.respondedAt == null);
  // Same detection as before; the expired quotes are now also listed (sorted
  // by validUntil, then quoteId — never by input/SQL order).
  const expiredQuotes: SignalExpiredQuote[] = awaitingQuotes
    .filter((q) => q.validUntil != null && q.validUntil.getTime() < startOfTodayUtcMs)
    .map((q) => {
      const validUntil = q.validUntil as Date;
      return {
        quoteId: q.id,
        validUntil,
        dealId: q.dealId,
        daysPastValidity: Math.ceil(daysSince(new Date(startOfTodayUtcMs), validUntil)),
      };
    })
    .sort((a, b) => a.validUntil.getTime() - b.validUntil.getTime() || (a.quoteId < b.quoteId ? -1 : a.quoteId > b.quoteId ? 1 : 0));
  const expiredQuoteCount = expiredQuotes.length;
  const pendingQuoteCount = awaitingQuotes.length - expiredQuoteCount;
  if (pendingQuoteCount > 0) {
    signals.push({ type: "QUOTE_PENDING", ...SIGNAL_SPEC.QUOTE_PENDING, evidence: { pendingQuoteCount }, detectedAt: now });
  }
  if (expiredQuoteCount > 0) {
    signals.push({
      type: "QUOTE_PAST_VALIDITY",
      ...SIGNAL_SPEC.QUOTE_PAST_VALIDITY,
      evidence: { expiredQuoteCount, expiredQuotes },
      detectedAt: now,
    });
  }

  return signals;
}
