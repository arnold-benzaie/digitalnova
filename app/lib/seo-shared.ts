// Client-safe SEO constants/helpers — no `db` import here (see
// lib/crm-billing.ts vs lib/crm-document-number.ts split: pulling `db` into
// a module imported by client components breaks their bundling).
import type { Locale } from "@/lib/i18n/dictionaries";

export const SEO_ISSUE_CATEGORY_OPTIONS = [
  { value: "metadata", label: "Métadonnées" },
  { value: "headings", label: "Titres (headings)" },
  { value: "indexability", label: "Indexabilité" },
  { value: "sitemap", label: "Sitemap" },
  { value: "robots", label: "Robots.txt" },
  { value: "performance", label: "Performance" },
];
export const SEO_ISSUE_CATEGORY_OPTIONS_EN = [
  { value: "metadata", label: "Metadata" },
  { value: "headings", label: "Headings" },
  { value: "indexability", label: "Indexability" },
  { value: "sitemap", label: "Sitemap" },
  { value: "robots", label: "Robots.txt" },
  { value: "performance", label: "Performance" },
];

export const SEO_ISSUE_PRIORITY_OPTIONS = [
  { value: "high", label: "Haute" },
  { value: "medium", label: "Moyenne" },
  { value: "low", label: "Basse" },
];
export const SEO_ISSUE_PRIORITY_OPTIONS_EN = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const SEO_ISSUE_STATUS_OPTIONS = [
  { value: "open", label: "À traiter" },
  { value: "in_progress", label: "En cours" },
  { value: "resolved", label: "Résolu" },
  { value: "ignored", label: "Ignoré" },
];
export const SEO_ISSUE_STATUS_OPTIONS_EN = [
  { value: "open", label: "To address" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];

export const SEO_ISSUE_STATUS_VALUES = SEO_ISSUE_STATUS_OPTIONS.map((o) => o.value);

export const SEO_ISSUE_CATEGORY_LABEL = Object.fromEntries(SEO_ISSUE_CATEGORY_OPTIONS.map((o) => [o.value, o.label]));
export const SEO_ISSUE_PRIORITY_LABEL = Object.fromEntries(SEO_ISSUE_PRIORITY_OPTIONS.map((o) => [o.value, o.label]));
export const SEO_ISSUE_STATUS_LABEL = Object.fromEntries(SEO_ISSUE_STATUS_OPTIONS.map((o) => [o.value, o.label]));
const SEO_ISSUE_CATEGORY_LABEL_EN = Object.fromEntries(SEO_ISSUE_CATEGORY_OPTIONS_EN.map((o) => [o.value, o.label]));
const SEO_ISSUE_PRIORITY_LABEL_EN = Object.fromEntries(SEO_ISSUE_PRIORITY_OPTIONS_EN.map((o) => [o.value, o.label]));
const SEO_ISSUE_STATUS_LABEL_EN = Object.fromEntries(SEO_ISSUE_STATUS_OPTIONS_EN.map((o) => [o.value, o.label]));

export function getSeoIssueCategoryOptions(locale: Locale) {
  return locale === "en" ? SEO_ISSUE_CATEGORY_OPTIONS_EN : SEO_ISSUE_CATEGORY_OPTIONS;
}
export function getSeoIssuePriorityOptions(locale: Locale) {
  return locale === "en" ? SEO_ISSUE_PRIORITY_OPTIONS_EN : SEO_ISSUE_PRIORITY_OPTIONS;
}
export function getSeoIssueStatusOptions(locale: Locale) {
  return locale === "en" ? SEO_ISSUE_STATUS_OPTIONS_EN : SEO_ISSUE_STATUS_OPTIONS;
}
export function getSeoIssueCategoryLabel(locale: Locale): Record<string, string> {
  return locale === "en" ? SEO_ISSUE_CATEGORY_LABEL_EN : SEO_ISSUE_CATEGORY_LABEL;
}
export function getSeoIssuePriorityLabel(locale: Locale): Record<string, string> {
  return locale === "en" ? SEO_ISSUE_PRIORITY_LABEL_EN : SEO_ISSUE_PRIORITY_LABEL;
}
export function getSeoIssueStatusLabel(locale: Locale): Record<string, string> {
  return locale === "en" ? SEO_ISSUE_STATUS_LABEL_EN : SEO_ISSUE_STATUS_LABEL;
}

/** Score band used for the dashboard badge color + label. */
export function seoScoreBand(score: number, locale: Locale = "fr"): { label: string; tone: "good" | "warning" | "bad" } {
  if (locale === "en") {
    if (score >= 80) return { label: "Good", tone: "good" };
    if (score >= 50) return { label: "Average", tone: "warning" };
    return { label: "Weak", tone: "bad" };
  }
  if (score >= 80) return { label: "Bon", tone: "good" };
  if (score >= 50) return { label: "Moyen", tone: "warning" };
  return { label: "Faible", tone: "bad" };
}
