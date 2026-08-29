/**
 * Commercial performance dashboard (app/admin/crm/performance/page.tsx) —
 * a pure presentation layer over lib/actions/commercial-analytics.ts's
 * frozen, all-time CommercialAnalyticsSnapshot. Staff/admin only.
 *
 * Labeling follows the Phase 1G-C claim-safety review: outcome-based
 * response metrics are staff assessments, never implied sentiment
 * detection; dealWinRate/clientConversionRate are explicitly all-time,
 * current-state ratios, never framed as a trend or a prediction; no
 * metric here is described using "AI", "probability", "likelihood", or
 * "forecast" — none of that exists in the underlying data.
 */
export const commercialAnalytics = {
  fr: {
    title: "Performance commerciale",
    subtitle: "Vue d'ensemble, sur toute la période, de l'activité commerciale enregistrée — aucune période ni tendance ne peut être filtrée.",
    noDataShort: "—",
    rateContext: (numerator: number, denominator: number) => `${numerator} / ${denominator}`,

    uniqueProspectsContactedLabel: "Prospects contactés",
    responseRateLabel: "Taux de réponse",
    meetingRateLabel: "Taux de rendez-vous",
    meetingRateCaption: "Rendez-vous observés après une prise de contact sortante — pas un taux de rendez-vous planifiés ou honorés.",
    dealWinRateLabel: "Taux de réussite des affaires",
    dealWinRateCaption: "Affaires conclues à ce jour (gagnées vs. perdues), toutes périodes confondues.",
    clientConversionRateLabel: "Taux de conversion (clients contactés)",
    clientConversionRateCaption: "Clients contactés ayant, à ce jour, au moins une affaire gagnée.",
    grossRevenueLabel: "Revenu encaissé",

    volumeTitle: "Volume de prospection",
    contactAttemptsLabel: "Tentatives de contact",
    outboundCallsLabel: "Appels sortants",
    outboundEmailsLabel: "Emails sortants",
    volumeNote: "« Prospects contactés » compte chaque prospect une seule fois ; les tentatives comptent chaque interaction sortante.",

    responseTitle: "Détail des réponses",
    inboundEventsLabel: "Événements entrants (bruts)",
    uniqueRespondingProspectsAnyLabel: "Prospects ayant répondu (bruts)",
    responseContextNote: "Ces deux chiffres comptent toute interaction entrante, sans lien avec une prise de contact préalable. Le taux de réponse ci-dessus ne compte que les réponses survenues après une prise de contact sortante.",
    positiveOfContactedLabel: "Réponses jugées positives par l'équipe (sur les contactés)",
    positiveOfRespondersLabel: "Réponses jugées positives par l'équipe (sur les répondants)",
    negativeOfContactedLabel: "Réponses jugées négatives par l'équipe (sur les contactés)",
    negativeOfRespondersLabel: "Réponses jugées négatives par l'équipe (sur les répondants)",

    meetingTitle: "Détail des rendez-vous",
    heldEventsLabel: "Rendez-vous tenus (bruts)",
    uniqueProspectsWithMeetingLabel: "Prospects rencontrés",

    proposalTitle: "Propositions commerciales",
    proposalSentLabel: "Envoyées",
    proposalAcceptedLabel: "Acceptées",
    proposalDeclinedLabel: "Refusées",
    proposalClientsSuffix: (n: number) => `${n} client(s)`,
    proposalDocumentsSuffix: (n: number) => `${n} document(s)`,

    paymentTitle: "Paiements",
    payingClientCountLabel: "Clients payeurs",
    payingClientRateOfContactedLabel: "Taux de clients payeurs (sur les contactés)",
    refundedRevenueLabel: "Revenu remboursé",
    noRevenue: "Aucun revenu enregistré",

    timingTitle: "Délais",
    timeToFirstContactLabel: "Délai avant premier contact",
    timeToFirstResponseLabel: "Délai avant première réponse",
    createdToFirstPaidLabel: "Délai avant premier paiement",
    medianLabel: "Médiane",
    avgLabel: "Moyenne",
    daysValue: (n: number) => `${n.toFixed(1)} j`,
    sampleSize: (n: number) => `n = ${n}`,
    noDurationData: "Aucune donnée disponible",
    anomalyNote: (n: number) => `${n} valeur(s) incohérente(s) exclue(s)`,

    legacyNoteTitle: "Limite des données historiques",
    legacyNoteBody: "Certaines interactions historiques ne contiennent pas d'information de direction (entrant/sortant). Les indicateurs qui dépendent de cette information peuvent donc sous-représenter l'activité historique.",
    legacyNoteTrackingSince: (date: string) => `Le premier enregistrement disposant de cette information date du ${date}.`,
  },
  en: {
    title: "Commercial performance",
    subtitle: "All-time overview of recorded commercial activity — no period or trend can be filtered here.",
    noDataShort: "—",
    rateContext: (numerator: number, denominator: number) => `${numerator} / ${denominator}`,

    uniqueProspectsContactedLabel: "Prospects contacted",
    responseRateLabel: "Response rate",
    meetingRateLabel: "Meeting rate",
    meetingRateCaption: "Meetings observed after outbound outreach — not a scheduled or show-up rate.",
    dealWinRateLabel: "Deal win rate",
    dealWinRateCaption: "Deals concluded to date (won vs. lost), all-time.",
    clientConversionRateLabel: "Client conversion rate",
    clientConversionRateCaption: "Contacted clients with at least one won deal to date.",
    grossRevenueLabel: "Gross collected revenue",

    volumeTitle: "Outreach volume",
    contactAttemptsLabel: "Contact attempts",
    outboundCallsLabel: "Outbound calls",
    outboundEmailsLabel: "Outbound emails",
    volumeNote: "\"Prospects contacted\" counts each prospect once; attempts count every outbound interaction.",

    responseTitle: "Response detail",
    inboundEventsLabel: "Inbound events (raw)",
    uniqueRespondingProspectsAnyLabel: "Prospects who replied (raw)",
    responseContextNote: "These two figures count every inbound interaction, independent of any prior outreach. The response rate above only counts replies that occurred after an outbound contact.",
    positiveOfContactedLabel: "Responses staff marked positive (of contacted)",
    positiveOfRespondersLabel: "Responses staff marked positive (of responders)",
    negativeOfContactedLabel: "Responses staff marked negative (of contacted)",
    negativeOfRespondersLabel: "Responses staff marked negative (of responders)",

    meetingTitle: "Meeting detail",
    heldEventsLabel: "Meetings held (raw)",
    uniqueProspectsWithMeetingLabel: "Prospects met",

    proposalTitle: "Proposals",
    proposalSentLabel: "Sent",
    proposalAcceptedLabel: "Accepted",
    proposalDeclinedLabel: "Declined",
    proposalClientsSuffix: (n: number) => `${n} client(s)`,
    proposalDocumentsSuffix: (n: number) => `${n} document(s)`,

    paymentTitle: "Payments",
    payingClientCountLabel: "Paying clients",
    payingClientRateOfContactedLabel: "Paying client rate (of contacted)",
    refundedRevenueLabel: "Refunded revenue",
    noRevenue: "No revenue recorded",

    timingTitle: "Timing",
    timeToFirstContactLabel: "Time to first contact",
    timeToFirstResponseLabel: "Time to first response",
    createdToFirstPaidLabel: "Time to first payment",
    medianLabel: "Median",
    avgLabel: "Average",
    daysValue: (n: number) => `${n.toFixed(1)}d`,
    sampleSize: (n: number) => `n = ${n}`,
    noDurationData: "No data available",
    anomalyNote: (n: number) => `${n} inconsistent value(s) excluded`,

    legacyNoteTitle: "Historical data limitation",
    legacyNoteBody: "Some historical interactions do not contain direction information (inbound/outbound). Metrics that depend on this information may therefore under-represent historical activity.",
    legacyNoteTrackingSince: (date: string) => `The first record containing this information dates from ${date}.`,
  },
} as const;
