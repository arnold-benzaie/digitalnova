import { runDatabaseHealthCheck } from "@/lib/system-health";
import { checkCronAuth } from "@/lib/cron-auth";

/**
 * Vercel Cron target (see vercel.json). Same fail-closed CRON_SECRET /
 * Bearer-header check as the other two cron routes (reports,
 * integration-webhooks) — already excluded from Clerk auth by proxy.ts's
 * /api/cron(.*) matcher, so placing this route under /api/cron/* is what
 * makes it reachable by Vercel's server-to-server cron invocation without
 * a user session.
 *
 * Read-only: runs SELECT 1 + one trivial read, never a mutation. The
 * response is deliberately minimal — status/latency/timestamp only, never
 * a connection string, error stack, or any user/client data.
 */
export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const result = await runDatabaseHealthCheck();

  return Response.json({
    status: result.status,
    latencyMs: result.latencyMs,
    timestamp: result.timestamp,
  });
}
