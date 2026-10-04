/**
 * Shared, secret-free error categorization — the same discipline already
 * established by lib/chat/technical-alert.ts's categorizeChatError() and
 * lib/db-transient-error.ts's classifyDbError(), generalized to the one
 * new consumer that needs it (lib/api-v1/response.ts's handleApiError,
 * for the "not an ApiError" branch) plus lib/ui-errors.ts. Never echoes
 * the raw error message/stack — only ever one of the fixed labels below,
 * re-derived from a small set of safe, known-shape signals (error
 * constructor name, a short allowlist of message substrings). Anything
 * that doesn't match falls back to "unknown" — never a guess, never the
 * original text.
 */
import { isTransientDbConnectionError } from "@/lib/db-transient-error";

export const GENERIC_ERROR_CATEGORIES = ["db_connection", "timeout", "validation", "not_found", "unknown"] as const;
export type GenericErrorCategory = (typeof GENERIC_ERROR_CATEGORIES)[number];

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/**
 * The ONLY function in this module that writes anywhere a caller's raw
 * value — and only to decide a category, never into the returned value.
 */
export function categorizeGenericError(err: unknown): GenericErrorCategory {
  if (isTransientDbConnectionError(err)) return "db_connection";
  const message = messageOf(err);
  if (/timeout/i.test(message)) return "timeout";
  if (/validation|invalid|required/i.test(message)) return "validation";
  if (/not found|not_found/i.test(message)) return "not_found";
  return "unknown";
}
