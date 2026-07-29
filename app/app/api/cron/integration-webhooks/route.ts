import { createHash, timingSafeEqual } from "node:crypto";
import { runIntegrationWebhookWorker } from "@/lib/integrations/worker";

function authorized(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${expected}`, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

/**
 * Internal worker entrypoint. It is not part of the future public /api/v1.
 *
 * Scheduled in vercel.json (Stage 5 of the developer-ecosystem plan —
 * previously present in this route but NOT in vercel.json, so it never
 * actually ran outside manual/test invocation and the "Tests" admin
 * page's triggerWorkerNowAction). Runs every 5 minutes: with
 * WEBHOOK_ATTEMPT_DELAYS_MS's first retry at 30s and the shortest
 * meaningful cadence, once/day (the only other cron in this file) would
 * make retries and even first-attempt delivery effectively useless.
 * Assumes a Vercel plan that supports sub-daily cron schedules (Pro or
 * higher) — Hobby restricts crons to once per day; if this project is on
 * Hobby, this schedule silently only guarantees a daily run, and that
 * constraint should be confirmed before deploying this change.
 *
 * Before this schedule is ever deployed, re-run the backlog check this
 * entry's activation was gated on (see the Stage 5 report) against the
 * REAL target database — a cron that has never run before may have
 * accumulated a real backlog of due integration_events/webhook_deliveries
 * that would all fire in the same first invocation.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return new Response("Worker not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runIntegrationWebhookWorker();
  return Response.json(result);
}
