/**
 * AI Commercial Radar / Opportunity Engine v1 — MICRO-STEP 3.
 *
 * SIGNALS -> OPPORTUNITIES is the second layer of the Radar target
 * architecture (DATA -> SIGNALS -> SCORING -> OPPORTUNITY ->
 * PRIORITY/ACTION -> AI ADVISOR -> CRM/WORKFLOW). This file implements
 * ONLY that layer, and ONLY the one opportunity this micro-step scopes:
 * NO_WEBSITE -> WEBSITE / website_creation. No I/O, no database, no AI,
 * no provider call, no deal/task creation — a plain function over an
 * already-computed RadarSignal[] (lib/radar/signals.ts), exactly like
 * that file is itself a plain function over already-fetched facts.
 *
 * CONSUMES SIGNALS, NEVER RECOMPUTES THEM: this module has no knowledge
 * of discoverySource, website, businessStatus, interactions, or any raw
 * fact — it only ever reads the `type` of an already-produced
 * RadarSignal. The NO_WEBSITE detection rule itself lives in exactly one
 * place (lib/radar/signals.ts's assessSignals()) and is never duplicated
 * here.
 *
 * Deliberately separate from, and never calls, assessQualification() or
 * assessOpportunity() (lib/radar/score.ts's PRIORITY/CONFIDENCE engine —
 * an unfortunately similar name for a different, pre-existing layer this
 * mission must not touch). RADAR_OPPORTUNITY_* below is a NEW, distinct
 * vocabulary from RADAR_REASON_CODES / RADAR_NEXT_ACTION_CODES in
 * score.ts.
 */
import type { RadarSignal, RadarSignalType, SignalExpiredQuote, SignalNoWebsiteEvidence, SignalOverdueDeal } from "./signals";

export const RADAR_OPPORTUNITY_TYPES = ["WEBSITE", "PROPOSAL_RENEWAL", "DEAL_STALLED"] as const;
export type RadarOpportunityType = (typeof RADAR_OPPORTUNITY_TYPES)[number];

export const RADAR_OPPORTUNITY_SERVICES = ["website_creation"] as const;
export type RadarOpportunityService = (typeof RADAR_OPPORTUNITY_SERVICES)[number];

export const RADAR_OPPORTUNITY_REASON_CODES = [
  "NO_WEBSITE_DETECTED",
  "QUOTE_VALIDITY_EXPIRED_UNANSWERED",
  "DEAL_OVERDUE_NO_RECENT_CONTACT",
] as const;
export type RadarOpportunityReasonCode = (typeof RADAR_OPPORTUNITY_REASON_CODES)[number];

/** Locale-free, like RadarSignal's own `reason` — a presentation layer
 * localizes this, never this module. */
export type RadarOpportunityEvidence =
  | SignalNoWebsiteEvidence
  | { expiredQuoteCount: number; expiredQuotes: SignalExpiredQuote[] }
  | {
      overdueDealCount: number;
      overdueDeals: SignalOverdueDeal[];
      lastInteractionAt: Date | null;
    };

export type RadarOpportunity = {
  type: RadarOpportunityType;
  /** null when the opportunity is not the sale of a catalogued service
   * (e.g. renewing an existing proposal) — never an invented identifier. */
  service: RadarOpportunityService | null;
  reason: RadarOpportunityReasonCode;
  evidence: RadarOpportunityEvidence;
  /** The RadarSignalType(s) that produced this opportunity — always a
   * non-empty subset of the signals array passed in, never fabricated. */
  sourceSignals: RadarSignalType[];
};

