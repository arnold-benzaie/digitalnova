/**
 * /admin/owner/ai-governance's "Quotas et limites" section — RADAR
 * INTELLIGENCE V2.1 Phase G4A. Server-guarded by
 * requireStaffMember("RADAR_AI_POLICY_MANAGE") — these strings never gate
 * anything. Deliberately its own dictionary file (mirrors
 * ai-token-governance.ts's own per-concern split): quota POLICY
 * (this file) is configuration; token GOVERNANCE (ai-token-governance.ts)
 * is historical reporting — two different concerns sharing one page.
 *
 * `enforcementNotice` exists specifically so the OWNER is never misled:
 * G4A persists limits, it does not yet enforce them (see
 * lib/actions/radar-ai-quota-policy.ts's own docstring).
 */
export const aiQuotaPolicy = {
  fr: {
    sectionTitle: "Quotas et limites",
    sectionSubtitle: "Politique de consommation IA — visible et modifiable uniquement par le propriétaire.",
    enforcementNotice: "Ces paramètres définissent une limite configurée. L'application automatique de cette limite n'est pas encore active.",
    enabledLabel: "Couche IA externe activée",
    dailyRequestLimitLabel: "Limite quotidienne de requêtes",
    dailyRequestLimitHint: "Laisser vide pour aucune limite.",
    dailyTokenLimitLabel: "Limite quotidienne de tokens",
    dailyTokenLimitHint: "Laisser vide pour aucune limite.",
    warningThresholdLabel: "Seuil d'avertissement (%)",
    warningThresholdHint: "Pourcentage de la limite à partir duquel un avertissement futur sera affiché.",
    saveButtonLabel: "Enregistrer",
    savedMessage: "Politique de quota enregistrée.",
    validationErrorMessage: "Valeurs invalides — vérifiez les champs ci-dessus.",
    errorMessage: "La politique de quota est temporairement indisponible.",
  },
  en: {
    sectionTitle: "Quotas & limits",
    sectionSubtitle: "AI consumption policy — visible and editable by the owner only.",
    enforcementNotice: "These settings define a configured limit. Automatic enforcement of this limit is not active yet.",
    enabledLabel: "External AI layer enabled",
    dailyRequestLimitLabel: "Daily request limit",
    dailyRequestLimitHint: "Leave empty for no limit.",
    dailyTokenLimitLabel: "Daily token limit",
    dailyTokenLimitHint: "Leave empty for no limit.",
    warningThresholdLabel: "Warning threshold (%)",
    warningThresholdHint: "Percentage of the limit at which a future warning will appear.",
    saveButtonLabel: "Save",
    savedMessage: "Quota policy saved.",
    validationErrorMessage: "Invalid values — check the fields above.",
    errorMessage: "The quota policy is temporarily unavailable.",
  },
} as const;
