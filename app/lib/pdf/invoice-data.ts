import type { crmClients, crmInvoiceItems, crmInvoices } from "@/db/schema";
import type { BillingDocumentData } from "@/lib/pdf/billing-document";
import { APP_NAME } from "@/lib/brand";

const DUE_LABEL = { fr: "Échéance :", en: "Due date:" } as const;
const FILE_PREFIX = { fr: "Facture", en: "Invoice" } as const;

type InvoiceRow = typeof crmInvoices.$inferSelect;
type InvoiceItemRow = typeof crmInvoiceItems.$inferSelect;
type ClientRow = typeof crmClients.$inferSelect;

/**
 * Single place that turns a DB invoice row into the PDF template's input —
 * used by both the staff-facing route (app/api/crm/invoices/[id]/pdf) and
 * the public token-gated one (app/api/invoices/[token]/pdf), so the two
 * can never silently drift apart. Always prefers the invoice's own
 * `clientSnapshot` (captured once at creation) over a live `client` join:
 * a client record edited or archived after an invoice was issued must
 * never change what that already-issued invoice shows. `client` is only
 * used as a fallback for invoices created before clientSnapshot existed.
 */
export function buildInvoicePdfData(invoice: InvoiceRow, items: InvoiceItemRow[], client: ClientRow | undefined, statusLabel: string): BillingDocumentData {
  const snapshot = invoice.clientSnapshot;
  return {
    kind: "invoice",
    locale: invoice.locale === "en" ? "en" : "fr",
    number: invoice.invoiceNumber,
    title: invoice.title,
    statusLabel,
    currency: invoice.currency,
    clientName: snapshot?.name ?? client?.name ?? "—",
    clientContact: snapshot?.contactName ?? client?.contactName,
    clientEmail: snapshot?.email ?? client?.email,
    clientAddress: formatClientAddress(snapshot ?? client ?? null),
    issuedAt: invoice.issuedAt,
    secondaryDate: invoice.dueAt ? { label: DUE_LABEL[invoice.locale === "en" ? "en" : "fr"], date: invoice.dueAt } : null,
    taxLabel: invoice.taxLabel,
    taxRateBasisPoints: invoice.taxRateBasisPoints,
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    notes: invoice.notes,
    items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
  };
}

function formatClientAddress(source: { address: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null } | null): string | null {
  if (!source) return null;
  const cityLine = [source.postalCode, source.city].filter(Boolean).join(" ");
  return [source.address, cityLine || null, source.region, source.country].filter(Boolean).join(", ") || null;
}

/** FR: "Facture-PUBLIC-MAP-FAC-2026-0001.pdf", EN: "Invoice-PUBLIC-MAP-FAC-2026-0001.pdf". */
export function invoicePdfFileName(invoice: Pick<InvoiceRow, "locale" | "invoiceNumber">): string {
  const prefix = FILE_PREFIX[invoice.locale === "en" ? "en" : "fr"];
  return `${prefix}-${APP_NAME}-${invoice.invoiceNumber}.pdf`;
}
