import "server-only";
import { getInternalOrganizationId, notify } from "@/lib/notifications";
import { setConversationStatus } from "@/lib/chat/conversations";
import type { ChatContext } from "@/lib/chat/context";

/**
 * Phase 1 human escalation: sets the conversation's status to
 * NEEDS_HUMAN and raises a single in-app notification for PUBLIC-MAP
 * staff, exactly the same routing already used for "new pending user"
 * (see lib/notifications.ts's getInternalOrganizationId() — the one
 * organization flagged is_internal, never guessed). Deliberately does
 * NOT create a support ticket automatically (the `tickets` table
 * requires an already-qualified `crmClients` row and a real staff
 * workflow around it) — that's an explicit, documented Phase-2+
 * candidate, not built here per the approved plan.
 */
export async function escalateToHuman(context: ChatContext, conversationId: string, requestSummary: string): Promise<void> {
  await setConversationStatus(conversationId, "NEEDS_HUMAN");

  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    console.warn("[chat] Aucune organisation interne configurée — notification d'escalade non créée.");
    return;
  }

  const actor =
    context.kind === "authenticated"
      ? { name: context.firstName ?? context.organizationName, organizationName: context.organizationName }
      : { name: "Visiteur anonyme", organizationName: null };

  await notify({
    organizationId: internalOrgId,
    type: "chat.human_requested",
    metadata: {
      conversationId,
      actorName: actor.name,
      organizationName: actor.organizationName,
      summary: requestSummary.slice(0, 300),
    },
  });
}
