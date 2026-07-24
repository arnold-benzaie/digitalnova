import { sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";

/**
 * Dev-only introspection endpoint: reveals which database the ALREADY-RUNNING
 * dev server's own auditDb connection actually points at. e2e/global-setup.ts
 * calls this before running any test to confirm the server was started with
 * AUDIT_DATABASE_URL overridden to the local Docker test database — the
 * server and the Playwright test harness each resolve AUDIT_DATABASE_URL
 * independently (see e2e/helpers/env.ts), so nothing previously caught the
 * case where they silently point at two different databases. Listed in
 * proxy.ts's isPublicRoute (no Clerk session exists yet when global-setup
 * runs) — safe because the check below refuses anything outside genuine
 * local `next dev`, independent of the middleware.
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) {
    return new Response("Not found.", { status: 404 });
  }

  const [{ current_database: database }] = (await auditDb.execute(sql`select current_database()`))
    .rows as { current_database: string }[];

  return Response.json({ database });
}
