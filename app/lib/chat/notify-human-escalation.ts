import "server-only";
import { getInternalOrganizationId, notify } from "@/lib/notifications";
import { sendChatNotificationEmail } from "@/lib/email/chat-notification";

/**
 * The single trigger point for "a human at PUBLIC-MAP should know about
 * this" — requested explicitly as `notifyHumanEscalation(event)`. Fans
 * out to whichever destinations are actually configured today:
 *   - in-app (lib/notifications.ts's notify(), routed to the is_internal
 *     organization — unchanged, reuses the existing "chat.human_requested"
 *     / "chat.lead_captured" templates)
 *   - email (lib/email/chat-notification.ts, via the single Resend
 *     wrapper — no-ops cleanly if CHAT_NOTIFICATION_EMAIL/RESEND_API_KEY
 *     aren't configured)
 *
 * Deliberately NOT wired to any other destination — these are documented
 * future extension points, not implemented ones, per explicit
 * instruction not to bolt on a provider that isn't actually configured:
 *   - CRM: would push a structured note/task onto the linked crmClients
 *     row (see lib/chat/leads.ts) once a real workflow needs it beyond
 *     the free-text `notes` field already written by captureLead().
 *   - SMS / WhatsApp: no provider configured (Twilio, WhatsApp Business
 *     API, etc.) — do not add one speculatively; needs a real account,
 *     a real sender number, and an explicit decision, none of which
 *     exist yet.
 *   - webhook / n8n: lib/integrations/* is a separate, customer-facing
 *     signed-webhook system for PUBLIC-MAP's own API platform users —
 *     not reused here (see lib/chat/event-catalog.ts's header comment
 *     for why). A future internal n8n hook would be a new, small sender
 *     using the event names already reserved there.
 *
 * Caller decides WHETHER to call this at all (deduplication — "one
 * notification per conversation while its state hasn't changed" — lives
 * at the call site, which already has the conversation row in hand; see
 * app/api/chat/route.ts and lib/chat/escalation.ts). Never throws: this
 * is a best-effort side effect of a state change that has already
 * happened, exactly like notify() itself.
 */
export type HumanEscalationEvent = {
  trigger: "lead_captured" | "human_requested";
  conversationId: string;
  surface: "app" | "site" | undefined;
  locale: "fr" | "en";
  organizationName?: string | null;
  actorName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  summary?: string;
  crmClientId?: string | null;
  // §Phase 1D — passthrough only, straight to the email row builder;
  // never used for any routing/trust decision here.
  requestType?: string;
  preferredDate?: string;
  preferredTimeSlot?: string;
};

export async function notifyHumanEscalation(event: HumanEscalationEvent): Promise<void> {
  const internalOrgId = await getInternalOrganizationId();
  if (internalOrgId) {
    if (event.trigger === "lead_captured") {
      await notify({
        organizationId: internalOrgId,
        type: "chat.lead_captured",
        metadata: { fullName: event.fullName ?? "", conversationId: event.conversationId },
      });
    } else {
      await notify({
        organizationId: internalOrgId,
        type: "chat.human_requested",
        metadata: {
          conversationId: event.conversationId,
          actorName: event.actorName ?? "Visiteur anonyme",
          organizationName: event.organizationName ?? null,
          summary: event.summary?.slice(0, 300) ?? "",
        },
      });
    }
  } else {
    console.warn("[chat] Aucune organisation interne configurée — notification d'escalade non créée.");
  }

  // sendChatNotificationEmail() never throws on a Resend-level rejection
  // (it returns {sent:false, reason} by design, same as sendEmail()
  // itself) — this call's result was previously awaited and then
  // discarded entirely, so a real rejection (bad recipient, unverified
  // domain, etc.) produced zero trace anywhere: the try/catch below only
  // ever catches a genuinely thrown/unexpected error, a different and
  // much rarer case. Found while diagnosing a report of chat-notification
  // emails never arriving — logging only the failure path here.
  try {
    const emailResult = await sendChatNotificationEmail({
      kind: event.trigger,
      conversationId: event.conversationId,
      surface: event.surface,
      locale: event.locale,
      fullName: event.fullName,
      email: event.email,
      phone: event.phone,
      organizationName: event.organizationName,
      summary: event.summary,
      crmClientId: event.crmClientId,
      requestType: event.requestType,
      preferredDate: event.preferredDate,
      preferredTimeSlot: event.preferredTimeSlot,
    });
    if (!emailResult.sent) {
      console.error(`[chat] Notification lead non envoyée — reason=${emailResult.reason}`);
    }
  } catch {
    // A broken email channel must never surface as a failed lead/escalation.
    console.error("[chat] Échec de l'envoi de l'e-mail de notification (non bloquant).");
  }
}
