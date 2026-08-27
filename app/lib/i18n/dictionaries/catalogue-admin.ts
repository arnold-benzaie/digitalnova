/**
 * Catalogue — business V1 for the Agency Space (app/admin/catalogue/page.tsx).
 * Read-only for staff/admin/agent/supervisor — no create/edit/delete/publish
 * action exists on this page, so this dictionary defines no such label.
 *
 * Enum VALUES that are inherent data (service_id, price, currency code) stay
 * verbatim from the database. Only the UI chrome around them — type/status/
 * market/frequency labels, filters, empty states — is translated here; the
 * V1 audit found the previous all-raw-enum presentation unreadable for
 * day-to-day agency use, this is what replaces it. See PAYMENT_FREQUENCY_KEYS
 * below for the exact set this dictionary must cover — sourced from the
 * `service_market_offers.payment_frequency` CHECK constraint in db/schema.ts,
 * not guessed.
 */
export const catalogueAdmin = {
  fr: {
    title: "Catalogue",
    subtitle: "Catalogue commercial PUBLIC-MAP — vue en lecture seule pour l'Espace agence. Aucune modification possible depuis cette page.",

    summaryTotal: (n: number) => `${n} service${n > 1 ? "s" : ""}`,
    summaryIndividual: (n: number) => `${n} individuel${n > 1 ? "s" : ""}`,
    summaryPack: (n: number) => `${n} pack${n > 1 ? "s" : ""}`,
    summaryDuo: (n: number) => `${n} duo${n > 1 ? "s" : ""}`,

    searchPlaceholder: "Rechercher par nom ou identifiant…",
    typeFilterLabel: "Filtrer par type",
    typeAll: "Tous",
    typeIndividual: "Service individuel",
    typePack: "Pack",
    typeDuo: "Duo",
    typeAddon: "Addon",
    reset: "Réinitialiser",

    statusActive: "Actif",
    statusLegacy: "Historique",
    statusDraft: "Brouillon",

    marketCanada: "Canada",
    marketEurope: "Europe",
    noOfferForMarket: "Aucune offre pour ce marché",

    paymentFrequency: {
      ONE_TIME: "Paiement unique",
      MONTHLY: "Mensuel",
      ANNUAL: "Annuel",
    } as Record<string, string>,

    serviceIdLabel: "ID :",
    includedServicesLabel: "Services inclus",
    noChildren: "—",

    emptyNoneTitle: "Aucun service dans le catalogue pour le moment.",
    emptyFilteredTitle: "Aucun résultat",
    emptyFilteredDescription: "Essayez une autre recherche, ou réinitialisez les filtres.",
  },
  en: {
    title: "Catalogue",
    subtitle: "PUBLIC-MAP commercial catalogue — read-only view for the Agency Space. No modification is possible from this page.",

    summaryTotal: (n: number) => `${n} service${n > 1 ? "s" : ""}`,
    summaryIndividual: (n: number) => `${n} individual${n > 1 ? "s" : ""}`,
    summaryPack: (n: number) => `${n} pack${n > 1 ? "s" : ""}`,
    summaryDuo: (n: number) => `${n} duo${n > 1 ? "s" : ""}`,

    searchPlaceholder: "Search by name or ID…",
    typeFilterLabel: "Filter by type",
    typeAll: "All",
    typeIndividual: "Individual service",
    typePack: "Pack",
    typeDuo: "Duo",
    typeAddon: "Addon",
    reset: "Reset",

    statusActive: "Active",
    statusLegacy: "Legacy",
    statusDraft: "Draft",

    marketCanada: "Canada",
    marketEurope: "Europe",
    noOfferForMarket: "No offer for this market",

    paymentFrequency: {
      ONE_TIME: "One-time",
      MONTHLY: "Monthly",
      ANNUAL: "Annual",
    } as Record<string, string>,

    serviceIdLabel: "ID:",
    includedServicesLabel: "Included services",
    noChildren: "—",

    emptyNoneTitle: "No services in the catalogue yet.",
    emptyFilteredTitle: "No results",
    emptyFilteredDescription: "Try a different search, or reset the filters.",
  },
} as const;
