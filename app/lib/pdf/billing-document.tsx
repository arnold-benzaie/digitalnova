import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { formatMoney } from "@/lib/crm-billing";

const PM_ROUGE = "#d52b1e";
const PM_NOIR = "#080808";
const PM_GRIS = "#6b6b6b";
const PM_GRIS_2 = "#e2ddd8";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: PM_NOIR, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  brand: { fontSize: 18, fontWeight: 700 },
  brandAccent: { color: PM_ROUGE },
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
});

export type BillingDocumentData = {
  kind: "quote" | "invoice";
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
  const docLabel = data.kind === "quote" ? "DEVIS" : "FACTURE";
  const taxPercent = (data.taxRateBasisPoints / 100).toFixed(2).replace(/\.00$/, "");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>
            Public<Text style={styles.brandAccent}>Maps</Text>
          </Text>
          <View>
            <Text style={styles.docType}>{docLabel}</Text>
            <Text style={styles.docNumber}>{data.number}</Text>
            <Text style={styles.statusBadge}>{data.statusLabel}</Text>
          </View>
        </View>

        <View style={styles.metaBlock}>
          <View style={styles.clientBlock}>
            <Text style={styles.label}>Destinataire</Text>
            <Text style={styles.clientName}>{data.clientName}</Text>
            {data.clientContact && <Text style={styles.clientLine}>{data.clientContact}</Text>}
            {data.clientEmail && <Text style={styles.clientLine}>{data.clientEmail}</Text>}
            {data.clientAddress && <Text style={styles.clientLine}>{data.clientAddress}</Text>}
          </View>
          <View style={styles.datesBlock}>
            <Text style={styles.label}>{data.title}</Text>
            <Text style={styles.dateLine}>Émis le {data.issuedAt.toLocaleDateString("fr-FR")}</Text>
            {data.secondaryDate && (
              <Text style={styles.dateLine}>
                {data.secondaryDate.label} {data.secondaryDate.date.toLocaleDateString("fr-FR")}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.headerCell, styles.colDescription]}>Description</Text>
            <Text style={[styles.headerCell, styles.colQuantity]}>Qté</Text>
            <Text style={[styles.headerCell, styles.colUnitPrice]}>Prix unitaire</Text>
            <Text style={[styles.headerCell, styles.colLineTotal]}>Total</Text>
          </View>
          {data.items.map((item, index) => (
            <View key={index} style={styles.row}>
              <Text style={[styles.cell, styles.colDescription]}>{item.description}</Text>
              <Text style={[styles.cell, styles.colQuantity]}>{item.quantity}</Text>
              <Text style={[styles.cell, styles.colUnitPrice]}>{formatMoney(item.unitPriceCents, data.currency)}</Text>
              <Text style={[styles.cell, styles.colLineTotal]}>
                {formatMoney(item.quantity * item.unitPriceCents, data.currency)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Sous-total</Text>
            <Text style={styles.totalsValue}>{formatMoney(data.subtotalCents, data.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{data.taxLabel || `Taxe (${taxPercent}%)`}</Text>
            <Text style={styles.totalsValue}>{formatMoney(data.taxCents, data.currency)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{formatMoney(data.totalCents, data.currency)}</Text>
          </View>
        </View>

        {data.notes && <Text style={styles.notes}>{data.notes}</Text>}

        <Text style={styles.footer}>
          {docLabel === "DEVIS"
            ? "Ce devis est généré automatiquement depuis le CRM Public Maps."
            : "Cette facture est générée automatiquement depuis le CRM Public Maps."}
        </Text>
      </Page>
    </Document>
  );
}
