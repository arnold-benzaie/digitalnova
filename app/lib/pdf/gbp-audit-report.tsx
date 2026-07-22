import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { GBP_FINDING_RESULT_LABEL, GBP_SEVERITY_LABEL, scoreBand } from "@/lib/gbp-audit/checklist";
import type { CompetitorComparison } from "@/lib/gbp-audit/competitor-scoring";

const PM_ROUGE = "#d52b1e";
const PM_NOIR = "#080808";
const PM_GRIS = "#6b6b6b";
const PM_GRIS_2 = "#e2ddd8";
const PM_VERT = "#2f7d4f";
const PM_ORANGE = "#b8860b";

function scoreColor(score: number): string {
  if (score >= 75) return PM_VERT;
  if (score >= 50) return PM_ORANGE;
  return PM_ROUGE;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: PM_NOIR, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  brand: { fontSize: 16, fontWeight: 700 },
  brandAccent: { color: PM_ROUGE },
  docType: { fontSize: 13, fontWeight: 700, textAlign: "right" },
  meta: { fontSize: 8, color: PM_GRIS, textAlign: "right", marginTop: 2 },
  scoreBlock: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 },
  scoreCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  scoreValue: { fontSize: 16, fontWeight: 700 },
  scoreLabel: { fontSize: 8, color: PM_GRIS },
  businessName: { fontSize: 13, fontWeight: 700 },
  scoreBandLabel: { fontSize: 9, color: PM_GRIS, marginTop: 2 },
  summary: { fontSize: 9, color: PM_GRIS, marginTop: 4, maxWidth: 420 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: PM_GRIS,
    marginTop: 16,
    marginBottom: 6,
  },
  subScoreGrid: { flexDirection: "row", flexWrap: "wrap" },
  subScoreItem: { width: "25%", marginBottom: 8 },
  subScoreLabel: { fontSize: 7, color: PM_GRIS },
  subScoreValue: { fontSize: 11, fontWeight: 700, marginTop: 1 },
  table: { borderWidth: 1, borderColor: PM_GRIS_2, marginTop: 4 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: PM_GRIS_2 },
  headerRow: { backgroundColor: "#f5f3f1" },
  cell: { padding: 5, fontSize: 8, borderRightWidth: 1, borderRightColor: PM_GRIS_2 },
  headerCell: { padding: 5, fontSize: 7, fontWeight: 700, textTransform: "uppercase", borderRightWidth: 1, borderRightColor: PM_GRIS_2 },
  colSection: { width: "18%" },
  colFinding: { width: "42%" },
  colSeverity: { width: "15%" },
  colRecommendation: { width: "25%" },
  colPhase: { width: "10%" },
  colTask: { width: "40%" },
  colPriority: { width: "20%" },
  colOwner: { width: "15%" },
  colEta: { width: "15%" },
  offerCard: { borderWidth: 1, borderColor: PM_GRIS_2, padding: 8, marginTop: 6 },
  offerLabel: { fontSize: 10, fontWeight: 700 },
  offerDescription: { fontSize: 8, color: PM_GRIS, marginTop: 2 },
  colCompetitorName: { width: "30%" },
  colCompetitorMetric: { width: "17.5%" },
  colVerdict: { width: "20%" },
  cta: { marginTop: 16, padding: 10, backgroundColor: "#f5f3f1", textAlign: "center" },
  ctaText: { fontSize: 9, fontWeight: 700 },
  footer: { marginTop: 20, fontSize: 7, color: PM_GRIS, borderTopWidth: 1, borderTopColor: PM_GRIS_2, paddingTop: 8 },
});

export type GbpAuditReportFinding = {
  sectionLabel: string;
  checkLabel: string;
  result: string;
  severity: string | null;
  explanation: string | null;
  recommendation: string | null;
};

export type GbpAuditReportCorrectionTask = {
  phase: number;
  title: string;
  priority: string;
  ownerName: string | null;
  etaDays: number | null;
};

export type GbpAuditReportOffer = { label: string; description: string | null };
export type GbpAuditReportCompetitor = { name: string; comparison: CompetitorComparison };

export type GbpAuditReportData = {
  businessName: string;
  agentName: string | null;
  generatedAt: Date;
  score: number | null;
  subScores: { label: string; value: number | null }[];
  executiveSummary: string | null;
  compliantCount: number;
  criticalFindings: GbpAuditReportFinding[];
  importantFindings: GbpAuditReportFinding[];
  opportunityCount: number;
  correctionTasks: GbpAuditReportCorrectionTask[];
  recommendedOffers: GbpAuditReportOffer[];
  competitorComparisons: GbpAuditReportCompetitor[];
  /** true = simplified client-facing read; false = full internal version (spec §14: "une version interne plus détaillée et une version client plus simple"). */
  clientFacing: boolean;
  /** From Paramètres → Général (lib/gbp-audit/settings.ts) — shown in the footer. */
  contactEmail: string | null;
  footerNote: string | null;
};

