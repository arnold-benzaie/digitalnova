/**
 * Runs once before the whole suite. Hard-fails the entire run (not a single
 * test) if the target isn't unambiguously the local PUBLIC-MAP Audit test
 * database — reuses db/guard-main-production.ts rather than a second,
 * parallel safety check, then confirms this is genuinely the Audit schema
 * (not just "some other local Postgres on 5433").
 */
import { E2E_AUDIT_DATABASE_URL, auditDb } from "./helpers/audit-db";
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

  const devServer = await fetch("http://localhost:3600/admin/audit/nouveau").catch(() => null);
  if (!devServer || !devServer.ok) {
    throw new Error(
      "Le serveur dev (http://localhost:3600) ne répond pas. Démarrer `npm run dev` (avec QA_BYPASS_AUDIT_AUTH=1) avant de lancer ce test.",
    );
  }

  // The dev server resolves its own AUDIT_DATABASE_URL independently of this
  // test harness (see e2e/helpers/env.ts) — nothing above proves the two
  // agree. Without this check, a server started without the Docker override
  // silently writes UI-created fixtures to the real Supabase Audit project
  // while every assertion here reads from Docker, producing confusing
  // failures (duplicated fixtures, "audit introuvable en base") deep inside
  // individual tests instead of one clear error up front.
  const dbTargetRes = await fetch("http://localhost:3600/api/gbp-audit/e2e-db-target").catch(() => null);
  const dbTarget = dbTargetRes && dbTargetRes.ok ? ((await dbTargetRes.json()) as { database: string }).database : null;
  if (dbTarget !== "public_map_audit_test") {
    throw new Error(
      `Le serveur dev n'est pas connecté à la base de test locale (cible détectée : "${dbTarget ?? "indéterminée"}", attendu "public_map_audit_test"). ` +
        "Il pointe probablement vers le vrai projet Supabase Audit — voir e2e/README.md. " +
        'Relancer avec : AUDIT_DATABASE_URL="postgresql://postgres:localtest@localhost:5433/public_map_audit_test" QA_BYPASS_AUDIT_AUTH=1 npm run dev',
    );
  }

  // The public portal actions (resolveReportByToken, submitPortalQuoteRequest)
  // are rate-limited per IP (see lib/gbp-audit/rate-limit.ts). Every local
  // suite run hits them from the same loopback address, so counts accumulate
  // run over run within the same hour and can eventually fail full-lifecycle
  // for reasons that have nothing to do with the code under test. Safe to
  // reset unconditionally here — this only ever runs against
  // "public_map_audit_test", already verified above.
  await auditDb.delete(auditRateLimitHits).where(like(auditRateLimitHits.key, "portal_%"));

  console.log(`[e2e/global-setup] Cible confirmée : base "${dbName}" sur localhost:5433, schéma Audit présent, serveur dev prêt.`);
}
