import "server-only";
import { setConversationStatus } from "@/lib/chat/conversations";
import type { ChatConversationRow } from "@/lib/chat/conversations";
import { notifyHumanEscalation } from "@/lib/chat/notify-human-escalation";
import type { ChatContext } from "@/lib/chat/context";

/**
 * Human escalation: sets the conversation's status to NEEDS_HUMAN and
 * raises a notification (in-app + email — see notify-human-escalation.ts)
 * for PUBLIC-MAP staff. Deliberately does NOT create a support ticket
 * automatically (the `tickets` table requires an already-qualified
 * `crmClients` row and a real staff workflow around it) — that's an
 * explicit, documented Phase-2+ candidate, not built here.
 *
 * Dedup ("one human_requested notification per conversation while its
 * state hasn't changed"): takes the already-fetched conversation row
 * (its caller, app/api/chat/route.ts, already has it via
 * getOwnedConversation — no extra read) and skips the notification
 * entirely when the conversation is already NEEDS_HUMAN. The status
 * update itself still runs unconditionally — cheap and idempotent, and
 * correct even if some future caller reaches this from a different
 * prior status.
 */
export async function escalateToHuman(context: ChatContext, conversation: Pick<ChatConversationRow, "id" | "status">, surface: "app" | "site" | undefined, requestSummary: string): Promise<void> {
  const alreadyEscalated = conversation.status === "NEEDS_HUMAN";
  await setConversationStatus(conversation.id, "NEEDS_HUMAN");
  if (alreadyEscalated) return;

  const actor =
    context.kind === "authenticated"
      ? { name: context.firstName ?? context.organizationName, organizationName: context.organizationName }
      : { name: "Visiteur anonyme", organizationName: null };

  await notifyHumanEscalation({
    trigger: "human_requested",
    conversationId: conversation.id,
    surface,
    locale: context.locale,
    actorName: actor.name,
    organizationName: actor.organizationName,
    summary: requestSummary,
  });
}
