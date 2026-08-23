import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Anonymous-visitor identity for the AI Assistant widget — deliberately
 * the ONLY thing that stands in for "who is this" when no PUBLIC-MAP
 * session exists. A visitorId is a random, non-sensitive token with no
 * relationship to IP, user-agent, device signals, or any other
 * fingerprinting technique: it exists solely so a returning anonymous
 * browser can resume its own conversation, never to re-identify a real
 * person. It is never accepted as an authorization boundary for anything
 * other than "which chat_conversations rows can this browser see" — see
 * lib/chat/conversations.ts.
 */
export const VISITOR_ID_COOKIE = "pm_chat_visitor_id";
const VISITOR_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days

const VISITOR_ID_PATTERN = /^[a-f0-9]{32}$/;

export function generateVisitorId(): string {
  return randomBytes(16).toString("hex");
}

export function isValidVisitorId(value: string | undefined | null): value is string {
  return typeof value === "string" && VISITOR_ID_PATTERN.test(value);
}

/** Same convention as app/api/auth/google/connect/route.ts's STATE_COOKIE:
 * httpOnly (never read by widget JS directly — the server always echoes
 * the current visitorId back in the API response body instead), secure
 * in built/deployed environments only (so local http:// dev keeps
 * working).
 *
 * sameSite (Phase 1B correction): a cross-origin `fetch()` — the actual
 * shape of every call from the public-map.com static-site embed — never
 * carries a SameSite=Lax cookie; only SameSite=None does, and browsers
 * refuse SameSite=None without Secure. So this is None+Secure whenever
 * the connection is already secure (every real deployment), and falls
 * back to Lax locally over plain http (where None would be silently
 * rejected outright, breaking same-origin local dev for no reason — Lax
 * still works fine there since local dev is same-origin anyway). Paired
 * with app/api/chat/route.ts's own explicit origin allowlist (never "*")
 * and Access-Control-Allow-Credentials — SameSite=None alone grants no
 * origin access by itself. */
export function visitorIdCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: VISITOR_ID_MAX_AGE_SECONDS,
  };
}
