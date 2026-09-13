/**
 * /admin/owner/ai-governance's "Quotas et limites" section — RADAR
 * INTELLIGENCE V2.1 Phase G4A. Server-guarded by
 * requireStaffMember("RADAR_AI_POLICY_MANAGE") — these strings never gate
 * anything. Deliberately its own dictionary file (mirrors
 * ai-token-governance.ts's own per-concern split): quota POLICY
 * (this file) is configuration; token GOVERNANCE (ai-token-governance.ts)
 * is historical reporting; quota STATUS (ai-quota-status.ts, Phase
 * G4C-3) is the current, durable enforcement state — three different
 * concerns sharing one page.
 *
 * `enforcementNotice` — UPDATED for Phase G4C-3: G4B-2 enforcement has
 * been live in Production since that phase shipped, so this notice no
 * longer says "not active yet." It now tells the OWNER these limits ARE
 * enforced, and points at the "Quota actuel" section below for the live
 * state.
 */
export const aiQuotaPolicy = {
  fr: {
    sectionTitle: "Quotas et limites",
    sectionSubtitle: "Politique de consommation IA — visible et modifiable uniquement par le propriétaire.",
    enforcementNotice: "Ces paramètres définissent une limite appliquée en temps réel. Voir la section « Quota actuel » ci-dessous pour l'état courant.",
    enabledLabel: "Couche IA externe activée",
    dailyRequestLimitLabel: "Limite quotidienne de requêtes",
    dailyRequestLimitHint: "Laisser vide pour aucune limite.",
    dailyTokenLimitLabel: "Limite quotidienne de tokens",
    dailyTokenLimitHint: "Laisser vide pour aucune limite.",
    warningThresholdLabel: "Seuil d'avertissement (%)",
    warningThresholdHint: "Pourcentage de la limite à partir duquel un avertissement est affiché dans la section « Quota actuel ».",
    saveButtonLabel: "Enregistrer",
    savedMessage: "Politique de quota enregistrée.",
    validationErrorMessage: "Valeurs invalides — vérifiez les champs ci-dessus.",
    errorMessage: "La politique de quota est temporairement indisponible.",
  },
  en: {
    sectionTitle: "Quotas & limits",
    sectionSubtitle: "AI consumption policy — visible and editable by the owner only.",
    enforcementNotice: "These settings define a limit enforced in real time. See the \"Current quota\" section below for the live state.",
    enabledLabel: "External AI layer enabled",
    dailyRequestLimitLabel: "Daily request limit",
    dailyRequestLimitHint: "Leave empty for no limit.",
    dailyTokenLimitLabel: "Daily token limit",
    dailyTokenLimitHint: "Leave empty for no limit.",
    warningThresholdLabel: "Warning threshold (%)",
    warningThresholdHint: "Percentage of the limit at which a warning appears in the \"Current quota\" section.",
    saveButtonLabel: "Save",
    savedMessage: "Quota policy saved.",
    validationErrorMessage: "Invalid values — check the fields above.",
    errorMessage: "The quota policy is temporarily unavailable.",
  },
} as const;
