import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

const PM_ROUGE = "#d52b1e";
const PM_NOIR = "#080808";
const PM_GRIS = "#6b6b6b";
const PM_GRIS_2 = "#e2ddd8";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, color: PM_NOIR, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  brand: { fontSize: 18, fontWeight: 700 },
  brandAccent: { color: PM_ROUGE },
  meta: { fontSize: 9, color: PM_GRIS, textAlign: "right" },
  scoreBlock: {
    borderWidth: 1,
    borderColor: PM_GRIS_2,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  scoreLabel: { fontSize: 9, color: PM_GRIS, textTransform: "uppercase", letterSpacing: 1 },
  scoreValue: { fontSize: 32, fontWeight: 700, marginTop: 4 },
  summary: { fontSize: 10, color: PM_GRIS, marginTop: 8 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 10, marginTop: 4 },
  issue: {
    borderWidth: 1,
    borderColor: PM_GRIS_2,
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
  },
  issueHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  issueTitle: { fontSize: 11, fontWeight: 700 },
  priority: { fontSize: 8, textTransform: "uppercase", color: PM_GRIS },
  issueDescription: { fontSize: 9, color: PM_GRIS, marginTop: 4 },
  recommendation: { fontSize: 9, marginTop: 4 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: PM_GRIS, textAlign: "center" },
});

const PRIORITY_LABEL: Record<string, string> = { high: "Priorité haute", medium: "Priorité moyenne", low: "Priorité basse" };

export type AuditReportData = {
  organizationName: string;
  score: number;
  summary: string | null;
  generatedAt: Date;
  issues: { title: string; description: string | null; priority: string; recommendation: string | null }[];
};

export function AuditReportDocument({ data }: { data: AuditReportData }): ReactElement<DocumentProps> {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>
            Public<Text style={styles.brandAccent}>Maps</Text>
          </Text>
          <Text style={styles.meta}>
            Rapport d&apos;audit — {data.organizationName}
            {"\n"}
            {data.generatedAt.toLocaleDateString("fr-FR")}
          </Text>
        </View>

        <View style={styles.scoreBlock}>
          <Text style={styles.scoreLabel}>Score global</Text>
          <Text style={styles.scoreValue}>{data.score}/100</Text>
          {data.summary && <Text style={styles.summary}>{data.summary}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Recommandations</Text>
        {data.issues.map((issue, index) => (
          <View key={index} style={styles.issue}>
            <View style={styles.issueHeader}>
              <Text style={styles.issueTitle}>{issue.title}</Text>
              <Text style={styles.priority}>{PRIORITY_LABEL[issue.priority] ?? issue.priority}</Text>
            </View>
            {issue.description && <Text style={styles.issueDescription}>{issue.description}</Text>}
            {issue.recommendation && (
              <Text style={styles.recommendation}>Recommandation : {issue.recommendation}</Text>
            )}
          </View>
        ))}

        <Text style={styles.footer}>
          Données simulées — généré automatiquement par Public Maps. Rapport basé sur un fournisseur IA mock en
          attendant une clé Anthropic réelle.
        </Text>
      </Page>
    </Document>
  );
}
