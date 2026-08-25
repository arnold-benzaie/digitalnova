/**
 * Admin-only catalogue verification page (app/admin/catalogue/page.tsx) —
 * P0.1B.4, first internal consumer of the P0.1B.3 catalogue accessor.
 * Staff/admin visibility into the canonical catalogue for technical
 * verification. Never shown to clients, never linked from any
 * client-facing page. Read-only — no create/edit/delete/publish action
 * exists on this page, so this dictionary defines no such label either.
 *
 * Cell VALUES (type/status/market/currency/cta_type/checkout_status) are
 * deliberately shown verbatim from the database, not translated into
 * pretty labels — this is a technical verification view, translating
 * "PACK" or "REQUEST_QUOTE" into prose would obscure the exact stored
 * value that this page exists to let staff check.
 */
export const catalogueAdmin = {
  fr: {
    title: "Catalogue — vérification technique",
    subtitle: "Vue interne en lecture seule du catalogue canonique (P0.1B). Aucune modification possible depuis cette page.",
    columnServiceId: "SERVICE_ID",
    columnType: "Type",
    columnStatus: "Statut",
    columnNameFr: "Nom (FR)",
    columnCanada: "Canada",
    columnEurope: "Europe",
    columnChildren: "Relations",
    noOfferForMarket: "—",
    noChildren: "—",
    childrenLabel: "Enfants :",
    emptyState: "Aucun service dans le catalogue pour le moment.",
    totalServices: (count: number) => `${count} service(s)`,
  },
  en: {
    title: "Catalogue — technical verification",
    subtitle: "Internal read-only view of the canonical catalogue (P0.1B). No modification is possible from this page.",
    columnServiceId: "SERVICE_ID",
    columnType: "Type",
    columnStatus: "Status",
    columnNameFr: "Name (FR)",
    columnCanada: "Canada",
    columnEurope: "Europe",
    columnChildren: "Relations",
    noOfferForMarket: "—",
    noChildren: "—",
    childrenLabel: "Children:",
    emptyState: "No services in the catalogue yet.",
    totalServices: (count: number) => `${count} service(s)`,
  },
} as const;
