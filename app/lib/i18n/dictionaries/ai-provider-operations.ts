/**
 * /admin/owner/ai-providers — RADAR INTELLIGENCE V2.1 Phase E. The
 * "Provider operations" section: safe credential status and model
 * selection, deliberately separate from ai-provider-policy.ts's ROUTING
 * strings. Server-guarded by requireStaffMember("RADAR_AI_POLICY_MANAGE")
 * — these strings never gate anything.
 */
export const aiProviderOperations = {
  fr: {
    sectionTitle: "Opérations fournisseur",
    sectionSubtitle: "Statut technique et modèle actif par fournisseur — jamais les identifiants.",

    credentialLabel: "Identifiant",
    credentialConfigured: "Configuré",
    credentialNotConfigured: "Non configuré",

    enabledLabel: "Fournisseur",
    enabledYes: "Activé",
    enabledNo: "Désactivé",

    modelLabel: "Modèle",
    modelOverriddenHint: "Substitution active — remplace le modèle défini par l'environnement serveur.",

    operationalStateLabel: "État opérationnel",
    operationalStateReady: "Prêt",
    operationalStateConfigurationIssue: "Problème de configuration",
    operationalStateUnknown: "Inconnu",

    saveModelButton: "Enregistrer le modèle",
    savingModelButton: "Enregistrement…",
    modelSavedHint: "Modèle mis à jour.",
    errInvalidModelUpdate: "Modèle invalide pour ce fournisseur. Vérifiez votre sélection et réessayez.",

    credentialOperationsTitle: "Rotation des identifiants",
    credentialOperationsExternalOnly: "La rotation des identifiants est effectuée via les paramètres d'infrastructure sécurisés.",
  },
  en: {
    sectionTitle: "Provider operations",
    sectionSubtitle: "Technical status and active model per provider — never the credentials.",

    credentialLabel: "Credential",
    credentialConfigured: "Configured",
    credentialNotConfigured: "Not configured",

    enabledLabel: "Provider",
    enabledYes: "Enabled",
    enabledNo: "Disabled",

    modelLabel: "Model",
    modelOverriddenHint: "Override active — replaces the server environment's configured model.",

    operationalStateLabel: "Operational state",
    operationalStateReady: "Ready",
    operationalStateConfigurationIssue: "Configuration issue",
    operationalStateUnknown: "Unknown",

    saveModelButton: "Save model",
    savingModelButton: "Saving…",
    modelSavedHint: "Model updated.",
    errInvalidModelUpdate: "Invalid model for this provider. Check your selection and try again.",

    credentialOperationsTitle: "Credential rotation",
    credentialOperationsExternalOnly: "Credential rotation is performed through secure infrastructure settings.",
  },
} as const;
