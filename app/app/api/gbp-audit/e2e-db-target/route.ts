import { sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";

/**
 * Dev-only introspection endpoint: reveals which database the ALREADY-RUNNING
 * dev server's own auditDb connection actually points at. e2e/global-setup.ts
 * calls this before running any test to confirm the server was started with
 * AUDIT_DATABASE_URL overridden to the local Docker test database — the
 * server and the Playwright test harness each resolve AUDIT_DATABASE_URL
 * independently (see e2e/helpers/env.ts), so nothing previously caught the
 * case where they silently point at two different databases. Reachable only
 * under proxy.ts's existing QA-bypass gate (isAuditRoute + qaBypassAllowed),
 * itself already restricted to genuine local `next dev`; the check below is
 * a second, independent guard on top of that, matching the belt-and-suspenders
 * pattern used elsewhere in this codebase (see lib/qa-bypass.ts).
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) {
    return new Response("Not found.", { status: 404 });
  }

  const [{ current_database: database }] = (await auditDb.execute(sql`select current_database()`))
    .rows as { current_database: string }[];

  return Response.json({ database });
}
