import type { Locale } from "@/lib/i18n/dictionaries";

export type ChatApiSuggestion = { id: string };
export type ChatApiAction = { type: "show_lead_form" } | { type: "human_escalation_confirmed" } | null;

export type ChatApiResponse = {
  conversationId: string;
  reply: string;
  suggestions: ChatApiSuggestion[];
  action: ChatApiAction;
  /** The actual language `reply` (and this turn's suggestions) are in —
   * present on "message" responses from a real LLM provider; absent on
   * lead_submit/escalate responses, which don't need it. */
  language?: Locale;
};

export type ChatApiErrorKind = "invalid_request" | "rate_limited" | "provider_unavailable" | "network" | "unknown";

export class ChatApiError extends Error {
  kind: ChatApiErrorKind;
  constructor(kind: ChatApiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Same-origin today; `credentials: "include"` is forward-compatible
 * with the future cross-origin public-map.com embed (Phase 1B, not yet
 * wired) without needing any change here. */
async function postChat(body: Record<string, unknown>): Promise<ChatApiResponse> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    throw new ChatApiError("network", "network error");
  }

  if (res.status === 429) throw new ChatApiError("rate_limited", "rate limited");
  if (res.status === 400) throw new ChatApiError("invalid_request", "invalid request");
  if (!res.ok) throw new ChatApiError("provider_unavailable", `unexpected status ${res.status}`);

  const data = (await res.json()) as ChatApiResponse | { error: string };
  if ("error" in data) throw new ChatApiError("unknown", data.error);
  return data;
}

export function sendChatMessage(input: { content: string; locale: Locale; conversationId?: string | null; suggestionId?: string }): Promise<ChatApiResponse> {
  return postChat({ type: "message", content: input.content, locale: input.locale, conversationId: input.conversationId ?? undefined, suggestionId: input.suggestionId });
}

export function submitChatLead(input: {
  /** Optional (was required): the calendar/booking button (§Phase 1D)
   * can open the form before any message has been sent — omitted/null
   * means "let the backend create one", exactly like sendChatMessage. */
  conversationId?: string | null;
  locale: Locale;
  fullName: string;
  email: string;
  phone?: string;
  company?: string;
  country?: string;
  requestType: string;
  preferredDate?: string;
  preferredTimeSlot?: string;
  message: string;
  consent: true;
  /** Which embed sent this — labels the internal lead-notification email
   * (§7). Optional: the backend defaults to "app" when absent, matching
   * sendMessageSchema's own convention. */
  surface?: "app" | "site";
}): Promise<ChatApiResponse> {
  return postChat({ type: "lead_submit", ...input, conversationId: input.conversationId ?? undefined });
}

export function escalateChatConversation(input: { conversationId: string; locale: Locale }): Promise<ChatApiResponse> {
  return postChat({ type: "escalate", ...input });
}
