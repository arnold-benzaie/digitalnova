/**
 * Best-effort client IP from standard proxy headers. Split out of
 * rate-limit.ts (which has `import "server-only"`, blocking it from being
 * imported in a plain test/script context) — this function touches no
 * secrets and doesn't need that guard, so it's both testable and more
 * honestly scoped on its own.
 */
export function clientIpFromHeaders(hdrs: Headers): string {
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
}
