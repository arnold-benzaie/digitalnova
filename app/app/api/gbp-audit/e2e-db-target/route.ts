import { sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { db } from "@/db/index";

/**
 * Local-E2E-only introspection endpoint: reveals which databases the
 * ALREADY-RUNNING E2E server's own connections actually point at — both its
 * Audit client (auditDb, AUDIT_DATABASE_URL) and its main CRM client (db,
 * DATABASE_URL). e2e/global-setup.ts calls this before running any test to
 * confirm the server was started against the local Docker test databases:
 * the server and the Playwright test harness each resolve those env vars
 * independently (see e2e/helpers/env.ts), so nothing previously caught the
 * case where they silently point at different databases — and, before
 * T-1.4-B-B, nothing verified the server's MAIN connection at all (a server
 * started without sourcing .env.e2e.local would run the whole CRM suite's
 * writes against whatever main target was ambient).
 *
 * Listed in proxy.ts's isPublicRoute (no Clerk session exists yet when
 * global-setup runs) — safe because the guard below refuses anything that
 * is not genuine local `next dev`, OR the T-1.4-A Plan B local
 * production-mode E2E server (PUBLIC_MAP_E2E=1, set only by the `build:e2e` /
 * `start:e2e` npm scripts). `process.env.VERCEL` still forces 404, so the
 * endpoint can never exist on any Vercel deployment. Only ever performs
 * read-only `select current_database()` — no write, no DDL.
 */

// Report the running server's LIVE database targets, never a value frozen
// into the build. A GET handler with no Dynamic API is static-generation
// eligible in Next 16 — without this it could be evaluated once at
// `build:e2e` time and served stale, defeating the purpose of the check.
export const dynamic = "force-dynamic";

export async function GET() {
  if (
    (process.env.NODE_ENV !== "development" && process.env.PUBLIC_MAP_E2E !== "1") ||
    process.env.VERCEL
  ) {
    return new Response("Not found.", { status: 404 });
  }

  const [{ current_database: auditDatabase }] = (await auditDb.execute(sql`select current_database()`))
    .rows as { current_database: string }[];
  const [{ current_database: mainDatabase }] = (await db.execute(sql`select current_database()`))
    .rows as { current_database: string }[];

  // `database` is retained verbatim (=== auditDatabase) for backward
  // compatibility with playwright.config.ts's webServer readiness probe and
  // any other existing caller; `auditDatabase` / `mainDatabase` are the
  // explicit fields e2e/global-setup.ts asserts on (T-1.4-B-B).
  return Response.json(
    { database: auditDatabase, auditDatabase, mainDatabase },
    { headers: { "Cache-Control": "no-store" } },
  );
}
