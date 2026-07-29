/**
 * Status → Tailwind class maps for every /admin/integrations status enum,
 * centralized here instead of re-declared per component — same precedent
 * as components/crm/badges.tsx's *_CLASS maps. Consumed as a Badge
 * className: components/crm/badges.tsx's Badge on the admin side,
 * components/ui/badge.tsx (variant="outline") on the Developer Console
 * side — same class strings work with both since they only set
 * background/foreground, never anything the two Badge components
 * disagree on.
 */
export const API_KEY_STATUS_CLASS: Record<string, string> = {
  active: "bg-pm-g-green/10 text-pm-g-green",
  revoked: "bg-pm-rouge/10 text-pm-rouge-2",
  expired: "bg-pm-gris-2/60 text-pm-gris",
};

export const ENDPOINT_STATUS_CLASS: Record<string, string> = {
  active: "bg-pm-g-green/10 text-pm-g-green",
  // text-foreground (not text-pm-or) on the tinted background — pm-or at
  // ~2.7:1 against a light tint fails WCAG AA for normal text (4.5:1);
  // the orange tint alone still carries the "paused" cue, contrast comes
  // from the theme-aware foreground (also correct in dark mode, unlike a
  // hardcoded text-pm-noir would be).
  paused: "bg-pm-or/15 text-foreground",
  disabled: "bg-pm-gris-2/60 text-pm-gris",
};

export const DELIVERY_STATUS_CLASS: Record<string, string> = {
  sent: "bg-pm-g-green/10 text-pm-g-green",
  failed: "bg-pm-rouge/10 text-pm-rouge-2",
  abandoned: "bg-pm-rouge/10 text-pm-rouge-2",
  // text-foreground, not text-pm-or — same WCAG AA fix as
  // ENDPOINT_STATUS_CLASS.paused above (pm-or text on a light tint is
  // ~2.7:1, under the 4.5:1 minimum for normal text).
  retrying: "bg-pm-or/15 text-foreground",
  pending: "bg-pm-gris-2/60 text-pm-gris",
  processing: "bg-pm-gris-2/60 text-pm-gris",
  skipped: "bg-pm-gris-2/60 text-pm-gris",
};
