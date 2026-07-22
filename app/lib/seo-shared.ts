// Client-safe SEO constants/helpers — no `db` import here (see
// lib/crm-billing.ts vs lib/crm-document-number.ts split: pulling `db` into
// a module imported by client components breaks their bundling).

export const SEO_ISSUE_CATEGORY_OPTIONS = [
  { value: "metadata", label: "Métadonnées" },
  { value: "headings", label: "Titres (headings)" },
  { value: "indexability", label: "Indexabilité" },
  { value: "sitemap", label: "Sitemap" },
  { value: "robots", label: "Robots.txt" },
  { value: "performance", label: "Performance" },
];

export const SEO_ISSUE_PRIORITY_OPTIONS = [
  { value: "high", label: "Haute" },
  { value: "medium", label: "Moyenne" },
  { value: "low", label: "Basse" },
];

export const SEO_ISSUE_STATUS_OPTIONS = [
  { value: "open", label: "À traiter" },
  { value: "in_progress", label: "En cours" },
  { value: "resolved", label: "Résolu" },
  { value: "ignored", label: "Ignoré" },
];

export const SEO_ISSUE_STATUS_VALUES = SEO_ISSUE_STATUS_OPTIONS.map((o) => o.value);

export const SEO_ISSUE_CATEGORY_LABEL = Object.fromEntries(SEO_ISSUE_CATEGORY_OPTIONS.map((o) => [o.value, o.label]));
export const SEO_ISSUE_PRIORITY_LABEL = Object.fromEntries(SEO_ISSUE_PRIORITY_OPTIONS.map((o) => [o.value, o.label]));
export const SEO_ISSUE_STATUS_LABEL = Object.fromEntries(SEO_ISSUE_STATUS_OPTIONS.map((o) => [o.value, o.label]));

/** Score band used for the dashboard badge color + label. */
export function seoScoreBand(score: number): { label: string; tone: "good" | "warning" | "bad" } {
  if (score >= 80) return { label: "Bon", tone: "good" };
  if (score >= 50) return { label: "Moyen", tone: "warning" };
  return { label: "Faible", tone: "bad" };
}
