/**
 * Single source of truth for the product's display name — every place the
 * app name is shown to a user (page titles, error messages, PDF footers)
 * should import this instead of hardcoding the string, so a rebrand is a
 * one-line change instead of a repo-wide find/replace.
 */
export const APP_NAME = "PUBLIC-MAP";

/** Canonical public origin — used to build absolute URLs that leave the
 * server (emailed links, QR codes). Previously duplicated as a private
 * constant in lib/actions/crm-invoices.ts; centralized here so the
 * invoice-QR verification link and the emailed PDF link can never drift
 * apart. */
export const APP_BASE_URL = "https://app.public-map.com";
