/**
 * /admin/owner/ai-providers — RADAR INTELLIGENCE V2.1 Phase C/D. The
 * OWNER-only settings page for the persisted RADAR AI provider policy.
 * Server-guarded by requireStaffMember("RADAR_AI_POLICY_MANAGE") — these
 * strings never gate anything.
 *
 * This page manages POLICY (routing permission) only — never credentials
 * or models. `mode` stays fixed at "AUTO": `resolveProviderPolicy()`
 * (provider-policy.ts) never actually reads `ownerPolicy.mode` — the
 * AUTO/user-selection branch is driven entirely by `allowUserSelection` +
 * a per-request `requestedProviderId` (Phase D) — so exposing a live
 * "Manual" control here would be a misleading control with zero real
 * effect. `allowUserSelection` / `userSelectableProviders`, in contrast,
 * are live as of Phase D: the RADAR advisory surface
 * (components/crm/radar-intelligence-advisory.tsx) now reads these
 * settings to decide whether to show a real per-request provider
 * selector to users.
 */
export const aiProviderPolicy = {
  fr: {
    title: "Fournisseurs IA",
    subtitle: "Politique de routage de l'avis IA RADAR — géré exclusivement par le propriétaire.",

    infoDeterministic: "Le cœur déterministe de RADAR (score, priorité, action recommandée) fonctionne sans IA.",
    infoOptional: "L'avis IA est une fonctionnalité optionnelle qui vient en complément.",
    infoSecrets: "Les identifiants (clés API) sont gérés de façon sécurisée côté serveur et ne sont jamais affichés ici.",
    infoScope: "Cette page contrôle uniquement le routage entre fournisseurs — jamais les identifiants ni les modèles.",

    sectionProviders: "Disponibilité des fournisseurs",
    providerAnthropic: "Anthropic",
    providerOpenAi: "OpenAI",
    enabledLabel: "Activé dans la politique",
    statusConfigured: "Identifiant configuré",
    statusNotConfigured: "Identifiant non configuré",
    statusUnknown: "Statut indisponible",

    sectionRouting: "Politique de routage",
    modeLabel: "Mode",
    modeAutomatic: "Automatique",
    modeManualReserved: "Manuel — réservé à une phase future (aucun effet aujourd'hui)",
    defaultProviderLabel: "Fournisseur par défaut",
    defaultProviderAutoHint: "Automatique — premier fournisseur activé",
    fallbackEnabledLabel: "Autoriser le repli vers un autre fournisseur en cas d'échec éligible",
    fallbackOrderLabel: "Ordre de repli",
    fallbackOrderHint: "Utilisé uniquement quand le repli est autorisé ci-dessus.",

    sectionUserSelection: "Sélection par l'utilisateur",
    userSelectionNote: "Lorsque activé, un sélecteur de fournisseur apparaît sur l'avis IA RADAR pour les utilisateurs autorisés, limité aux fournisseurs sélectionnables ci-dessous.",
    allowUserSelectionLabel: "Autoriser les utilisateurs à choisir un fournisseur",
    selectableProvidersLabel: "Fournisseurs sélectionnables",

    saveButton: "Enregistrer les modifications",
    savingButton: "Enregistrement…",
    resetButton: "Réinitialiser aux valeurs par défaut",
    resetConfirmTitle: "Réinitialiser la politique IA ?",
    resetConfirmBody: "La politique actuelle sera supprimée et RADAR reviendra à la politique par défaut : Anthropic en priorité, repli vers OpenAI, aucune sélection par l'utilisateur.",
    resetConfirmLabel: "Réinitialiser",

    savedHint: "Modifications enregistrées.",
    resetHint: "Politique réinitialisée aux valeurs par défaut.",

    lastUpdatedLabel: "Dernière mise à jour",
    lastUpdatedNever: "Jamais — politique par défaut active",
    usingDefaultBadge: "Politique par défaut active (aucune ligne enregistrée)",

    errAtLeastOneEnabled: "Au moins un fournisseur doit être activé.",
    errDefaultMustBeEnabled: "Le fournisseur par défaut doit être activé.",
    errSelectableMustBeEnabled: "Un fournisseur sélectionnable doit être activé.",
    errAllowSelectionRequiresSelectable: "Sélectionnez au moins un fournisseur pour activer la sélection utilisateur.",
    errGeneric: "Impossible d'enregistrer la politique. Vérifiez vos réglages et réessayez.",
  },
  en: {
    title: "AI Providers",
    subtitle: "RADAR AI advisory routing policy — managed exclusively by the owner.",

    infoDeterministic: "RADAR's deterministic core (score, priority, recommended action) works without AI.",
    infoOptional: "The AI advisory is an optional feature layered on top.",
    infoSecrets: "Credentials (API keys) are managed securely on the server and are never displayed here.",
    infoScope: "This page controls routing between providers only — never credentials or models.",

    sectionProviders: "Provider availability",
    providerAnthropic: "Anthropic",
    providerOpenAi: "OpenAI",
    enabledLabel: "Enabled in policy",
    statusConfigured: "Credential configured",
    statusNotConfigured: "Credential not configured",
    statusUnknown: "Status unavailable",

    sectionRouting: "Routing policy",
    modeLabel: "Mode",
    modeAutomatic: "Automatic",
    modeManualReserved: "Manual — reserved for a future phase (no effect today)",
    defaultProviderLabel: "Default provider",
    defaultProviderAutoHint: "Automatic — first enabled provider",
    fallbackEnabledLabel: "Allow fallback to another provider on an eligible failure",
    fallbackOrderLabel: "Fallback order",
    fallbackOrderHint: "Only used when fallback is allowed above.",

    sectionUserSelection: "User provider selection",
    userSelectionNote: "When enabled, a provider selector appears on the RADAR AI advisory for authorized users, limited to the selectable providers below.",
    allowUserSelectionLabel: "Allow users to choose a provider",
    selectableProvidersLabel: "Selectable providers",

    saveButton: "Save changes",
    savingButton: "Saving…",
    resetButton: "Reset to default",
    resetConfirmTitle: "Reset the AI policy?",
    resetConfirmBody: "The current policy will be deleted and RADAR will fall back to the default policy: Anthropic first, fallback to OpenAI, no user selection.",
    resetConfirmLabel: "Reset",

    savedHint: "Changes saved.",
    resetHint: "Policy reset to default.",

    lastUpdatedLabel: "Last updated",
    lastUpdatedNever: "Never — default policy active",
    usingDefaultBadge: "Default policy active (no saved row)",

    errAtLeastOneEnabled: "At least one provider must be enabled.",
    errDefaultMustBeEnabled: "The default provider must be enabled.",
    errSelectableMustBeEnabled: "A selectable provider must be enabled.",
    errAllowSelectionRequiresSelectable: "Select at least one provider to enable user selection.",
    errGeneric: "Unable to save the policy. Check your settings and try again.",
  },
} as const;
