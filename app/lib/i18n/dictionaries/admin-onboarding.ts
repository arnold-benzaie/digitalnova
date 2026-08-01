/**
 * Admin-facing onboarding detail page (app/admin/onboarding/page.tsx) —
 * reached by clicking an "onboarding.completed" notification. Separate
 * from dashboard.onboarding (lib/i18n/dictionaries/dashboard.ts), which is
 * the client's own view of the same data — different audience, different
 * copy, deliberately not shared.
 */
export const adminOnboarding = {
  fr: {
    title: "Questionnaire d'accueil",
    lead: "Réponses soumises par le client, synthèse générée automatiquement.",
    clientLabel: "Client",
    emailLabel: "E-mail",
    organizationLabel: "Organisation",
    submittedLabel: "Soumis le",
    noClientFound: "Aucun compte client trouvé pour cette organisation.",
    answersTitle: "Réponses au questionnaire",
    summaryTitle: "Synthèse générée",
    nextStepTitle: "Prochaine étape recommandée",
    contactClient: "Contacter le client",
    createAudit: "Créer un audit",
    empty: "Aucune réponse de questionnaire pour le moment",
    emptyHint: "Ce client n'a pas encore complété (ou a réinitialisé) son questionnaire d'accueil.",
  },
  en: {
    title: "Onboarding questionnaire",
    lead: "Answers submitted by the client, with an automatically generated summary.",
    clientLabel: "Client",
    emailLabel: "Email",
    organizationLabel: "Organization",
    submittedLabel: "Submitted on",
    noClientFound: "No client account found for this organization.",
    answersTitle: "Questionnaire answers",
    summaryTitle: "Generated summary",
    nextStepTitle: "Recommended next step",
    contactClient: "Contact the client",
    createAudit: "Create an audit",
    empty: "No questionnaire answers yet",
    emptyHint: "This client hasn't completed (or has reset) their onboarding questionnaire yet.",
  },
} as const;
