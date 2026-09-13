/**
 * /admin/owner/ai-governance — RADAR INTELLIGENCE V2.1 Phase G3B. The
 * OWNER-only token USAGE reporting page — deliberately separate from
 * ai-provider-policy.ts (routing) and ai-provider-operations.ts
 * (credential/model). Server-guarded by
 * requireStaffMember("RADAR_AI_POLICY_MANAGE") — these strings never
 * gate anything.
 *
 * Provider/model breakdown labels deliberately say "served by," never
 * "calls"/"appels" — a raw provider dispatch count is not honestly
 * computable from the underlying telemetry (see the G2.1 / G3
 * architecture reviews).
 */
export const aiTokenGovernance = {
  fr: {
    title: "Gouvernance IA",
    subtitle: "Utilisation des tokens RADAR IA — visible uniquement par le propriétaire.",

    /** Phase G4C-3 — heading for THIS section specifically, so it reads
     * clearly as historical/telemetry reporting, distinct from the
     * "Quota actuel" section above it (ai-quota-status.ts) which reports
     * the current, durable quota state instead. */
    historySectionTitle: "Historique d'utilisation IA",

    windowToday: "Aujourd'hui",
    window7d: "7 jours",
    window30d: "30 jours",

    inputTokensLabel: "Entrée",
    outputTokensLabel: "Sortie",
    totalTokensLabel: "Total",

    successfulAdvisoriesLabel: "Requêtes IA réussies",
    successfulFallbackAdvisoriesLabel: "Fallbacks réussis",

    byProviderTitle: "Réponses servies par fournisseur",
    byModelTitle: "Réponses servies par modèle",
    bySelectionModeTitle: "Répartition automatique / explicite",

    providerColumn: "Fournisseur",
    modelColumn: "Modèle",
    selectionModeColumn: "Mode de sélection",
    selectionModeAutomatic: "Automatique",
    selectionModeExplicit: "Explicite",

    noDataShort: "Aucune donnée disponible.",
    errorMessage: "Les données d'utilisation sont temporairement indisponibles.",
  },
  en: {
    title: "AI Governance",
    subtitle: "RADAR AI token usage — visible to the owner only.",

    historySectionTitle: "AI usage history",

    windowToday: "Today",
    window7d: "7 days",
    window30d: "30 days",

    inputTokensLabel: "Input",
    outputTokensLabel: "Output",
    totalTokensLabel: "Total",

    successfulAdvisoriesLabel: "Successful AI requests",
    successfulFallbackAdvisoriesLabel: "Successful fallbacks",

    byProviderTitle: "Responses served by provider",
    byModelTitle: "Responses served by model",
    bySelectionModeTitle: "Automatic / explicit split",

    providerColumn: "Provider",
    modelColumn: "Model",
    selectionModeColumn: "Selection mode",
    selectionModeAutomatic: "Automatic",
    selectionModeExplicit: "Explicit",

    noDataShort: "No data available.",
    errorMessage: "Usage data is temporarily unavailable.",
  },
} as const;
