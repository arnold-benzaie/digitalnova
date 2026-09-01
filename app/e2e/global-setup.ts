/**
 * Runs once before the whole suite. Hard-fails the entire run (not a single
 * test) if the target isn't unambiguously the local PUBLIC-MAP Audit test
 * database — reuses db/guard-main-production.ts rather than a second,
 * parallel safety check, then confirms this is genuinely the Audit schema
 * (not just "some other local Postgres on 5433").
 */
import { E2E_AUDIT_DATABASE_URL, auditDb } from "./helpers/audit-db";
import { assertE2EDatabaseTargets } from "./helpers/e2e-db-targets";
import { assertNotMainProductionDatabase } from "../db/guard-main-production";
import { auditRateLimitHits } from "../db/audit-schema";
import { like, sql } from "drizzle-orm";

export default async function globalSetup() {
  // db/audit-index.ts already ran this once at import time (via
  // helpers/audit-db.ts) — re-run it here explicitly too, so the failure
  // reason is unmistakable in the global-setup log rather than buried in a
  // module-import stack trace.
  assertNotMainProductionDatabase(E2E_AUDIT_DATABASE_URL, "E2E_AUDIT_DATABASE_URL");

  const [{ current_database: dbName }] = (await auditDb.execute(sql`select current_database()`)).rows as { current_database: string }[];
  if (dbName !== "public_map_audit_test") {
    throw new Error(
      `Cible DB inattendue : "${dbName}" (attendu "public_map_audit_test"). ` +
        "Le conteneur Docker local a-t-il été renommé/recréé ? Arrêt avant toute écriture E2E.",
    );
  }

  const tables = (
    await auditDb.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('gbp_audits', 'audit_prospects', 'audit_businesses', 'gbp_audit_settings')`,
    )
  ).rows as { table_name: string }[];
  if (tables.length !== 4) {
    throw new Error(
      `Schéma Audit incomplet sur "${dbName}" (${tables.length}/4 tables clés trouvées). ` +
        "Migrations non appliquées ? Lancer `npm run audit:db:migrate` + `npm run audit:db:post-migrate-setup` contre ce conteneur d'abord.",
    );
  }

  // /api/gbp-audit/e2e-db-target is a public route (its own NODE_ENV/VERCEL
  // guard, not Clerk) — reachable with no session, so it doubles as both the
  // "server responds" check and the "server points at the right database"
  // check. A plain fetch of an authenticated page here would just redirect
  // to /sign-in and "succeed" with the wrong content, hiding a dead server.
  const dbTargetRes = await fetch("http://localhost:3600/api/gbp-audit/e2e-db-target").catch(() => null);
  if (!dbTargetRes) {
    throw new Error(
      "Le serveur E2E (http://localhost:3600) ne répond pas. Lancer `npm run build:e2e` puis `npm run start:e2e` avec DATABASE_URL et AUDIT_DATABASE_URL sur les bases Docker locales — voir e2e/README.md.",
    );
  }
  const dbTargets = dbTargetRes.ok
    ? ((await dbTargetRes.json()) as { database?: string; auditDatabase?: string; mainDatabase?: string })
    : {};
  const dbTarget = dbTargets.auditDatabase ?? dbTargets.database ?? null;
  if (dbTarget !== "public_map_audit_test") {
    throw new Error(
      `Le serveur E2E n'est pas connecté à la base de test locale (cible détectée : "${dbTarget ?? "indéterminée"}", attendu "public_map_audit_test"). ` +
        "Il pointe probablement vers le vrai projet Supabase Audit — voir e2e/README.md pour la commande de démarrage exacte.",
    );
  }
  // T-1.4-B-B — the running server's LIVE main + Audit database names, from
  // its own `select current_database()` on BOTH connections. Fails the whole
  // run here, before any test, if the server's main connection is not the
  // local Docker main test DB — the audit-only check above never covered
  // that, so a server started without sourcing .env.e2e.local could run the
  // whole CRM suite's writes against an ambient main target.
  assertE2EDatabaseTargets({
    mainDatabase: dbTargets.mainDatabase,
    auditDatabase: dbTargets.auditDatabase ?? dbTargets.database,
  });

  const authFile = await import("node:fs").then((fs) => fs.existsSync("playwright/.auth/local-admin.json")).catch(() => false);
  if (!authFile) {
    throw new Error("playwright/.auth/local-admin.json introuvable. Lancer `node e2e/auth-setup.mjs` (serveur E2E déjà démarré) avant la suite.");
  }

  // The public portal actions (resolveReportByToken, submitPortalQuoteRequest)
  // are rate-limited per IP (see lib/gbp-audit/rate-limit.ts). Every local
  // suite run hits them from the same loopback address, so counts accumulate
  // run over run within the same hour and can eventually fail full-lifecycle
  // for reasons that have nothing to do with the code under test. Safe to
  // reset unconditionally here — this only ever runs against
  // "public_map_audit_test", already verified above.
  await auditDb.delete(auditRateLimitHits).where(like(auditRateLimitHits.key, "portal_%"));

  console.log(`[e2e/global-setup] Cible confirmée : base "${dbName}" sur localhost:5433, schéma Audit présent, serveur E2E prêt.`);
}
