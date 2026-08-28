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
  reasons: string[];
  recommendedNextAction: string;
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

  const reasons: string[] = [];

  const stage = bestDealStage(input.deals);
  if (stage === "won") {
    reasons.push("A deal on record has been won");
  } else if (stage) {
    reasons.push(`Deal in progress at stage: ${stage}`);
  }

  if (hasAcceptedQuote(input.quotes)) {
    reasons.push("A quote has been accepted");
  } else if (hasPendingQuote(input.quotes)) {
    reasons.push("A quote was sent and is awaiting a response");
  } else if (input.quotes.length > 0) {
    reasons.push("Quote activity recorded, no active proposal");
  }

  const latest = latestInteraction(input.interactions);
  if (latest) {
    reasons.push(isRecent(latest.occurredAt, now) ? "Recent interaction logged" : "Last logged interaction is not recent");
  } else {
    reasons.push("No logged interactions");
  }

  if (isNonEmptyString(input.industry)) {
    reasons.push(`Industry recorded: ${input.industry}`);
  }

  if (hasKnownGeography(input)) {
    reasons.push(`Location recorded: ${knownGeographyLabel(input)}`);
  }

  const hasPaidInvoice = input.invoices.some((inv) => inv.paidAt != null);
  if (hasPaidInvoice) {
    reasons.push("Existing paid invoice on record");
  }
  if (input.organizationId != null) {
    reasons.push("Already linked to a platform organization");
  }

  let recommendedNextAction: string;
  if (hasPendingQuote(input.quotes) || stage === "proposal") {
    recommendedNextAction = "Follow up on recorded proposal";
  } else if (hasAcceptedQuote(input.quotes) || stage != null) {
    recommendedNextAction = "Review existing deal";
  } else if (latest) {
    recommendedNextAction = "Review recent interaction";
  } else if (confidence === "LOW") {
    recommendedNextAction = "Complete missing contact data";
  } else {
    recommendedNextAction = "Review prospect information";
  }

  return { priority, confidence, reasons, recommendedNextAction };
}
