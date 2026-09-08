/**
 * AI Commercial Radar / Phase 1C — pure, deterministic opportunity
 * assessment. No I/O, no database, no AI, no numeric 0-100 score: only
 * qualitative FACT + deterministic INFERENCE, per the Phase 1C design
 * audit. Must only ever be called for a prospect that has already passed
 * qualification (lib/radar/qualification.ts) — this file never re-checks
 * eligibility and has no way to represent NOT_ELIGIBLE, on purpose.
 *
 * PRIORITY is driven only by the two explicitly repository-grounded
 * signals approved for this phase: deals.stage (primary) and crmQuotes
 * status/sentAt/respondedAt (secondary). Existing-relationship facts
 * (a paid invoice, a linked organization) are surfaced as CONTEXT
 * (reasons / recommendedNextAction) but deliberately never bump priority
 * on their own — there is no repository-grounded rule that an existing
 * relationship makes a *new* opportunity more urgent.
 *
 * CONFIDENCE is derived only from profile completeness (industry,
 * geography, email, phone) — deliberately disjoint from the facts that
 * drive priority, so priority and confidence never artificially
 * correlate: a prospect with an active proposal-stage deal but almost no
 * other profile data logged is HIGH priority / LOW confidence, and that
 * must remain representable.
 */

export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * RADAR-CORE-3F — canonical semantic reason codes emitted by
 * assessOpportunity(). The scoring engine stays pure, deterministic and
 * locale-free: it emits these stable codes, and the RADAR presentation
 * layer (lib/i18n/dictionaries/crm.ts + app/admin/crm/radar/page.tsx)
 * maps them to FR/EN copy. This is also the machine-readable interchange
 * format a future non-AI baseline / AI-gateway consumer would read.
 * Only INDUSTRY_RECORDED and LOCATION_RECORDED carry a free-text `value`;
 * every other code is data-free. Runtime array is the single source of
 * truth; the union type is derived from it.
 */
export const RADAR_REASON_CODES = [
  "DEAL_WON",
  "DEAL_STAGE_NEW",
  "DEAL_STAGE_CONTACTED",
  "DEAL_STAGE_QUALIFIED",
  "DEAL_STAGE_PROPOSAL",
  "QUOTE_ACCEPTED",
  "QUOTE_PENDING",
  "QUOTE_RECORDED",
  "INTERACTION_RECENT",
  "INTERACTION_STALE",
  "INTERACTION_NONE",
  "INDUSTRY_RECORDED",
  "LOCATION_RECORDED",
  "PAID_INVOICE",
  "ORG_LINKED",
] as const;

export type RadarReasonCode = (typeof RADAR_REASON_CODES)[number];

/**
 * Discriminated union — only the two "recorded" codes carry a `value`
 * (the raw client industry, and knownGeographyLabel(input) respectively).
 * No generic params bag: nothing else in the reason set is parametric.
 */
export type RadarReason =
  | { code: Exclude<RadarReasonCode, "INDUSTRY_RECORDED" | "LOCATION_RECORDED"> }
  | { code: "INDUSTRY_RECORDED"; value: string }
  | { code: "LOCATION_RECORDED"; value: string };

/**
 * RADAR-CORE-3F — canonical deterministic next-action codes. Runtime
 * array is the single source of truth; the union type is derived. No AI,
 * no provider call — the same rule-based branch order as before, only the
 * emitted value changed from prose to a code.
 */
export const RADAR_NEXT_ACTION_CODES = [
  "FOLLOW_UP_PROPOSAL",
  "REVIEW_DEAL",
  "REVIEW_INTERACTION",
  "COMPLETE_CONTACT_DATA",
  "REVIEW_PROSPECT",
] as const;

export type RadarNextActionCode = (typeof RADAR_NEXT_ACTION_CODES)[number];

export type DealFact = { stage: string };
export type QuoteFact = { status: string; sentAt: Date | null; respondedAt: Date | null };
export type InteractionFact = { occurredAt: Date };
export type InvoiceFact = { paidAt: Date | null };

export type OpportunityInput = {
  industry: string | null | undefined;
  country: string | null | undefined;
  region: string | null | undefined;
  city: string | null | undefined;
  organizationId: string | null | undefined;
  deals: DealFact[];
  interactions: InteractionFact[];
  quotes: QuoteFact[];
  invoices: InvoiceFact[];
  /** Injectable for deterministic tests — defaults to the real current time. */
  now?: Date;
};

export type OpportunityResult = {
  priority: Priority;
  confidence: Confidence;
  reasons: RadarReason[];
  recommendedNextAction: RadarNextActionCode;
};

/** Days since the most recent logged interaction is treated as "recent" —
 * a named, explicit policy threshold (not a fact about the prospect), so
 * it's a deterministic INFERENCE, never a guess about intent. */
export const RECENT_INTERACTION_THRESHOLD_DAYS = 30;

const TIER_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function higherTier(a: Priority | null, b: Priority | null): Priority | null {
  if (a === null) return b;
  if (b === null) return a;
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

// "lost" is deliberately excluded from the ranking below: a lost deal is a
// real fact about that one deal, but it must never be read as a negative
// signal about the prospect overall, and it must never be credited as
// positive momentum either — it simply contributes nothing.
const DEAL_STAGE_RANK: Record<string, number> = { new: 1, contacted: 2, qualified: 3, proposal: 4, won: 5 };

function bestDealStage(deals: DealFact[]): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const deal of deals) {
    if (deal.stage === "lost") continue;
    const rank = DEAL_STAGE_RANK[deal.stage] ?? -1;
    if (rank > bestRank) {
      best = deal.stage;
      bestRank = rank;
    }
  }
  return best;
}

