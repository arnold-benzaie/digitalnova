import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

const PM_ROUGE = "#d52b1e";
const PM_NOIR = "#080808";
const PM_GRIS = "#6b6b6b";
const PM_GRIS_2 = "#e2ddd8";
const PM_VERT = "#2f7d4f";
const PM_ORANGE = "#b8860b";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: PM_NOIR, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  brand: { fontSize: 16, fontWeight: 700 },
  brandAccent: { color: PM_ROUGE },
  docType: { fontSize: 13, fontWeight: 700, textAlign: "right" },
  meta: { fontSize: 8, color: PM_GRIS, textAlign: "right", marginTop: 2 },
  scoreBlock: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 },
  scoreCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: PM_NOIR,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: { fontSize: 16, fontWeight: 700 },
  scoreLabel: { fontSize: 8, color: PM_GRIS },
  clientName: { fontSize: 13, fontWeight: 700 },
  websiteUrl: { fontSize: 9, color: PM_GRIS, marginTop: 2 },
  summary: { fontSize: 9, color: PM_GRIS, marginTop: 2, maxWidth: 380 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: PM_GRIS,
    marginTop: 16,
    marginBottom: 6,
  },
  techGrid: { flexDirection: "row", flexWrap: "wrap" },
  techItem: { width: "50%", marginBottom: 6 },
  techLabel: { fontSize: 8, color: PM_GRIS },
  techValue: { fontSize: 9, marginTop: 1 },
  table: { borderWidth: 1, borderColor: PM_GRIS_2, marginTop: 4 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: PM_GRIS_2 },
  headerRow: { backgroundColor: "#f5f3f1" },
  cell: { padding: 5, fontSize: 8, borderRightWidth: 1, borderRightColor: PM_GRIS_2 },
  headerCell: { padding: 5, fontSize: 8, fontWeight: 700, borderRightWidth: 1, borderRightColor: PM_GRIS_2, textTransform: "uppercase" },
  colCategory: { width: "14%" },
  colTitle: { width: "26%" },
  colPriority: { width: "12%" },
  colStatus: { width: "14%" },
  colRecommendation: { width: "34%", borderRightWidth: 0 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7, color: PM_GRIS, textAlign: "center" },
});

function scoreColor(score: number): string {
  if (score >= 80) return PM_VERT;
  if (score >= 50) return PM_ORANGE;
  return PM_ROUGE;
}

export type SeoAuditReportIssue = {
  category: string;
  title: string;
  priority: string;
  status: string;
  recommendation: string | null;
};

export type SeoAuditReportData = {
  clientName: string;
  websiteUrl: string;
  websiteLabel: string | null;
  auditDate: Date;
  score: number;
  summary: string | null;
  pageTitle: string | null;
  metaDescription: string | null;
  h1Count: number | null;
  indexable: boolean | null;
  sitemapFound: boolean | null;
  robotsTxtFound: boolean | null;
  issues: SeoAuditReportIssue[];
  categoryLabel: Record<string, string>;
  priorityLabel: Record<string, string>;
  statusLabel: Record<string, string>;
};

function boolLabel(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Oui" : "Non";
}

export function SeoAuditReportPdf({ data }: { data: SeoAuditReportData }): ReactElement<DocumentProps> {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>
            Public<Text style={styles.brandAccent}>Maps</Text>
          </Text>
          <View>
            <Text style={styles.docType}>AUDIT SEO TECHNIQUE</Text>
            <Text style={styles.meta}>
              {data.auditDate.toLocaleDateString("fr-FR")} {data.auditDate.toLocaleTimeString("fr-FR")}
            </Text>
          </View>
        </View>

        <View style={styles.scoreBlock}>
          <View style={[styles.scoreCircle, { borderColor: scoreColor(data.score) }]}>
            <Text style={[styles.scoreValue, { color: scoreColor(data.score) }]}>{data.score}</Text>
          </View>
          <View>
            <Text style={styles.clientName}>{data.clientName}</Text>
            <Text style={styles.websiteUrl}>
              {data.websiteLabel ? `${data.websiteLabel} — ` : ""}
              {data.websiteUrl}
            </Text>
            {data.summary && <Text style={styles.summary}>{data.summary}</Text>}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Données techniques</Text>
        <View style={styles.techGrid}>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Titre de page</Text>
            <Text style={styles.techValue}>{data.pageTitle ?? "Manquant"}</Text>
          </View>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Meta description</Text>
            <Text style={styles.techValue}>{data.metaDescription ?? "Manquante"}</Text>
          </View>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Nombre de H1</Text>
            <Text style={styles.techValue}>{data.h1Count ?? "—"}</Text>
          </View>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Indexable</Text>
            <Text style={styles.techValue}>{boolLabel(data.indexable)}</Text>
          </View>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Sitemap.xml détecté</Text>
            <Text style={styles.techValue}>{boolLabel(data.sitemapFound)}</Text>
          </View>
          <View style={styles.techItem}>
            <Text style={styles.techLabel}>Robots.txt détecté</Text>
            <Text style={styles.techValue}>{boolLabel(data.robotsTxtFound)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Recommandations ({data.issues.length})</Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.headerCell, styles.colCategory]}>Catégorie</Text>
            <Text style={[styles.headerCell, styles.colTitle]}>Constat</Text>
            <Text style={[styles.headerCell, styles.colPriority]}>Priorité</Text>
            <Text style={[styles.headerCell, styles.colStatus]}>Statut</Text>
            <Text style={[styles.headerCell, styles.colRecommendation]}>Recommandation</Text>
          </View>
          {data.issues.map((issue, index) => (
            <View key={index} style={styles.row}>
              <Text style={[styles.cell, styles.colCategory]}>{data.categoryLabel[issue.category] ?? issue.category}</Text>
              <Text style={[styles.cell, styles.colTitle]}>{issue.title}</Text>
              <Text style={[styles.cell, styles.colPriority]}>{data.priorityLabel[issue.priority] ?? issue.priority}</Text>
              <Text style={[styles.cell, styles.colStatus]}>{data.statusLabel[issue.status] ?? issue.status}</Text>
              <Text style={[styles.cell, styles.colRecommendation]}>{issue.recommendation ?? "—"}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer}>
          Ce rapport est généré automatiquement depuis le CRM Public Maps (données simulées — module SEO en mode mock).
        </Text>
      </Page>
    </Document>
  );
}