const PHASE_LABEL: Record<number, string> = { 1: "1 — Urgences", 2: "2 — Optimisations", 3: "3 — Croissance" };

export function GbpAuditReportPdf({ data }: { data: GbpAuditReportData }): ReactElement<DocumentProps> {
  const band = data.score !== null ? scoreBand(data.score) : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>
            PUBLIC<Text style={styles.brandAccent}>-MAP</Text>
          </Text>
          <View>
            <Text style={styles.docType}>
              AUDIT GOOGLE BUSINESS PROFILE {data.clientFacing ? "" : "— VERSION INTERNE"}
            </Text>
            <Text style={styles.meta}>
              {data.generatedAt.toLocaleDateString("fr-FR")} {data.generatedAt.toLocaleTimeString("fr-FR")}
              {data.agentName ? ` — ${data.agentName}` : ""}
            </Text>
          </View>
        </View>

        <View style={styles.scoreBlock}>
          <View style={[styles.scoreCircle, { borderColor: data.score !== null ? scoreColor(data.score) : PM_GRIS }]}>
            <Text style={[styles.scoreValue, { color: data.score !== null ? scoreColor(data.score) : PM_GRIS }]}>
              {data.score ?? "—"}
            </Text>
          </View>
          <View>
            <Text style={styles.businessName}>{data.businessName}</Text>
            {band && <Text style={styles.scoreBandLabel}>{band.label} — {band.description}</Text>}
            {data.executiveSummary && <Text style={styles.summary}>{data.executiveSummary}</Text>}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Sous-scores</Text>
        <View style={styles.subScoreGrid}>
          {data.subScores.map((s) => (
            <View key={s.label} style={styles.subScoreItem}>
              <Text style={styles.subScoreLabel}>{s.label}</Text>
              <Text style={styles.subScoreValue}>{s.value ?? "—"}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Résumé</Text>
        <View style={styles.subScoreGrid}>
          <View style={styles.subScoreItem}>
            <Text style={styles.subScoreLabel}>Points conformes</Text>
            <Text style={[styles.subScoreValue, { color: PM_VERT }]}>{data.compliantCount}</Text>
          </View>
          <View style={styles.subScoreItem}>
            <Text style={styles.subScoreLabel}>Anomalies critiques</Text>
            <Text style={[styles.subScoreValue, { color: PM_ROUGE }]}>{data.criticalFindings.length}</Text>
          </View>
          <View style={styles.subScoreItem}>
            <Text style={styles.subScoreLabel}>Anomalies importantes</Text>
            <Text style={[styles.subScoreValue, { color: PM_ORANGE }]}>{data.importantFindings.length}</Text>
          </View>
          <View style={styles.subScoreItem}>
            <Text style={styles.subScoreLabel}>Opportunités</Text>
            <Text style={styles.subScoreValue}>{data.opportunityCount}</Text>
          </View>
        </View>

        {data.criticalFindings.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Anomalies critiques</Text>
            <FindingsTable findings={data.criticalFindings} />
          </>
        )}

        {data.importantFindings.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Anomalies importantes</Text>
            <FindingsTable findings={data.importantFindings} />
          </>
        )}

        {data.correctionTasks.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Plan de correction</Text>
            <View style={styles.table}>
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.headerCell, styles.colPhase]}>Phase</Text>
                <Text style={[styles.headerCell, styles.colTask]}>Action</Text>
                <Text style={[styles.headerCell, styles.colPriority]}>Priorité</Text>
                <Text style={[styles.headerCell, styles.colOwner]}>Responsable</Text>
                <Text style={[styles.headerCell, styles.colEta]}>Délai</Text>
              </View>
              {data.correctionTasks.map((task, i) => (
                <View key={i} style={styles.row}>
                  <Text style={[styles.cell, styles.colPhase]}>{PHASE_LABEL[task.phase] ?? "Phase"}</Text>
                  <Text style={[styles.cell, styles.colTask]}>{task.title}</Text>
                  <Text style={[styles.cell, styles.colPriority]}>{GBP_SEVERITY_LABEL[task.priority as keyof typeof GBP_SEVERITY_LABEL] ?? "Priorité"}</Text>
                  <Text style={[styles.cell, styles.colOwner]}>{task.ownerName ?? "—"}</Text>
                  <Text style={[styles.cell, styles.colEta]}>{task.etaDays ? `${task.etaDays} j` : "—"}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {data.competitorComparisons.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Comparaison concurrentielle</Text>
            <View style={styles.table}>
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.headerCell, styles.colCompetitorName]}>Concurrent</Text>
                <Text style={[styles.headerCell, styles.colCompetitorMetric]}>Note</Text>
                <Text style={[styles.headerCell, styles.colCompetitorMetric]}>Avis</Text>
                <Text style={[styles.headerCell, styles.colCompetitorMetric]}>Photos</Text>
                <Text style={[styles.headerCell, styles.colVerdict]}>Verdict</Text>
              </View>
              {data.competitorComparisons.map((c, i) => (
                <View key={i} style={styles.row}>
                  <Text style={[styles.cell, styles.colCompetitorName]}>{c.name}</Text>
                  <Text style={[styles.cell, styles.colCompetitorMetric]}>{metricCell(c.comparison, "rating", (v) => (v / 100).toFixed(1))}</Text>
                  <Text style={[styles.cell, styles.colCompetitorMetric]}>{metricCell(c.comparison, "reviewCount")}</Text>
                  <Text style={[styles.cell, styles.colCompetitorMetric]}>{metricCell(c.comparison, "photoCount")}</Text>
                  <Text style={[styles.cell, styles.colVerdict, { color: verdictColor(c.comparison.overallVerdict) }]}>
                    {VERDICT_LABEL[c.comparison.overallVerdict]}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {data.recommendedOffers.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Services recommandés</Text>
            {data.recommendedOffers.map((offer, i) => (
              <View key={i} style={styles.offerCard}>
                <Text style={styles.offerLabel}>{offer.label}</Text>
                {offer.description && <Text style={styles.offerDescription}>{offer.description}</Text>}
              </View>
            ))}
          </>
        )}

        <View style={styles.cta}>
          <Text style={styles.ctaText}>Consultez ce rapport et demandez un devis sur votre portail sécurisé PUBLIC-MAP.</Text>
        </View>

        <Text style={styles.footer}>
          Ce score est un indicateur interne d&rsquo;audit PUBLIC-MAP — il ne constitue pas une note officielle de
          Google. PUBLIC-MAP est une entreprise indépendante. Ce rapport n&rsquo;est ni exploité, ni sponsorisé, ni
          approuvé par Google. Google Business Profile et Google Maps sont des marques de Google LLC.
          {data.footerNote ? ` ${data.footerNote}` : ""}
          {data.contactEmail ? ` Une question ? ${data.contactEmail}` : ""}
        </Text>
      </Page>
    </Document>
  );
}

const VERDICT_LABEL: Record<CompetitorComparison["overallVerdict"], string> = {
  ahead: "En avance",
  behind: "En retard",
  tied: "À égalité",
  unknown: "Données incomplètes",
};

function verdictColor(verdict: CompetitorComparison["overallVerdict"]): string {
  if (verdict === "ahead") return PM_VERT;
  if (verdict === "behind") return PM_ROUGE;
  return PM_GRIS;
}

/** Renders "theirs" with our delta in parentheses, e.g. "4.2 (+0.3)" — mirrors the same convention as the staff-facing Concurrence page. */
function metricCell(comparison: CompetitorComparison, metric: "rating" | "reviewCount" | "photoCount", format: (v: number) => string = (v) => String(v)): string {
  const m = comparison.metrics.find((x) => x.metric === metric);
  if (!m || m.theirs === null || m.ours === null || typeof m.theirs !== "number" || typeof m.ours !== "number") return "—";
  const delta = m.ours - m.theirs;
  const sign = delta > 0 ? "+" : "";
  return `${format(m.theirs)} (${sign}${format(delta)})`;
}

function FindingsTable({ findings }: { findings: GbpAuditReportFinding[] }) {
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.headerCell, styles.colSection]}>Catégorie</Text>
        <Text style={[styles.headerCell, styles.colFinding]}>Constat</Text>
        <Text style={[styles.headerCell, styles.colSeverity]}>Gravité</Text>
        <Text style={[styles.headerCell, styles.colRecommendation]}>Recommandation</Text>
      </View>
      {findings.map((f, i) => (
        <View key={i} style={styles.row}>
          <Text style={[styles.cell, styles.colSection]}>{f.sectionLabel}</Text>
          <Text style={[styles.cell, styles.colFinding]}>
            {f.checkLabel} ({GBP_FINDING_RESULT_LABEL[f.result as keyof typeof GBP_FINDING_RESULT_LABEL] ?? "Résultat non renseigné"})
          </Text>
          <Text style={[styles.cell, styles.colSeverity]}>{f.severity ? (GBP_SEVERITY_LABEL[f.severity as keyof typeof GBP_SEVERITY_LABEL] ?? "—") : "—"}</Text>
          <Text style={[styles.cell, styles.colRecommendation]}>{f.recommendation ?? "—"}</Text>
        </View>
      ))}
    </View>
  );
}
