/**
 * Pure message-content helpers — deliberately split out of
 * lib/chat/messages.ts (which imports `db` at module scope, so even
 * importing just a constant from it drags in a live Postgres connection
 * requirement). lib/chat/validation.ts imports from here, not from
 * messages.ts, so Zod schema validation stays testable with zero DB
 * dependency. lib/chat/messages.ts re-exports these for its own callers.
 */

/** Hard cap enforced BEFORE insert, never only at the DB layer — matches
 * §14's "taille maximale des messages" requirement. Generous enough for a
 * real support message, small enough that a single message can never
 * become a meaningful cost/abuse vector once a real AI provider is
 * wired up in Phase 2. */
export const MAX_MESSAGE_LENGTH = 4000;

const MAX_METADATA_KEYS = 5;
const MAX_METADATA_VALUE_LENGTH = 200;
// Same discipline as lib/product-events.ts's own forbidden-key pattern —
// a message's metadata is small structured UI state (e.g. which
// suggested question was clicked), never anything resembling a secret.
const FORBIDDEN_METADATA_KEY_PATTERN = /token|secret|password|auth|cookie|refresh|header|credential|api[-_]?key/i;

export function sanitizeMessageContent(content: string): string {
  return content.trim().slice(0, MAX_MESSAGE_LENGTH);
}

export function sanitizeMessageMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, string | number | boolean> | null {
  if (!metadata) return null;
  const clean: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (count >= MAX_METADATA_KEYS) break;
    if (FORBIDDEN_METADATA_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string") {
      clean[key] = value.slice(0, MAX_METADATA_VALUE_LENGTH);
      count += 1;
    } else if (typeof value === "number" || typeof value === "boolean") {
      clean[key] = value;
      count += 1;
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}
