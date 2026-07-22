/**
 * Runs once before the whole suite. Hard-fails the entire run (not a single
 * test) if the target isn't unambiguously the local PUBLIC-MAP Audit test
 * database — reuses db/guard-main-production.ts rather than a second,
 * parallel safety check, then confirms this is genuinely the Audit schema
 * (not just "some other local Postgres on 5433").
 */
import { E2E_AUDIT_DATABASE_URL, auditDb } from "./helpers/audit-db";
import { assertNotMainProductionDatabase } from "../db/guard-main-production";
import { sql } from "drizzle-orm";

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

  const devServer = await fetch("http://localhost:3600/admin/audit/nouveau").catch(() => null);
  if (!devServer || !devServer.ok) {
    throw new Error(
      "Le serveur dev (http://localhost:3600) ne répond pas. Démarrer `npm run dev` (avec QA_BYPASS_AUDIT_AUTH=1) avant de lancer ce test.",
    );
  }

  console.log(`[e2e/global-setup] Cible confirmée : base "${dbName}" sur localhost:5433, schéma Audit présent, serveur dev prêt.`);
}
