/**
 * The closed set of "Type de demande" values for the booking/lead form's
 * calendar-triggered entry point (same form as the existing advisor-CTA
 * lead form — see chat-lead-form.tsx / chat-widget-embed.js's
 * renderLeadForm()). Mirrors lib/chat/suggestion-catalog.ts's own
 * pattern: one server-side source of truth for the Zod `enum` constraint,
 * with the visitor-facing FR/EN labels living in
 * lib/i18n/dictionaries/chat.ts and chat-widget-embed.js's own
 * PM_CHAT_STRINGS (never trusted from the client — the client sends a
 * key, the server validates it against REQUEST_TYPE_KEYS).
 *
 * REQUEST_TYPE_LABELS_FR is for STAFF-facing surfaces only (CRM notes,
 * the commercial notification email) — that email is already always
 * drafted in French regardless of the visitor's own language, same
 * precedent as lib/email/chat-notification.ts's COPY.fr.
 */
export const REQUEST_TYPE_KEYS = ["meeting", "quote", "advisor", "audit", "website", "other"] as const;

export type RequestTypeKey = (typeof REQUEST_TYPE_KEYS)[number];

export const REQUEST_TYPE_LABELS_FR: Record<RequestTypeKey, string> = {
  meeting: "Réserver un rendez-vous",
  quote: "Demander un devis",
  advisor: "Parler à un conseiller",
  audit: "Audit / visibilité Google",
  website: "Site web / SEO / Google Ads",
  other: "Autre",
};
