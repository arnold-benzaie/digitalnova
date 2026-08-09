/**
 * Public, unauthenticated invoice-verification page (app/invoice-verification/[token]).
 * Mirrors the audit report portal's publicPortal.linkErrors pattern
 * (lib/i18n/dictionaries/audit-module.ts) — same reason codes, since both
 * pages resolve access tokens the same way (resolveInvoiceByToken /
 * resolveReportByToken). Deliberately shows only non-personal fields —
 * see app/invoice-verification/[token]/page.tsx for what's withheld.
 */
export const invoiceVerification = {
  fr: {
    metaTitle: "Vérification de facture — PUBLIC-MAP",
    kicker: "Vérification de facture",
    issuer: "Émetteur",
    verified: "Facture authentique",
    invoiceNumber: "Numéro de facture",
    issuedOn: "Date d'émission",
    totalAmount: "Montant total",
    status: "Statut",
    linkErrorFallback: "Ce lien n'est pas valide.",
    linkErrors: {
      not_found: "Ce lien n'est pas valide.",
      revoked: "Ce lien a été désactivé.",
      expired: "Ce lien a expiré.",
      locked: "Trop de tentatives ont été effectuées sur ce lien. Contactez PUBLIC-MAP pour vérifier cette facture autrement.",
      rate_limited: "Trop de tentatives depuis cette connexion. Merci de réessayer dans quelques minutes.",
    },
  },
  en: {
    metaTitle: "Invoice verification — PUBLIC-MAP",
    kicker: "Invoice verification",
    issuer: "Issuer",
    verified: "Genuine invoice",
    invoiceNumber: "Invoice number",
    issuedOn: "Issued on",
    totalAmount: "Total amount",
    status: "Status",
    linkErrorFallback: "This link is not valid.",
    linkErrors: {
      not_found: "This link is not valid.",
      revoked: "This link has been disabled.",
      expired: "This link has expired.",
      locked: "Too many attempts have been made on this link. Contact PUBLIC-MAP to verify this invoice another way.",
      rate_limited: "Too many attempts from this connection. Please try again in a few minutes.",
    },
  },
} as const;
