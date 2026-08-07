import { createHash, timingSafeEqual } from "node:crypto";

function timingSafeCompare(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

/**
 * Shared, fail-closed auth check for every /api/cron/* route (Vercel signs
 * cron requests with `Authorization: Bearer $CRON_SECRET`). Every failure
 * mode — CRON_SECRET unset, CRON_SECRET set to an empty string, no
 * Authorization header, or a mismatched value — returns 401. None of them
 * fall through to letting the request proceed: an unconfigured secret
 * must NEVER make a cron route effectively public. Returns the Response
 * to send immediately when unauthorized, or null when the caller may
 * proceed.
 */
export function checkCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return new Response("Unauthorized", { status: 401 });

  const auth = request.headers.get("authorization");
  if (!auth) return new Response("Unauthorized", { status: 401 });

  if (!timingSafeCompare(auth, `Bearer ${cronSecret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
