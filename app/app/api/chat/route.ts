import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { getAiProvider } from "@/lib/chat/ai-provider";
import type { ChatContext } from "@/lib/chat/context";
import { resolveChatContext } from "@/lib/chat/context";
import { attachLeadToConversation, getOrCreateConversation, getOwnedConversation, setConversationStatus } from "@/lib/chat/conversations";
import { escalateToHuman } from "@/lib/chat/escalation";
import { captureLead } from "@/lib/chat/leads";
import { appendMessage, appendUserMessage, getRecentMessagesForProvider } from "@/lib/chat/messages";
import { notifyHumanEscalation } from "@/lib/chat/notify-human-escalation";
import { categorizeChatError, recordChatFailureAndMaybeAlert } from "@/lib/chat/technical-alert";
import { chatRequestSchema, escalateSchema, leadSubmitSchema, sendMessageSchema } from "@/lib/chat/validation";
import { generateVisitorId, isValidVisitorId, VISITOR_ID_COOKIE, visitorIdCookieOptions } from "@/lib/chat/visitor";
import { clientIpFromHeaders } from "@/lib/gbp-audit/client-ip";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";
import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * PUBLIC-MAP AI Assistant — the single server-side entry point for the
 * chat widget (§7/§14 of the approved plan). A real REST route on
 * purpose, not a Server Action: this must remain callable cross-origin
 * from https://www.public-map.com once Phase 1B is authorized (a Server
 * Action's invocation protocol is same-origin only). Never calls an AI
 * provider directly from the browser — see lib/ai/provider.ts.
 *
 * CORS: explicit allowlist, never "*", never trusts the Origin header as
 * an authorization mechanism (it only controls whether the BROWSER lets
 * client JS read the response — an attacker can always send Origin
 * cross-allowlist directly; what actually protects authenticated data is
 * the server-side session check in lib/chat/context.ts, exactly as for
 * every other route in this app). Same-origin requests from the Next.js
 * app itself (the sign-in/dashboard/admin surfaces this route already
 * serves today) never need an Origin header at all and work regardless.
 */
const ALLOWED_ORIGINS = new Set([
  "https://app.public-map.com",
  // Production targets — NOT live yet (this code has never been deployed
  // to Production); kept listed since Phase 1A so the eventual Production
  // cutover needs no further change here.
  "https://www.public-map.com",
  "https://public-map.com",
  "http://localhost:3000",
  // Phase 1B — Preview-only, the static site's own branch-alias origin
  // for preview/ai-assistant-widget (digitalnova project). Never added
  // to any Production allowlist — see the Phase 1B report for the exact
  // separate step required before that.
  "https://digitalnova-git-preview-ai-assi-a480b1-arnold-benzaies-projects.vercel.app",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

const RATE_LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  message: { limit: 30, windowSeconds: 300 },
  lead_submit: { limit: 5, windowSeconds: 3600 },
  escalate: { limit: 5, windowSeconds: 3600 },
};

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers });
  }

  const parsed = chatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    // z.treeifyError-style detail is dev-useful but never echoes the raw
    // input back — only field paths/issue codes, never a value that
    // could itself be attacker-supplied text reflected into a response.
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })) }, { status: 400, headers });
  }
  const body = parsed.data;

  const cookieVisitorId = request.cookies.get(VISITOR_ID_COOKIE)?.value;
  const visitorId = isValidVisitorId(cookieVisitorId) ? cookieVisitorId : isValidVisitorId(body.visitorId) ? body.visitorId : generateVisitorId();

  const context = await resolveChatContext(body.locale, visitorId);

  const identifier = context.kind === "authenticated" ? context.userId : `visitor:${context.visitorId}:${clientIpFromHeaders(request.headers)}`;
  const rateLimitConfig = RATE_LIMITS[body.type];
  const rateLimit = await checkRateLimit(`chat_${body.type}`, identifier, rateLimitConfig.limit, rateLimitConfig.windowSeconds);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }

  try {
    const response =
      body.type === "message"
        ? await handleMessage(context, body)
        : body.type === "lead_submit"
          ? await handleLeadSubmit(context, body)
          : await handleEscalate(context, body);

    const res = NextResponse.json(response, { status: 200, headers });
    if (cookieVisitorId !== visitorId) {
      res.cookies.set(VISITOR_ID_COOKIE, visitorId, visitorIdCookieOptions());
    }
    return res;
  } catch (err) {
    // Never the raw error message in the response — see lib/ai/mock-provider.ts's
    // simulated-error path, which this branch is also what catches.
    console.error(`[chat] Échec de traitement (type: ${body.type})`, err instanceof Error ? err.message : "unknown error");
    if (body.type === "message") {
      // Awaited (not fire-and-forget): a serverless function isn't
      // guaranteed to keep running background work after its response is
      // sent, so this must complete before the 502 goes out. Never throws
      // itself (own try/catch inside — see technical-alert.ts), so this
      // only adds the cost of one INSERT + one SELECT (and, rarely, one
      // email send) to an already-failing request. Only a "message"
      // failure counts toward the technical-alert threshold; lead_submit/
      // escalate failures are deterministic-code failures, not AI-
      // provider ones.
      await recordChatFailureAndMaybeAlert(categorizeChatError(err), "/api/chat");
    }
    return NextResponse.json({ error: "provider_unavailable" }, { status: 502, headers });
  }
}

