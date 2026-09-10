/**
 * Copy for the opt-in AI advisory affordance on the prospect detail page
 * (components/radar/radar-intelligence-advisory.tsx). Provider-neutral by
 * design — no "Claude" / "Anthropic" anywhere. The advisory is always
 * labelled as indicative and explicitly non-authoritative next to the
 * deterministic RADAR values.
 */
export const radarIntelligence = {
  fr: {
    sectionTitle: "Avis IA",
    getAdvisoryCta: "Obtenir un avis IA",
    loading: "Analyse en cours…",
    retryCta: "Régénérer l'avis",
    indicativeLabel: "Avis indicatif",
    deterministicNote: "Le score et la priorité RADAR restent déterministes.",
    summaryLabel: "Résumé",
    suggestedNextActionLabel: "Prochaine action suggérée",
    generatedAtLabel: "Généré le",
    deterministicHeading: "RADAR (déterministe)",
    priorityLabel: "Priorité",
    confidenceLabel: "Confiance",
    recommendedActionLabel: "Action recommandée",
    unavailable: "L'avis IA n'est pas disponible pour le moment. Les données RADAR restent disponibles.",
    rateLimited: "L'avis IA est temporairement indisponible. Réessayez dans un instant.",
    timeout: "La demande d'avis IA a expiré. Réessayez plus tard.",
    genericError: "Impossible de générer un avis IA pour le moment.",
    notApplicable: "Aucun avis IA : ce prospect n'est pas encore qualifié pour une analyse.",
    disclaimer: "L'avis IA est consultatif. Il ne modifie ni la priorité, ni le score, ni la qualification, ni l'attribution, ni les relances.",
    diagnosticPrefix: "Diagnostic :",
  },
  en: {
    sectionTitle: "AI advisory",
    getAdvisoryCta: "Get AI advisory",
    loading: "Analysing…",
    retryCta: "Regenerate advisory",
    indicativeLabel: "Indicative advisory",
    deterministicNote: "The RADAR score and priority remain deterministic.",
    summaryLabel: "Summary",
    suggestedNextActionLabel: "Suggested next action",
    generatedAtLabel: "Generated on",
    deterministicHeading: "RADAR (deterministic)",
    priorityLabel: "Priority",
    confidenceLabel: "Confidence",
    recommendedActionLabel: "Recommended action",
    unavailable: "AI advisory is currently unavailable. RADAR data remains available.",
    rateLimited: "AI advisory is temporarily unavailable. Please try again shortly.",
    timeout: "The AI advisory request timed out. Please try again later.",
    genericError: "Unable to generate an AI advisory right now.",
    notApplicable: "No AI advisory: this prospect is not yet qualified for analysis.",
    disclaimer: "The AI advisory is advisory only. It does not change priority, score, qualification, assignment, or follow-ups.",
    diagnosticPrefix: "Diagnostic:",
  },
} as const;
