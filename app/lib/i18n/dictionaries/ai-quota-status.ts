/**
 * /admin/owner/ai-governance's "Quota actuel" section — RADAR
 * INTELLIGENCE V2.1 Phase G4C-3. Server-guarded by
 * requireStaffMember("RADAR_AI_POLICY_MANAGE") — these strings never gate
 * anything. Deliberately its OWN dictionary file (same per-concern split
 * this page's other two dictionaries already follow — see
 * ai-quota-policy.ts's own docstring): `aiQuotaPolicy` is CONFIGURATION,
 * `aiTokenGovernance` is HISTORICAL reporting, and this file is the
 * CURRENT, DURABLE quota STATE (G4C-2's snapshot) — three different
 * concerns on one page, never merged into one dictionary.
 */
export const aiQuotaStatus = {
  fr: {
    sectionTitle: "Quota actuel",
    sectionSubtitle: "État durable du quota IA, mis à jour à chaque requête — distinct de l'historique d'utilisation ci-dessous.",
    statusLabel: "Statut",
    statusUnavailable: "Indisponible",
    statusDisabled: "Désactivé",
    statusLimited: "Limite atteinte",
    statusWarning: "Seuil d'avertissement atteint",
    statusNormal: "Normal",
    unavailableMessage: "Impossible de déterminer l'état du quota de manière fiable pour le moment.",
    disabledMessage: "L'application des quotas IA est désactivée par le propriétaire — aucune limite n'est actuellement appliquée.",
    requestsSectionTitle: "Requêtes",
    tokensSectionTitle: "Tokens",
    usedLabel: "Utilisé",
    limitLabel: "Limite",
    remainingLabel: "Restant",
    usagePercentLabel: "Utilisation",
    unlimitedLabel: "Illimité",
    warningThresholdLabel: "Seuil d'avertissement",
  },
  en: {
    sectionTitle: "Current quota",
    sectionSubtitle: "Durable AI quota state, updated on every request — distinct from the usage history below.",
    statusLabel: "Status",
    statusUnavailable: "Unavailable",
    statusDisabled: "Disabled",
    statusLimited: "Limit reached",
    statusWarning: "Warning threshold reached",
    statusNormal: "Normal",
    unavailableMessage: "The quota state cannot be reliably determined right now.",
    disabledMessage: "AI quota enforcement is disabled by the owner — no limit is currently applied.",
    requestsSectionTitle: "Requests",
    tokensSectionTitle: "Tokens",
    usedLabel: "Used",
    limitLabel: "Limit",
    remainingLabel: "Remaining",
    usagePercentLabel: "Usage",
    unlimitedLabel: "Unlimited",
    warningThresholdLabel: "Warning threshold",
  },
} as const;
