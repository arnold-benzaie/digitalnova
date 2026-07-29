/**
 * Status → Tailwind class maps for every /admin/integrations status enum,
 * centralized here instead of re-declared per component — same precedent
 * as components/crm/badges.tsx's *_CLASS maps. Used together with the
 * shared Badge component from components/crm/badges.tsx (label + className).
 */
export const API_KEY_STATUS_CLASS: Record<string, string> = {
  active: "bg-pm-g-green/10 text-pm-g-green",
  revoked: "bg-pm-rouge/10 text-pm-rouge-2",
  expired: "bg-pm-gris-2/60 text-pm-gris",
};

export const ENDPOINT_STATUS_CLASS: Record<string, string> = {
  active: "bg-pm-g-green/10 text-pm-g-green",
  disabled: "bg-pm-gris-2/60 text-pm-gris",
};

export const DELIVERY_STATUS_CLASS: Record<string, string> = {
  sent: "bg-pm-g-green/10 text-pm-g-green",
  failed: "bg-pm-rouge/10 text-pm-rouge-2",
  abandoned: "bg-pm-rouge/10 text-pm-rouge-2",
  retrying: "bg-pm-or/10 text-pm-or",
  pending: "bg-pm-gris-2/60 text-pm-gris",
  processing: "bg-pm-gris-2/60 text-pm-gris",
  skipped: "bg-pm-gris-2/60 text-pm-gris",
};
