import { sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";

/**
 * Local-E2E-only introspection endpoint: reveals which database the
 * ALREADY-RUNNING E2E server's own auditDb connection actually points at.
 * e2e/global-setup.ts calls this before running any test to confirm the
 * server was started with AUDIT_DATABASE_URL overridden to the local Docker
 * test database — the server and the Playwright test harness each resolve
 * AUDIT_DATABASE_URL independently (see e2e/helpers/env.ts), so nothing
 * previously caught the case where they silently point at two different
 * databases. Listed in proxy.ts's isPublicRoute (no Clerk session exists yet
 * when global-setup runs) — safe because the check below refuses anything
 * that is not genuine local `next dev`, OR the T-1.4-A Plan B local
 * production-mode E2E server (PUBLIC_MAP_E2E=1, set only by the `build:e2e` /
 * `start:e2e` npm scripts). `process.env.VERCEL` still forces 404, so the
 * endpoint can never exist on any Vercel deployment.
 */
export async function GET() {
  if (
    (process.env.NODE_ENV !== "development" && process.env.PUBLIC_MAP_E2E !== "1") ||
    process.env.VERCEL
  ) {
    return new Response("Not found.", { status: 404 });
  }

  const [{ current_database: database }] = (await auditDb.execute(sql`select current_database()`))
    .rows as { current_database: string }[];

  return Response.json({ database });
}
