export const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR — Euro" },
  { value: "CAD", label: "CAD — Dollar canadien" },
];

export const QUOTE_STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyé" },
  { value: "accepted", label: "Accepté" },
  { value: "declined", label: "Refusé" },
  { value: "expired", label: "Expiré" },
];

export const INVOICE_STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyée" },
  { value: "paid", label: "Payée" },
  { value: "canceled", label: "Annulée" },
  { value: "refunded", label: "Remboursée" },
];

export const QUOTE_STATUS_VALUES = QUOTE_STATUS_OPTIONS.map((o) => o.value);
export const INVOICE_STATUS_VALUES = INVOICE_STATUS_OPTIONS.map((o) => o.value);
export const CURRENCY_VALUES = CURRENCY_OPTIONS.map((o) => o.value);

const CURRENCY_LOCALE: Record<string, string> = { EUR: "fr-FR", CAD: "fr-CA" };

/** cents (integer) -> display string, e.g. 12345 -> "123,45 €". */
export function formatMoney(cents: number, currency: string): string {
  const locale = CURRENCY_LOCALE[currency] ?? "fr-FR";
  return (cents / 100).toLocaleString(locale, { style: "currency", currency });
}

export type LineItemInput = { description: string; quantity: number; unitPriceCents: number };

/** Line items travel through the form as a single JSON field (see
 * components/crm/line-items-editor.tsx) rather than parallel indexed
 * inputs — simpler to validate and to keep in sync with client-side add/
 * remove-row state. */
export function parseLineItems(raw: FormDataEntryValue | null): LineItemInput[] {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Au moins une ligne est requise.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Lignes invalides.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Au moins une ligne est requise.");
  }
  return parsed.map((item, index) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).description !== "string" ||
      !(item as { description: string }).description.trim()
    ) {
      throw new Error(`Ligne ${index + 1} : description requise.`);
    }
    const quantity = Number((item as Record<string, unknown>).quantity);
    const unitPriceCents = Number((item as Record<string, unknown>).unitPriceCents);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Ligne ${index + 1} : quantité invalide.`);
    }
    if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) {
      throw new Error(`Ligne ${index + 1} : prix invalide.`);
    }
    return {
      description: (item as { description: string }).description.trim(),
      quantity: Math.round(quantity),
      unitPriceCents: Math.round(unitPriceCents),
    };
  });
}

export function computeTotals(items: LineItemInput[], taxRateBasisPoints: number) {
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const taxCents = Math.round((subtotalCents * taxRateBasisPoints) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
