#!/usr/bin/env node
/**
 * One-off cleanup: removes every row/object created during this session's
 * live E2E testing (prefixed [TEST-E2E] / TEST-E2E), on public-map-audit
 * only. Read-only listing first, then deletes. Safe to re-run.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";

config({ path: ".env.local" });

const auditDbUrl = process.env.AUDIT_DATABASE_URL;
try {
  assertNotMainProductionDatabase(auditDbUrl, "AUDIT_DATABASE_URL");
} catch (err) {
  if (err instanceof MainProductionDatabaseGuardError) {
    console.error(`✗ REFUSED: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const client = new Client({ connectionString: auditDbUrl });
await client.connect();
const supabase = createClient(process.env.NEXT_PUBLIC_AUDIT_SUPABASE_URL, process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

try {
  console.log("=== Recherche des prospects/audits TEST-E2E ===");
  const { rows: prospects } = await client.query(
    `SELECT id, first_name, last_name FROM audit_prospects WHERE first_name ILIKE 'TEST-E2E%' OR last_name ILIKE '%TEST-E2E%' OR last_name ILIKE '%Playwright%' OR last_name ILIKE '%ActivityFix%'`,
  );
  console.log(`  ${prospects.length} prospect(s) trouvé(s):`, prospects.map((p) => `${p.id} (${p.first_name} ${p.last_name})`).join(", ") || "aucun");

  const { rows: evidenceStoragePaths } = prospects.length
    ? await client.query(
        `SELECT e.storage_bucket, e.storage_path FROM gbp_audit_evidence e
         JOIN gbp_audit_findings f ON f.id = e.finding_id
         JOIN gbp_audits a ON a.id = f.audit_id
         WHERE a.prospect_id = ANY($1) AND e.storage_path IS NOT NULL`,
        [prospects.map((p) => p.id)],
      )
    : { rows: [] };

  for (const ev of evidenceStoragePaths) {
    const { error } = await supabase.storage.from(ev.storage_bucket).remove([ev.storage_path]);
    console.log(`  storage: ${ev.storage_bucket}/${ev.storage_path} -> ${error ? "FAIL: " + error.message : "supprimé"}`);
  }

  if (prospects.length) {
    const ids = prospects.map((p) => p.id);
    // gbp_audits -> gbp_audit_findings -> gbp_audit_evidence all cascade on delete (see db/audit-schema.ts),
    // as does audit_businesses via prospect_id. Deleting the prospect row is enough.
    const { rowCount } = await client.query(`DELETE FROM audit_prospects WHERE id = ANY($1)`, [ids]);
    console.log(`  ${rowCount} prospect(s) supprimé(s) (cascade: business, audit, findings, evidence)`);
  }

  console.log("\n=== Recherche des utilisateurs staff TEST-E2E ===");
  const { rows: staffUsers } = await client.query(`SELECT id, email FROM audit_staff_users WHERE email ILIKE '%test-e2e%'`);
  console.log(`  ${staffUsers.length} utilisateur(s) trouvé(s):`, staffUsers.map((u) => u.id).join(", ") || "aucun");
  if (staffUsers.length) {
    const { rowCount } = await client.query(
      `DELETE FROM audit_staff_users WHERE id = ANY($1)`,
      [staffUsers.map((u) => u.id)],
    );
    console.log(`  ${rowCount} utilisateur(s) supprimé(s) (cascade: memberships)`);
  }

  console.log("\nRESULTAT: NETTOYAGE TERMINE");
} finally {
  await client.end();
}
