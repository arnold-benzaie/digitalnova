import type { Locale } from "@/lib/i18n/dictionaries";

export const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR — Euro" },
  { value: "CAD", label: "CAD — Dollar canadien" },
];
export const CURRENCY_OPTIONS_EN = [
  { value: "EUR", label: "EUR — Euro" },
  { value: "CAD", label: "CAD — Canadian dollar" },
];

export const QUOTE_STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyé" },
  { value: "accepted", label: "Accepté" },
  { value: "declined", label: "Refusé" },
  { value: "expired", label: "Expiré" },
];
export const QUOTE_STATUS_OPTIONS_EN = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
];

// "delivery_failed" is a system-set outcome of a failed send attempt (see
// lib/actions/crm-invoices.ts's deliverInvoiceEmail) — included here so it
// DISPLAYS correctly wherever the current status is shown (the list badge,
// the dropdown's own current value, the PDF), but
// lib/actions/crm-invoices.ts's updateInvoiceStatus() explicitly rejects
// it as a manually-chosen target — staff retries via RetryInvoiceDeliveryButton
// instead, never by picking this value from the dropdown.
export const INVOICE_STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyée" },
  { value: "paid", label: "Payée" },
  { value: "canceled", label: "Annulée" },
  { value: "refunded", label: "Remboursée" },
  { value: "delivery_failed", label: "Échec d'envoi" },
];
export const INVOICE_STATUS_OPTIONS_EN = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "canceled", label: "Canceled" },
  { value: "refunded", label: "Refunded" },
  { value: "delivery_failed", label: "Delivery failed" },
];

export const QUOTE_STATUS_VALUES = QUOTE_STATUS_OPTIONS.map((o) => o.value);
export const INVOICE_STATUS_VALUES = INVOICE_STATUS_OPTIONS.map((o) => o.value);
export const CURRENCY_VALUES = CURRENCY_OPTIONS.map((o) => o.value);

export function getCurrencyOptions(locale: Locale) {
  return locale === "en" ? CURRENCY_OPTIONS_EN : CURRENCY_OPTIONS;
}
export function getQuoteStatusOptions(locale: Locale) {
  return locale === "en" ? QUOTE_STATUS_OPTIONS_EN : QUOTE_STATUS_OPTIONS;
}
export function getInvoiceStatusOptions(locale: Locale) {
  return locale === "en" ? INVOICE_STATUS_OPTIONS_EN : INVOICE_STATUS_OPTIONS;
}

const CURRENCY_LOCALE: Record<string, string> = { EUR: "fr-FR", CAD: "fr-CA" };
const CURRENCY_LOCALE_EN: Record<string, string> = { EUR: "en-US", CAD: "en-CA" };

/** cents (integer) -> display string, e.g. 12345 -> "123,45 €" (fr) or
 * "$123.45" (en) — the UI locale only changes punctuation/symbol placement,
 * never the currency itself (never auto-converted; see formatMoney's
 * `currency` param, always the value actually stored on the record). */
export function formatMoney(cents: number, currency: string, uiLocale: Locale = "fr"): string {
  const localeMap = uiLocale === "en" ? CURRENCY_LOCALE_EN : CURRENCY_LOCALE;
  const locale = localeMap[currency] ?? (uiLocale === "en" ? "en-US" : "fr-FR");
  return (cents / 100).toLocaleString(locale, { style: "currency", currency });
}

export type LineItemInput = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  // Purely informative traceability back to the canonical catalogue — see
  // db/schema.ts's crmQuoteItems.serviceId. Never trusted at face value:
  // callers must run this through sanitizeServiceIds (lib/crm-service-linking.ts)
  // before persisting, since it arrives from client-submitted form data
  // (P0.2A-2).
  serviceId: string | null;
};

export type CatalogueServiceOption = {
  serviceId: string;
  label: string;
  // Market-list prices, pre-converted to cents server-side — null means
  // "no offer for that market" (or no market/offer data was supplied at
  // all), never a guessed value (P0.2A-3).
  canadaPriceCents: number | null;
  europePriceCents: number | null;
};

/**
 * Deterministic decimal-string -> integer-cents conversion for
 * service_market_offers.price (numeric(10,2), always returned as a string
 * by the pg driver — confirmed by components/catalogue/service-card.tsx's
 * own direct, unconverted use of `offer.price`). Deliberately NOT
 * `parseFloat(price) * 100` / `Number(price) * 100`: floating-point
 * multiplication can drift ("49.99" * 100 → 4998.999999999999 before
 * rounding masks it), so this instead treats the string itself as the
 * exact value — split on the decimal point, pad the fractional part to
 * exactly 2 digits, concatenate as an integer. Returns null (never
 * throws, never invents a price) for anything that isn't a plain
 * non-negative number with at most 2 decimals — real rows always match
 * this shape (DB's own numeric(10,2) + CHECK price >= 0), so null here
 * signals a genuinely unexpected input, not a normal case to paper over.
 */
