import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, CHAT_SENDER_TYPES } from "@/db/schema";
import { MAX_MESSAGE_LENGTH, sanitizeMessageContent, sanitizeMessageMetadata } from "@/lib/chat/message-sanitization";

export type ChatSenderType = (typeof CHAT_SENDER_TYPES)[number];
export type ChatMessageRow = typeof chatMessages.$inferSelect;

// Re-exported for existing callers (route.ts, tests) — the actual
// implementation lives in lib/chat/message-sanitization.ts, which has no
// `db` dependency, so Zod validation (lib/chat/validation.ts) can import
// MAX_MESSAGE_LENGTH from there directly without pulling in a live
// Postgres connection requirement.
export { MAX_MESSAGE_LENGTH, sanitizeMessageContent, sanitizeMessageMetadata };

export async function appendMessage(
  conversationId: string,
  senderType: ChatSenderType,
  content: string,
  metadata?: Record<string, unknown> | null,
): Promise<ChatMessageRow> {
  const [row] = await db
    .insert(chatMessages)
    .values({
      conversationId,
      senderType,
      content: sanitizeMessageContent(content),
      metadata: sanitizeMessageMetadata(metadata ?? null),
    })
    .returning();
  return row;
}

/** Full history, oldest first — for rendering the widget's transcript on
 * resume-after-refresh (§14/§23). */
export async function getConversationMessages(conversationId: string): Promise<ChatMessageRow[]> {
  return db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(asc(chatMessages.createdAt));
}

/**
 * Trimming strategy for what actually gets handed to the AI provider
 * (§11 "ne pas envoyer systématiquement tout l'historique") — the most
 * recent N messages only, oldest-first once re-ordered for the caller.
 * The mock provider (Phase 1) doesn't need this at all (it only looks at
 * the latest user message), but the provider abstraction is shaped so a
 * real provider can receive this same bounded window in Phase 2 without
 * any change to how messages are stored or fetched here.
 */
export async function getRecentMessagesForProvider(conversationId: string, limit = 12): Promise<ChatMessageRow[]> {
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(desc(chatMessages.createdAt)).limit(limit);
  return rows.reverse();
}