async function handleMessage(context: ChatContext, body: z.infer<typeof sendMessageSchema>) {
  const conversation = await getOrCreateConversation(context, body.conversationId);
  // appendUserMessage (not appendMessage): absorbs an exact-content Retry
  // (or an accidental network-level double-submit) on the same
  // conversationId within a short window instead of persisting a second
  // identical row — see lib/chat/messages.ts.
  await appendUserMessage(conversation.id, context.kind === "authenticated" ? "client" : "visitor", body.content, body.suggestionId ? { suggestionId: body.suggestionId } : null);

  const history = await getRecentMessagesForProvider(conversation.id);
  const provider = await getAiProvider();
  const result = await provider.generateReply({ locale: body.locale, userMessage: body.content, history, context, surface: body.surface });

  await appendMessage(conversation.id, "assistant", result.reply);

  return {
    conversationId: conversation.id,
    reply: result.reply,
    suggestions: result.suggestions ?? [],
    action: result.action ?? null,
    // Real providers compute this deterministically (see
    // lib/chat/conversation-language.ts); the mock provider doesn't set
    // it, so this falls back to the interface locale the client already
    // sent — exactly the mock's own existing behavior, unaffected.
    language: result.language ?? body.locale,
  };
}

async function handleLeadSubmit(context: ChatContext, body: z.infer<typeof leadSubmitSchema>) {
  const conversation = await getOwnedConversation(context, body.conversationId);
  if (!conversation) {
    return { error: "conversation_not_found" };
  }

  // Captured BEFORE attaching — the anti-spam guard (§8): a conversation
  // already linked to a CRM client means a notification already went out
  // for it once; a resubmit (double-click, retry, or the same prospect
  // filling the form again) must never send a second one. captureLead's
  // own email-based dedup still runs regardless (it just updates the
  // same crmClients row rather than creating a new one).
  const alreadyLinked = conversation.crmClientId !== null;

  const { crmClientId } = await captureLead(context, {
    fullName: body.fullName,
    email: body.email,
    phone: body.phone ?? null,
    company: body.company ?? null,
    country: body.country ?? null,
    message: body.message,
  });

  await attachLeadToConversation(conversation.id, crmClientId);
  // Every lead submitted through the widget means the AI could not fully
  // resolve the request on its own — mark the conversation as needing a
  // human follow-up too (no separate notification for this state change;
  // the notification below already tells staff a real person is waiting).
  await setConversationStatus(conversation.id, "NEEDS_HUMAN");

  if (!alreadyLinked) {
    await notifyHumanEscalation({
      trigger: "lead_captured",
      conversationId: conversation.id,
      surface: body.surface,
      locale: body.locale,
      fullName: body.fullName,
      email: body.email,
      phone: body.phone,
      organizationName: body.company,
      summary: body.message,
      crmClientId,
    });
  }

  const confirmationReply = dictionaries[body.locale].chat.leadForm.confirmation;
  await appendMessage(conversation.id, "assistant", confirmationReply);

  return { conversationId: conversation.id, reply: confirmationReply, suggestions: [], action: null };
}

async function handleEscalate(context: ChatContext, body: z.infer<typeof escalateSchema>) {
  const conversation = await getOwnedConversation(context, body.conversationId);
  if (!conversation) {
    return { error: "conversation_not_found" };
  }

  await escalateToHuman(context, conversation, undefined, "Demande d'assistance humaine depuis le widget de chat.");

  const confirmationReply = dictionaries[body.locale].chat.escalation.confirmation;
  await appendMessage(conversation.id, "assistant", confirmationReply);

  return { conversationId: conversation.id, reply: confirmationReply, suggestions: [], action: null };
}
