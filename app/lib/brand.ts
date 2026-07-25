/**
 * Single source of truth for the product's display name — every place the
 * app name is shown to a user (page titles, error messages, PDF footers)
 * should import this instead of hardcoding the string, so a rebrand is a
 * one-line change instead of a repo-wide find/replace.
 */
export const APP_NAME = "PUBLIC-MAP";