/**
 * Pure, deterministic opportunity detection over an already-computed
 * signal list. Returns zero or more opportunities — zero is a real, valid
 * outcome (no signal present implies no opportunity detectable yet).
 *
 * MICRO-STEP 3 scope: ONLY NO_WEBSITE -> WEBSITE/website_creation.
 * MICRO-STEP 4C.1: BUSINESS_CLOSED blocks that opportunity — selling a
 * website to a permanently closed business is not a real opportunity.
 * BUSINESS_CLOSED never produces an opportunity of its own.
 * MICRO-STEP 4F.2-A: QUOTE_PAST_VALIDITY -> PROPOSAL_RENEWAL (service null).
 * BUSINESS_CLOSED blocks NEW sales (WEBSITE) only, never an opportunity on
 * an existing CRM relationship such as a quote awaiting renewal.
 * MICRO-STEP 4F.3: DEAL_PAST_EXPECTED_CLOSE -> DEAL_STALLED (service null).
 * 4F.8.7: evaluated per deal — an overdue deal whose own contact state is
 * NONE_RECORDED or STALE is stalled (see below). BUSINESS_CLOSED does not
 * block it (existing CRM relationship).
 * Emission order is fixed by this function, never by signal order:
 * WEBSITE, then PROPOSAL_RENEWAL, then DEAL_STALLED. Every other signal is
 * deliberately inert here. Future opportunity types (SEO, GBP, upsell…) are
 * explicitly out of scope and must not be added beyond their own mission.
 */
export function assessOpportunities(signals: RadarSignal[]): RadarOpportunity[] {
  const opportunities: RadarOpportunity[] = [];

  const businessClosed = signals.some((signal) => signal.type === "BUSINESS_CLOSED");
  const noWebsiteSignal = signals.find((signal) => signal.type === "NO_WEBSITE");
  if (noWebsiteSignal && !businessClosed) {
    opportunities.push({
      type: "WEBSITE",
      service: "website_creation",
      reason: "NO_WEBSITE_DETECTED",
      // 4F.6.6 — a copy of the signal's own evidence (assessSignals always
      // sets this shape on NO_WEBSITE); never recomputed. The trigger above is
      // unchanged: it still reads only the signal type.
      evidence: { ...(noWebsiteSignal.evidence as SignalNoWebsiteEvidence) },
      sourceSignals: [noWebsiteSignal.type],
    });
  }

  // The count and the expired quotes are taken from the signal's own evidence
  // (assessSignals always sets them on QUOTE_PAST_VALIDITY); never recomputed here.
  const pastValiditySignal = signals.find((signal) => signal.type === "QUOTE_PAST_VALIDITY");
  if (pastValiditySignal && "expiredQuoteCount" in pastValiditySignal.evidence) {
    opportunities.push({
      type: "PROPOSAL_RENEWAL",
      service: null,
      reason: "QUOTE_VALIDITY_EXPIRED_UNANSWERED",
      evidence: {
        expiredQuoteCount: pastValiditySignal.evidence.expiredQuoteCount,
        expiredQuotes: pastValiditySignal.evidence.expiredQuotes,
      },
      sourceSignals: [pastValiditySignal.type],
    });
  }

  // 4F.8.7 — evaluated PER DEAL: a deal is stalled when its own contact state
  // (signal evidence, never recomputed) is NONE_RECORDED or STALE. A recent
  // interaction on the prospect no longer masks every deal: only the
  // interactions counting for THAT deal (linked to it, or general) do.
  // lastInteractionAt stays prospect-level information: the real latest
  // interaction of the prospect, from whichever interaction signal is present.
  const pastCloseSignal = signals.find((signal) => signal.type === "DEAL_PAST_EXPECTED_CLOSE");
  if (pastCloseSignal && "overdueDealCount" in pastCloseSignal.evidence) {
    const stalledDeals = pastCloseSignal.evidence.overdueDeals.filter(
      (deal) => deal.dealContactState === "NONE_RECORDED" || deal.dealContactState === "STALE",
    );
    if (stalledDeals.length > 0) {
      const staleSignal = signals.find((signal) => signal.type === "NO_RECENT_INTERACTION");
      const interactionSignal = staleSignal ?? signals.find((signal) => signal.type === "RECENT_ACTIVITY");
      const lastInteractionAt =
        interactionSignal && "lastInteractionAt" in interactionSignal.evidence ? interactionSignal.evidence.lastInteractionAt : null;
      opportunities.push({
        type: "DEAL_STALLED",
        service: null,
        reason: "DEAL_OVERDUE_NO_RECENT_CONTACT",
        evidence: {
          overdueDealCount: stalledDeals.length,
          overdueDeals: stalledDeals,
          lastInteractionAt,
        },
        sourceSignals: staleSignal ? [pastCloseSignal.type, staleSignal.type] : [pastCloseSignal.type],
      });
    }
  }

  return opportunities;
}