export function priceStringToCents(price: string): number | null {
  if (typeof price !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** { serviceId, label, canadaPriceCents, europePriceCents } options for the
 * catalogue picker in BillingDocumentForm — a pure formatting step (no DB
 * access, so this stays safe to import from a client component) over rows
 * already fetched by the calling page. DUO services are expected to
 * already be excluded by the caller's query (see lib/crm-service-linking.ts's
 * selectableCatalogueServiceCondition, the single source of truth for that
 * rule). `offersByServiceId` is optional and keyed by serviceId with the
 * two markets' raw price STRINGS (as read from service_market_offers) —
 * omit it (or a given service's entry) to get {..., canadaPriceCents:
 * null, europePriceCents: null}, identical to P0.2A-2's behavior. */
export function toCatalogueServiceOptions(
  rows: { serviceId: string; displayNameFr: string; displayNameEn: string }[],
  locale: Locale,
  offersByServiceId?: Map<string, { canada?: string; europe?: string }>,
): CatalogueServiceOption[] {
  return rows.map((r) => {
    const offers = offersByServiceId?.get(r.serviceId);
    return {
      serviceId: r.serviceId,
      label: locale === "en" ? r.displayNameEn : r.displayNameFr,
      canadaPriceCents: offers?.canada != null ? priceStringToCents(offers.canada) : null,
      europePriceCents: offers?.europe != null ? priceStringToCents(offers.europe) : null,
    };
  });
}

export type ClientMarket = "CANADA" | "EUROPE" | null;

/**
 * Whether — and at what price — selecting `option` should prefill
 * unitPrice, given the resolved client market and the document's
 * currently-selected currency. Pure and fully deterministic: returns a
 * concrete cents value only when the market is known with certainty AND
 * an offer exists for it AND the document's own currency already matches
 * that market's currency (CANADA→CAD, EUROPE→EUR) — the "devise
 * incohérente" case (e.g. market=CANADA but the document is currently set
 * to EUR) deliberately returns null rather than converting or guessing
 * (P0.2A-3 rule). Never mutates anything — the caller decides what to do
 * with the result (BillingDocumentForm only ever uses it to suggest an
 * initial value; the field remains a normal editable input afterward).
 */
export function resolveCataloguePrefillPriceCents(option: CatalogueServiceOption, market: ClientMarket, currency: string): number | null {
  if (market === "CANADA" && currency === "CAD") return option.canadaPriceCents;
  if (market === "EUROPE" && currency === "EUR") return option.europePriceCents;
  return null;
}

const LINE_ITEM_ERRORS = {
  fr: {
    atLeastOne: "Au moins une ligne est requise.",
    invalidLines: "Lignes invalides.",
    descriptionRequired: (n: number) => `Ligne ${n} : description requise.`,
    invalidQuantity: (n: number) => `Ligne ${n} : quantité invalide.`,
    invalidPrice: (n: number) => `Ligne ${n} : prix invalide.`,
  },
  en: {
    atLeastOne: "At least one line item is required.",
    invalidLines: "Invalid line items.",
    descriptionRequired: (n: number) => `Line ${n}: description required.`,
    invalidQuantity: (n: number) => `Line ${n}: invalid quantity.`,
    invalidPrice: (n: number) => `Line ${n}: invalid price.`,
  },
};

/** Line items travel through the form as a single JSON field (see
 * components/crm/line-items-editor.tsx) rather than parallel indexed
 * inputs — simpler to validate and to keep in sync with client-side add/
 * remove-row state. `locale` only affects the thrown validation messages
 * shown back to the staff member submitting the form. */
export function parseLineItems(raw: FormDataEntryValue | null, locale: Locale = "fr"): LineItemInput[] {
  const t = LINE_ITEM_ERRORS[locale];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(t.atLeastOne);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(t.invalidLines);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(t.atLeastOne);
  }
  return parsed.map((item, index) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).description !== "string" ||
      !(item as { description: string }).description.trim()
    ) {
      throw new Error(t.descriptionRequired(index + 1));
    }
    const quantity = Number((item as Record<string, unknown>).quantity);
    const unitPriceCents = Number((item as Record<string, unknown>).unitPriceCents);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(t.invalidQuantity(index + 1));
    }
    if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) {
      throw new Error(t.invalidPrice(index + 1));
    }
    // Shape-only check here (must be a non-empty string, else null) — this
    // is NOT proof the id refers to a real, currently-selectable catalogue
    // service. Every caller must additionally run the result through
    // sanitizeServiceIds (lib/crm-service-linking.ts) before persisting.
    const serviceIdRaw = (item as Record<string, unknown>).serviceId;
    const serviceId = typeof serviceIdRaw === "string" && serviceIdRaw.trim() ? serviceIdRaw.trim() : null;
    return {
      description: (item as { description: string }).description.trim(),
      quantity: Math.round(quantity),
      unitPriceCents: Math.round(unitPriceCents),
      serviceId,
    };
  });
}

export function computeTotals(items: LineItemInput[], taxRateBasisPoints: number) {
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const taxCents = Math.round((subtotalCents * taxRateBasisPoints) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
