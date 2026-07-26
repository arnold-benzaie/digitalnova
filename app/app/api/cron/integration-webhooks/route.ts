import { createHash, timingSafeEqual } from "node:crypto";
import { runIntegrationWebhookWorker } from "@/lib/integrations/worker";

function authorized(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${expected}`, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

/** Internal worker entrypoint. It is not part of the future public /api/v1. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return new Response("Worker not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runIntegrationWebhookWorker();
  return Response.json(result);
}
