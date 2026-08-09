import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { formatMoney } from "@/lib/crm-billing";
import { APP_NAME } from "@/lib/brand";
import { BRAND_LOGO_DATA_URI } from "@/lib/pdf/brand-logo";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";

// @react-pdf/renderer applies syllable-based hyphenation by default (e.g.
// "facture" -> "fac-" / "ture" when wrapping), which reads as a rendering
// glitch on a short caption. Disabling it makes text wrap on whole words
// only, everywhere in this document (FR and EN, quote and invoice) — purely
// visual, no effect on layout security/data.
Font.registerHyphenationCallback((word) => [word]);

/** PDF-only label set — the document's own language is whatever locale is
 * stored on the invoice/quote row (see BillingDocumentData.locale), never
 * the viewing staff member's current UI locale. Colocated here rather than
 * in lib/i18n/dictionaries/crm.ts on purpose: this is the one place in the
 * app that renders a legal/accounting DOCUMENT rather than UI chrome, and
 * keeping its (small, stable) label set next to the template that consumes
 * it avoids coupling a PDF layout change to the shared CRM dictionary. Same
 * "colocated FR/EN map" convention already used for MESSAGES/COPY
 * elsewhere (lib/actions/crm-invoices.ts, lib/email/invitation.ts) — not a
 * second i18n system, just this file's own small resource.
 */
const PDF_LABELS = {
  fr: {
    quote: "DEVIS",
    invoice: "FACTURE",
    recipient: "Destinataire",
    issuedOn: "Émis le",
    description: "Description",
    quantity: "Qté",
    unitPrice: "Prix unitaire",
    total: "Total",
    subtotal: "Sous-total",
    tax: (percent: string) => `Taxe (${percent}%)`,
    quoteFooter: (appName: string) => `Ce devis est généré automatiquement depuis le CRM ${appName}.`,
    invoiceFooter: (appName: string) => `Cette facture est générée automatiquement depuis le CRM ${appName}.`,
    scanToVerify: "Scanner pour vérifier la facture",
  },
  en: {
    quote: "QUOTE",
    invoice: "INVOICE",
    recipient: "Recipient",
    issuedOn: "Issued on",
    description: "Description",
    quantity: "Qty",
    unitPrice: "Unit price",
    total: "Total",
    subtotal: "Subtotal",
    tax: (percent: string) => `Tax (${percent}%)`,
    quoteFooter: (appName: string) => `This quote was automatically generated from the ${appName} CRM.`,
    invoiceFooter: (appName: string) => `This invoice was automatically generated from the ${appName} CRM.`,
    scanToVerify: "Scan to verify invoice",
  },
} as const;

const PM_NOIR = "#080808";
const PM_GRIS = "#6b6b6b";
const PM_GRIS_2 = "#e2ddd8";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: PM_NOIR, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  logo: { width: 100, height: 35 },
  docType: { fontSize: 14, fontWeight: 700, textAlign: "right" },
  docNumber: { fontSize: 10, color: PM_GRIS, textAlign: "right", marginTop: 2 },
  statusBadge: { fontSize: 8, color: PM_GRIS, textAlign: "right", marginTop: 4, textTransform: "uppercase" },
  metaBlock: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  clientBlock: { maxWidth: "60%" },
  label: { fontSize: 8, color: PM_GRIS, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  clientName: { fontSize: 12, fontWeight: 700 },
  clientLine: { fontSize: 9, color: PM_GRIS, marginTop: 1 },
  datesBlock: { alignItems: "flex-end" },
  dateLine: { fontSize: 9, color: PM_GRIS, marginTop: 1, textAlign: "right" },
  table: { borderWidth: 1, borderColor: PM_GRIS_2, marginTop: 8 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: PM_GRIS_2 },
  headerRow: { backgroundColor: "#f5f3f1" },
  cell: { padding: 6, fontSize: 9, borderRightWidth: 1, borderRightColor: PM_GRIS_2 },
  headerCell: { padding: 6, fontSize: 8, fontWeight: 700, borderRightWidth: 1, borderRightColor: PM_GRIS_2, textTransform: "uppercase" },
  colDescription: { width: "52%" },
  colQuantity: { width: "12%", textAlign: "right" },
  colUnitPrice: { width: "18%", textAlign: "right" },
  colLineTotal: { width: "18%", textAlign: "right", borderRightWidth: 0 },
  totalsBlock: { marginTop: 12, alignSelf: "flex-end", width: "45%" },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { fontSize: 9, color: PM_GRIS },
  totalsValue: { fontSize: 9 },
  grandTotalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, borderTopWidth: 1, borderTopColor: PM_GRIS_2, marginTop: 3 },
  grandTotalLabel: { fontSize: 11, fontWeight: 700 },
  grandTotalValue: { fontSize: 11, fontWeight: 700 },
  notes: { marginTop: 24, fontSize: 9, color: PM_GRIS },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 7, color: PM_GRIS, textAlign: "center" },
  // Bottom-left, well clear of the right-aligned totals block above and
  // the centered footer disclaimer below (30pt gap) — never overlaps
  // either. Left rather than centered/right so it never competes with
  // the totals block's own right alignment on a page with few line items.
  qrBlock: { position: "absolute", bottom: 66, left: 40, alignItems: "center" },
  qrImage: { width: 70, height: 70 },
  qrCaption: { fontSize: 7, color: PM_GRIS, marginTop: 4, textAlign: "center", width: 90 },
});

