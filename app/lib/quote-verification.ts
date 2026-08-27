export const QUOTE_ACCESS_FAILURE_REASONS = ["not_found", "locked", "revoked", "expired", "rate_limited"] as const;

export type QuoteAccessFailureReason = (typeof QUOTE_ACCESS_FAILURE_REASONS)[number];

type ResolvedQuoteSnapshot = {
  id: string;
  clientId: string;
  quoteNumber: string;
  title: string;
  createdAt: Date;
  validUntil: Date | null;
  status: string;
  taxLabel: string | null;
  taxRateBasisPoints: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  notes: string | null;
};

type PublicClientIdentity = {
  name: string;
  contactName: string | null;
};

type QuoteItemSnapshot = {
  description: string;
  quantity: number;
  unitPriceCents: number;
};

export type PublicQuoteViewModel = {
  quoteNumber: string;
  title: string;
  clientName: string;
  contactName: string | null;
  createdAt: Date;
  validUntil: Date | null;
  status: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  subtotalCents: number;
  taxLabel: string | null;
  taxRateBasisPoints: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  notes: string | null;
};

type QuoteTokenResolution =
  | { ok: false; reason: QuoteAccessFailureReason }
  | { ok: true; quote: ResolvedQuoteSnapshot };

type QuoteDetails = {
  client: PublicClientIdentity;
  items: QuoteItemSnapshot[];
};

type PublicQuoteDependencies = {
  resolveToken: (token: string) => Promise<QuoteTokenResolution>;
  loadDetails: (identifiers: { quoteId: string; clientId: string }) => Promise<QuoteDetails | null>;
};

/**
 * Converts stored quote data into the only object the public UI may see.
 * Every amount and description comes from the persisted quote snapshot;
 * line totals are derived solely from each stored quantity and unit price.
 */
export function toPublicQuoteViewModel(quote: ResolvedQuoteSnapshot, details: QuoteDetails): PublicQuoteViewModel {
  return {
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    clientName: details.client.name,
    contactName: details.client.contactName,
    createdAt: quote.createdAt,
    validUntil: quote.validUntil,
    status: quote.status,
    items: details.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.quantity * item.unitPriceCents,
    })),
    subtotalCents: quote.subtotalCents,
    taxLabel: quote.taxLabel,
    taxRateBasisPoints: quote.taxRateBasisPoints,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    currency: quote.currency,
    notes: quote.notes,
  };
}

/**
 * Security boundary shared by production and unit tests. The token resolver
 * authorizes exactly one quote before internal identifiers can be used for
 * the two scoped detail reads; neither identifier is returned to the UI.
 */
export async function resolvePublicQuote(token: string, dependencies: PublicQuoteDependencies) {
  const resolved = await dependencies.resolveToken(token);
  if (!resolved.ok) return resolved;

  const details = await dependencies.loadDetails({ quoteId: resolved.quote.id, clientId: resolved.quote.clientId });
  if (!details) return { ok: false as const, reason: "not_found" as const };

  return { ok: true as const, quote: toPublicQuoteViewModel(resolved.quote, details) };
}
