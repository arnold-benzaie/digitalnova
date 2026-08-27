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

/** { serviceId, label } options for the catalogue picker in
 * BillingDocumentForm — a pure formatting step (no DB access, so this stays
 * safe to import from a client component) over rows already fetched by the
 * calling page. DUO services are expected to already be excluded by the
 * caller's query (see lib/crm-service-linking.ts's selectableCatalogueServiceCondition,
 * the single source of truth for that rule). */
export function toCatalogueServiceOptions(
  rows: { serviceId: string; displayNameFr: string; displayNameEn: string }[],
  locale: Locale,
): { serviceId: string; label: string }[] {
  return rows.map((r) => ({ serviceId: r.serviceId, label: locale === "en" ? r.displayNameEn : r.displayNameFr }));
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
