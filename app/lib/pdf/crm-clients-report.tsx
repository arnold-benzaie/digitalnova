import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { APP_NAME } from "@/lib/brand";
import { BRAND_LOGO_DATA_URI } from "@/lib/pdf/brand-logo";

const PM_NOIR = "#080808";
const PM_GRIS = "#6b6b6b";
const PM_GRIS_2 = "#e2ddd8";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, color: PM_NOIR, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  logo: { width: 90, height: 31 },
  brandSuffix: { fontSize: 12, fontWeight: 700, color: PM_NOIR },
  meta: { fontSize: 8, color: PM_GRIS, textAlign: "right" },
  table: { display: "flex", width: "100%", borderWidth: 1, borderColor: PM_GRIS_2 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: PM_GRIS_2 },
  headerRow: { backgroundColor: "#f5f3f1" },
  cell: { padding: 5, fontSize: 8, borderRightWidth: 1, borderRightColor: PM_GRIS_2 },
  headerCell: { padding: 5, fontSize: 8, fontWeight: 700, borderRightWidth: 1, borderRightColor: PM_GRIS_2 },
  colName: { width: "22%" },
  colContact: { width: "20%" },
  colStage: { width: "12%" },
  colOwner: { width: "16%" },
  colSource: { width: "16%" },
  colDate: { width: "14%" },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 7, color: PM_GRIS, textAlign: "center" },
});

export type CrmClientsReportRow = {
  name: string;
  contactName: string | null;
  email: string | null;
  stage: string;
  ownerName: string | null;
  source: string | null;
  createdAt: Date;
  archived: boolean;
};

export function CrmClientsReportDocument({
  rows,
  generatedAt,
  stageLabel,
}: {
  rows: CrmClientsReportRow[];
  generatedAt: Date;
  stageLabel: Record<string, string>;
}): ReactElement<DocumentProps> {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Image src={BRAND_LOGO_DATA_URI} style={styles.logo} />
            <Text style={styles.brandSuffix}>— Clients CRM</Text>
          </View>
          <Text style={styles.meta}>
            {rows.length} client(s){"\n"}
            {generatedAt.toLocaleDateString("fr-FR")} {generatedAt.toLocaleTimeString("fr-FR")}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.headerCell, styles.colName]}>Nom</Text>
            <Text style={[styles.headerCell, styles.colContact]}>Contact</Text>
            <Text style={[styles.headerCell, styles.colStage]}>Étape</Text>
            <Text style={[styles.headerCell, styles.colOwner]}>Conseiller</Text>
            <Text style={[styles.headerCell, styles.colSource]}>Source</Text>
            <Text style={[styles.headerCell, styles.colDate]}>Créé le</Text>
          </View>
          {rows.map((row, index) => (
            <View key={index} style={styles.row}>
              <Text style={[styles.cell, styles.colName]}>
                {row.name}
                {row.archived ? " (archivé)" : ""}
              </Text>
              <Text style={[styles.cell, styles.colContact]}>
                {[row.contactName, row.email].filter(Boolean).join(" — ") || "—"}
              </Text>
              <Text style={[styles.cell, styles.colStage]}>{stageLabel[row.stage] ?? row.stage}</Text>
              <Text style={[styles.cell, styles.colOwner]}>{row.ownerName ?? "—"}</Text>
              <Text style={[styles.cell, styles.colSource]}>{row.source ?? "—"}</Text>
              <Text style={[styles.cell, styles.colDate]}>{row.createdAt.toLocaleDateString("fr-FR")}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer}>Export généré automatiquement depuis le CRM {APP_NAME}.</Text>
      </Page>
    </Document>
  );
}