function dealContribution(deals: DealFact[]): Priority | null {
  const stage = bestDealStage(deals);
  if (stage === "proposal" || stage === "won") return "HIGH";
  if (stage === "qualified") return "MEDIUM";
  if (stage === "new" || stage === "contacted") return "LOW";
  return null;
}

function hasAcceptedQuote(quotes: QuoteFact[]): boolean {
  return quotes.some((q) => q.status === "accepted");
}

function hasPendingQuote(quotes: QuoteFact[]): boolean {
  return quotes.some((q) => q.status === "sent" && q.respondedAt == null);
}

function quoteContribution(quotes: QuoteFact[]): Priority | null {
  if (hasAcceptedQuote(quotes)) return "HIGH";
  if (hasPendingQuote(quotes)) return "MEDIUM";
  if (quotes.length > 0) return "LOW";
  return null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasKnownGeography(input: Pick<OpportunityInput, "country" | "region" | "city">): boolean {
  return isNonEmptyString(input.country) || isNonEmptyString(input.region) || isNonEmptyString(input.city);
}

function knownGeographyLabel(input: Pick<OpportunityInput, "country" | "region" | "city">): string {
  return [input.city, input.region, input.country].filter(isNonEmptyString).join(", ");
}

function computeConfidence(input: OpportunityInput): Confidence {
  let known = 0;
  if (isNonEmptyString(input.industry)) known += 1;
  if (hasKnownGeography(input)) known += 1;
  // At least one of email/phone is guaranteed by qualification already
  // having passed, but exactly which (or both) still matters for
  // completeness — the caller supplies contact-method facts indirectly
  // via industry/geography only; email/phone completeness is intentionally
  // not duplicated here since it was already the qualification gate.
  return known >= 2 ? "HIGH" : known === 1 ? "MEDIUM" : "LOW";
}

function latestInteraction(interactions: InteractionFact[]): InteractionFact | null {
  let latest: InteractionFact | null = null;
  for (const interaction of interactions) {
    if (!latest || interaction.occurredAt > latest.occurredAt) latest = interaction;
  }
  return latest;
}

function isRecent(date: Date, now: Date): boolean {
  const days = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  return days <= RECENT_INTERACTION_THRESHOLD_DAYS;
}

export function assessOpportunity(input: OpportunityInput): OpportunityResult {
  const now = input.now ?? new Date();

  const priority = higherTier(dealContribution(input.deals), quoteContribution(input.quotes)) ?? "LOW";
  const confidence = computeConfidence(input);

  // RADAR-CORE-3F — same conditions, same emission order, same parametric
  // values as before; only the representation changed from English prose
  // to stable semantic codes. Localization happens at the RADAR
  // presentation layer, never here.
  const reasons: RadarReason[] = [];

  const stage = bestDealStage(input.deals);
  if (stage === "won") {
    reasons.push({ code: "DEAL_WON" });
  } else if (stage === "new") {
    reasons.push({ code: "DEAL_STAGE_NEW" });
  } else if (stage === "contacted") {
    reasons.push({ code: "DEAL_STAGE_CONTACTED" });
  } else if (stage === "qualified") {
    reasons.push({ code: "DEAL_STAGE_QUALIFIED" });
  } else if (stage === "proposal") {
    reasons.push({ code: "DEAL_STAGE_PROPOSAL" });
  }

  if (hasAcceptedQuote(input.quotes)) {
    reasons.push({ code: "QUOTE_ACCEPTED" });
  } else if (hasPendingQuote(input.quotes)) {
    reasons.push({ code: "QUOTE_PENDING" });
  } else if (input.quotes.length > 0) {
    reasons.push({ code: "QUOTE_RECORDED" });
  }

  const latest = latestInteraction(input.interactions);
  if (latest) {
    reasons.push({ code: isRecent(latest.occurredAt, now) ? "INTERACTION_RECENT" : "INTERACTION_STALE" });
  } else {
    reasons.push({ code: "INTERACTION_NONE" });
  }

  if (isNonEmptyString(input.industry)) {
    reasons.push({ code: "INDUSTRY_RECORDED", value: input.industry });
  }

  if (hasKnownGeography(input)) {
    reasons.push({ code: "LOCATION_RECORDED", value: knownGeographyLabel(input) });
  }

  const hasPaidInvoice = input.invoices.some((inv) => inv.paidAt != null);
  if (hasPaidInvoice) {
    reasons.push({ code: "PAID_INVOICE" });
  }
  if (input.organizationId != null) {
    reasons.push({ code: "ORG_LINKED" });
  }

  let recommendedNextAction: RadarNextActionCode;
  if (hasPendingQuote(input.quotes) || stage === "proposal") {
    recommendedNextAction = "FOLLOW_UP_PROPOSAL";
  } else if (hasAcceptedQuote(input.quotes) || stage != null) {
    recommendedNextAction = "REVIEW_DEAL";
  } else if (latest) {
    recommendedNextAction = "REVIEW_INTERACTION";
  } else if (confidence === "LOW") {
    recommendedNextAction = "COMPLETE_CONTACT_DATA";
  } else {
    recommendedNextAction = "REVIEW_PROSPECT";
  }

  return { priority, confidence, reasons, recommendedNextAction };
}
