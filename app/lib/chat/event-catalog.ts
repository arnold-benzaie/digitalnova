/**
 * Documentary catalog of chat-related event names for a FUTURE n8n/
 * webhook integration — reserves the vocabulary so later work has a
 * single, already-agreed source of names instead of inventing them ad
 * hoc. Deliberately NOT wired to anything: no dispatch, no HTTP call, no
 * new workflow. lib/integrations/* (enqueueIntegrationEvent, the signed
 * webhook outbox) is a separate, customer-facing system for PUBLIC-MAP's
 * own API platform users' own webhooks — it is not reused here, since
 * routing internal chat events through it would broadcast them to
 * third-party API webhook endpoints, which is not what this is for.
 *
 * Today, only two of these actually fire (as in-app notifications + the
 * commercial email, see notify-human-escalation.ts): "chat.lead_captured"
 * (lead form submitted) and "chat.human_requested" (explicit advisor
 * request, including the one offered after repeated failures). The
 * widget's structured-reply contract doesn't yet distinguish a "quote"
 * request from a general advisor request or a callback request — they
 * all funnel through the same lead form today — so
 * "chat.quote_requested"/"chat.callback_requested" are reserved names for
 * once that distinction exists, not currently-firing events.
 * "chat.repeated_failure" is reserved for the technical-alert path (see
 * lib/chat/technical-alert.ts), which today only sends an internal email,
 * never a webhook.
 */
export const CHAT_EVENT_TYPES = [
  "chat.human_requested",
  "chat.lead_captured",
  "chat.quote_requested",
  "chat.callback_requested",
  "chat.repeated_failure",
] as const;

export type ChatEventType = (typeof CHAT_EVENT_TYPES)[number];
