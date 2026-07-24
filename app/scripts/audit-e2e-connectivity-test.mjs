#!/usr/bin/env node
/**
 * Full connectivity test against the real public-map-audit project:
 * DB read/write, staff role resolution, evidence upload -> Storage ->
 * signed URL -> read. Creates only [TEST-E2E]-prefixed rows and a
 * throwaway Storage object, all removed at the end regardless of outcome.
 * Never logs secrets — only counts, booleans, and non-sensitive metadata.
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
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

let testUserId, testMembershipId, testProspectId, testBusinessId, testAuditId, testFindingId, testEvidenceId;
const storagePath = `__e2e-test__/${Date.now()}-connectivity.png`;

try {
  console.log("=== 1. DB read : rôles disponibles ===");
  const { rows: roles } = await client.query("SELECT name FROM audit_staff_roles ORDER BY name");
  console.log("  rôles:", roles.map((r) => r.name).join(", ") || "(aucun)");
  const adminRole = roles.find((r) => r.name === "admin");
  if (!adminRole) throw new Error("Rôle 'admin' introuvable dans audit_staff_roles — migrations incomplètes ?");
  const { rows: adminRoleRows } = await client.query("SELECT id FROM audit_staff_roles WHERE name = 'admin'");
  const adminRoleId = adminRoleRows[0].id;
  console.log("  OK\n");

  console.log("=== 2. DB write : résolution staff (user -> membership -> role) ===");
  const { rows: userRows } = await client.query(
    "INSERT INTO audit_staff_users (clerk_user_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
    [`test-e2e-${randomUUID()}`, "test-e2e@example.invalid", "[TEST-E2E] Connectivity"],
  );
  testUserId = userRows[0].id;
  const { rows: memberRows } = await client.query(
    "INSERT INTO audit_staff_memberships (user_id, role_id) VALUES ($1, $2) RETURNING id",
    [testUserId, adminRoleId],
  );
  testMembershipId = memberRows[0].id;
  const { rows: resolved } = await client.query(
    `SELECT r.name AS role_name FROM audit_staff_memberships m
     JOIN audit_staff_roles r ON r.id = m.role_id
     WHERE m.user_id = $1`,
    [testUserId],
  );
  console.log(`  résolution: role=${resolved[0]?.role_name} (attendu: admin)`);
  if (resolved[0]?.role_name !== "admin") throw new Error("Résolution du rôle incorrecte");
  console.log("  OK\n");

  console.log("=== 3. DB write : chaîne prospect -> business -> audit -> finding ===");
  const { rows: prospectRows } = await client.query(
    "INSERT INTO audit_prospects (first_name, last_name, email) VALUES ($1, $2, $3) RETURNING id",
    ["[TEST-E2E]", "Connectivity", "test-e2e-prospect@example.invalid"],
  );
  testProspectId = prospectRows[0].id;
  const { rows: businessRows } = await client.query(
    "INSERT INTO audit_businesses (prospect_id, legal_name) VALUES ($1, $2) RETURNING id",
    [testProspectId, "[TEST-E2E] Business"],
  );
  testBusinessId = businessRows[0].id;
  const { rows: auditRows } = await client.query(
    "INSERT INTO gbp_audits (prospect_id, business_id, status) VALUES ($1, $2, 'not_started') RETURNING id",
    [testProspectId, testBusinessId],
  );
  testAuditId = auditRows[0].id;
  const { rows: findingRows } = await client.query(
    "INSERT INTO gbp_audit_findings (audit_id, section_code, check_key, result, severity) VALUES ($1, 'A', 'test_check', 'fail', 'moderate') RETURNING id",
    [testAuditId],
  );
  testFindingId = findingRows[0].id;
  console.log(`  audit=${testAuditId} finding=${testFindingId}`);
  console.log("  OK\n");

  console.log("=== 4. Storage : upload d'une preuve réelle + URL signée + lecture ===");
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const { error: upErr } = await supabase.storage.from("audit-evidence").upload(storagePath, pngBytes, { contentType: "image/png" });
  if (upErr) throw new Error(`Upload évidence échoué: ${upErr.message}`);
  const { rows: evidenceRows } = await client.query(
    `INSERT INTO gbp_audit_evidence (finding_id, kind, file_name, mime_type, size_bytes, storage_bucket, storage_path)
     VALUES ($1, 'screenshot', 'test.png', 'image/png', $2, 'audit-evidence', $3) RETURNING id`,
    [testFindingId, pngBytes.length, storagePath],
  );
  testEvidenceId = evidenceRows[0].id;
  const { data: signed, error: signErr } = await supabase.storage.from("audit-evidence").createSignedUrl(storagePath, 60);
  if (signErr) throw new Error(`Signature URL échouée: ${signErr.message}`);
  const res = await fetch(signed.signedUrl);
  const fetchedBytes = Buffer.from(await res.arrayBuffer());
  const matches = fetchedBytes.equals(pngBytes);
  console.log(`  evidence_id=${testEvidenceId} signed_url_status=${res.status} bytes_match=${matches}`);
  if (res.status !== 200 || !matches) throw new Error("Lecture de la preuve via URL signée incorrecte");
  console.log("  OK\n");

  console.log("=== 5. DB read : relecture complète de la chaîne (comme le ferait une page) ===");
  const { rows: readBack } = await client.query(
    `SELECT b.legal_name, a.status, f.check_key, e.file_name
     FROM gbp_audits a
     JOIN audit_businesses b ON b.id = a.business_id
     JOIN gbp_audit_findings f ON f.audit_id = a.id
     JOIN gbp_audit_evidence e ON e.finding_id = f.id
     WHERE a.id = $1`,
    [testAuditId],
  );
  console.log(`  ${readBack.length} ligne(s) — business=${readBack[0]?.legal_name} status=${readBack[0]?.status} evidence=${readBack[0]?.file_name}`);
  if (readBack.length !== 1) throw new Error("Relecture de la chaîne incorrecte");
  console.log("  OK\n");

  console.log("RESULTAT: TOUTES LES CONNEXIONS FONCTIONNENT (DB + Storage + résolution staff)");
} finally {
  console.log("\n=== Nettoyage ===");
  await supabase.storage.from("audit-evidence").remove([storagePath]).catch(() => {});
  if (testEvidenceId) await client.query("DELETE FROM gbp_audit_evidence WHERE id = $1", [testEvidenceId]).catch(() => {});
  if (testFindingId) await client.query("DELETE FROM gbp_audit_findings WHERE id = $1", [testFindingId]).catch(() => {});
  if (testAuditId) await client.query("DELETE FROM gbp_audits WHERE id = $1", [testAuditId]).catch(() => {});
  if (testBusinessId) await client.query("DELETE FROM audit_businesses WHERE id = $1", [testBusinessId]).catch(() => {});
  if (testProspectId) await client.query("DELETE FROM audit_prospects WHERE id = $1", [testProspectId]).catch(() => {});
  if (testMembershipId) await client.query("DELETE FROM audit_staff_memberships WHERE id = $1", [testMembershipId]).catch(() => {});
  if (testUserId) await client.query("DELETE FROM audit_staff_users WHERE id = $1", [testUserId]).catch(() => {});
  console.log("Toutes les lignes et fichiers [TEST-E2E] supprimés.");
  await client.end();
}
