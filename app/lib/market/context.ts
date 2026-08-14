/**
 * Single source of truth for PUBLIC-MAP's own commercial market
 * (Canada/Europe) — currency, region and default-locale for every
 * PUBLIC-MAP-internal feature (pricing, invoices, future market
 * trends/benchmarks). See db/schema.ts's `organizations.market` for where
 * this is persisted, and app/dashboard/google-ads/ for the ONE deliberate
 * exception: a Google Ads account's own native currency is never derived
 * from or replaced by this.
 *
 * Every call site that needs market/currency/region MUST go through
 * `resolveMarketContext()` — never re-implement the CANADA/EUROPE ->
 * CAD/EUR mapping locally.
 */

export const MARKETS = ["CANADA", "EUROPE"] as const;
export type Market = (typeof MARKETS)[number];

export function isMarket(value: unknown): value is Market {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

export type MarketContext = {
  market: Market;
  currency: "CAD" | "EUR";
  region: "CA" | "EU";
  // A REPLI only — never overrides the visitor's own explicit language
  // cookie (see lib/i18n/locale.ts's getLocale()), which stays the real
  // source of truth for UI language regardless of market.
  defaultLocale: "fr" | "en";
  marketLabel: { fr: string; en: string };
};

const MARKET_CONTEXTS: Record<Market, MarketContext> = {
  CANADA: {
    market: "CANADA",
    currency: "CAD",
    region: "CA",
    defaultLocale: "fr", // PUBLIC-MAP's own default market — most Canadian clients so far are Québec-based; still just a repli, never forced.
    marketLabel: { fr: "Canada", en: "Canada" },
  },
  EUROPE: {
    market: "EUROPE",
    currency: "EUR",
    region: "EU",
    defaultLocale: "fr",
    marketLabel: { fr: "Europe", en: "Europe" },
  },
};

/**
 * Resolves the full market context for an organization's stored `market`
 * value. Returns `null` for an organization with no market set yet
 * (pre-existing organizations, or one not yet configured by staff) —
 * every caller must handle that "unknown market" state explicitly, never
 * default it to CANADA or EUROPE.
 *
 * Takes the raw value already read from the authenticated session/
 * organization row — this function never itself reads a request, a
 * cookie, or anything browser-supplied, so a client can never influence
 * which market's data/pricing they see by passing a different value.
 */
export function resolveMarketContext(market: Market | null | undefined): MarketContext | null {
  if (!market) return null;
  return MARKET_CONTEXTS[market];
}