export type BillingDocumentData = {
  kind: "quote" | "invoice";
  /** Verification QR — invoices only (see render logic below), never set
   * for quotes. PNG data URI, same shape as BRAND_LOGO_DATA_URI. */
  qrCodeDataUri?: string;
  /** The document's OWN language — stored on the invoice/quote row, not
   * the viewing staff member's current UI locale. See PDF_LABELS above. */
  locale: Locale;
  number: string;
  title: string;
  statusLabel: string;
  currency: string;
  clientName: string;
  clientContact?: string | null;
  clientEmail?: string | null;
  clientAddress?: string | null;
  issuedAt: Date;
  secondaryDate?: { label: string; date: Date } | null;
  taxLabel?: string | null;
  taxRateBasisPoints: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes?: string | null;
  items: { description: string; quantity: number; unitPriceCents: number }[];
};

export function BillingDocumentPdf({ data }: { data: BillingDocumentData }): ReactElement<DocumentProps> {
  const t = PDF_LABELS[data.locale];
  const docLabel = data.kind === "quote" ? t.quote : t.invoice;
  const taxPercent = (data.taxRateBasisPoints / 100).toFixed(2).replace(/\.00$/, "");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Image src={BRAND_LOGO_DATA_URI} style={styles.logo} />
          <View>
            <Text style={styles.docType}>{docLabel}</Text>
            <Text style={styles.docNumber}>{data.number}</Text>
            <Text style={styles.statusBadge}>{data.statusLabel}</Text>
          </View>
        </View>

        <View style={styles.metaBlock}>
          <View style={styles.clientBlock}>
            <Text style={styles.label}>{t.recipient}</Text>
            <Text style={styles.clientName}>{data.clientName}</Text>
            {data.clientContact && <Text style={styles.clientLine}>{data.clientContact}</Text>}
            {data.clientEmail && <Text style={styles.clientLine}>{data.clientEmail}</Text>}
            {data.clientAddress && <Text style={styles.clientLine}>{data.clientAddress}</Text>}
          </View>
          <View style={styles.datesBlock}>
            <Text style={styles.label}>{data.title}</Text>
            <Text style={styles.dateLine}>
              {t.issuedOn} {formatDate(data.issuedAt, data.locale)}
            </Text>
            {data.secondaryDate && (
              <Text style={styles.dateLine}>
                {data.secondaryDate.label} {formatDate(data.secondaryDate.date, data.locale)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.headerCell, styles.colDescription]}>{t.description}</Text>
            <Text style={[styles.headerCell, styles.colQuantity]}>{t.quantity}</Text>
            <Text style={[styles.headerCell, styles.colUnitPrice]}>{t.unitPrice}</Text>
            <Text style={[styles.headerCell, styles.colLineTotal]}>{t.total}</Text>
          </View>
          {data.items.map((item, index) => (
            <View key={index} style={styles.row}>
              <Text style={[styles.cell, styles.colDescription]}>{item.description}</Text>
              <Text style={[styles.cell, styles.colQuantity]}>{item.quantity}</Text>
              <Text style={[styles.cell, styles.colUnitPrice]}>{formatMoney(item.unitPriceCents, data.currency, data.locale)}</Text>
              <Text style={[styles.cell, styles.colLineTotal]}>
                {formatMoney(item.quantity * item.unitPriceCents, data.currency, data.locale)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{t.subtotal}</Text>
            <Text style={styles.totalsValue}>{formatMoney(data.subtotalCents, data.currency, data.locale)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{data.taxLabel || t.tax(taxPercent)}</Text>
            <Text style={styles.totalsValue}>{formatMoney(data.taxCents, data.currency, data.locale)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>{t.total}</Text>
            <Text style={styles.grandTotalValue}>{formatMoney(data.totalCents, data.currency, data.locale)}</Text>
          </View>
        </View>

        {data.notes && <Text style={styles.notes}>{data.notes}</Text>}

        {data.kind === "invoice" && data.qrCodeDataUri && (
          <View style={styles.qrBlock}>
            <Image src={data.qrCodeDataUri} style={styles.qrImage} />
            <Text style={styles.qrCaption}>{t.scanToVerify}</Text>
          </View>
        )}

        <Text style={styles.footer}>{data.kind === "quote" ? t.quoteFooter(APP_NAME) : t.invoiceFooter(APP_NAME)}</Text>
      </Page>
    </Document>
  );
}
