import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { chatConversations, CHAT_CONVERSATION_STATUSES } from "@/db/schema";
import type { ChatContext } from "@/lib/chat/context";

export type ChatConversationStatus = (typeof CHAT_CONVERSATION_STATUSES)[number];

export type ChatConversationRow = typeof chatConversations.$inferSelect;

/**
 * Ownership check — the ONLY place that decides whether a given
 * ChatContext may read/write a given conversation row. Mirrors the
 * isolation model already audited for Google Ads (organizationId as the
 * boundary, never a client-supplied id trusted on its own): an
 * authenticated actor must match BOTH organizationId AND userId (a
 * conversation is one user's own chat, not shared across an
 * organization's other members — same granularity as product_events'
 * own per-user activity feed), an anonymous actor must match visitorId
 * exactly. A mismatch on either side is a hard "no" — never partial
 * access.
 */
function ownsConversation(conversation: ChatConversationRow, context: ChatContext): boolean {
  if (context.kind === "authenticated") {
    return conversation.organizationId === context.organizationId && conversation.userId === context.userId;
  }
  return conversation.visitorId === context.visitorId;
}

/**
 * Resolves the conversation for this request: reuses an existing one only
 * if `requestedConversationId` is both a real row AND owned by this exact
 * context (see ownsConversation above) — a mismatched or forged id is
 * never surfaced as an error (which would confirm/deny another actor's
 * conversation exists) and never granted access; it's silently treated
 * as "no conversation yet," and a brand-new one is created instead. This
 * is the single enforcement point behind "B ne peut jamais voir/injecter
 * l'id de conversation de A."
 */
export async function getOrCreateConversation(context: ChatContext, requestedConversationId?: string | null): Promise<ChatConversationRow> {
  if (requestedConversationId) {
    const [existing] = await db.select().from(chatConversations).where(eq(chatConversations.id, requestedConversationId)).limit(1);
    if (existing && ownsConversation(existing, context)) {
      return existing;
    }
  }

  const [created] = await db
    .insert(chatConversations)
    .values(
      context.kind === "authenticated"
        ? { organizationId: context.organizationId, userId: context.userId, visitorId: null, locale: context.locale, status: "AI_HANDLED" }
        : { organizationId: null, userId: null, visitorId: context.visitorId, locale: context.locale, status: "AI_HANDLED" },
    )
    .returning();

  return created;
}

/** Read-only fetch used by the API route to re-verify ownership before
 * every write on an existing conversationId — never trusts that a prior
 * getOrCreateConversation() call in the same request is still valid
 * (defense in depth, negligible cost, same discipline as
 * selectGoogleAdsAccount() re-verifying discovery on every call). */
export async function getOwnedConversation(context: ChatContext, conversationId: string): Promise<ChatConversationRow | null> {
  const [row] = await db.select().from(chatConversations).where(eq(chatConversations.id, conversationId)).limit(1);
  if (!row || !ownsConversation(row, context)) return null;
  return row;
}

export async function setConversationStatus(conversationId: string, status: ChatConversationStatus): Promise<void> {
  await db.update(chatConversations).set({ status, updatedAt: new Date() }).where(eq(chatConversations.id, conversationId));
}

export async function closeConversation(conversationId: string): Promise<void> {
  await db
    .update(chatConversations)
    .set({ status: "CLOSED", closedAt: new Date(), updatedAt: new Date() })
    .where(eq(chatConversations.id, conversationId));
}

/** Called once a lead form is submitted successfully — links the
 * conversation to the crmClients row created/reused by lib/chat/leads.ts.
 * Idempotent by construction: only ever sets crmClientId while it's still
 * null, so a retried submission never overwrites an already-linked
 * conversation with a different client row. */
export async function attachLeadToConversation(conversationId: string, crmClientId: string): Promise<void> {
  await db
    .update(chatConversations)
    .set({ crmClientId, updatedAt: new Date() })
    .where(and(eq(chatConversations.id, conversationId), isNull(chatConversations.crmClientId)));
}
