#!/usr/bin/env node
/**
 * Grants the "admin" audit_staff_memberships role to a Clerk account that
 * Clerk has already authenticated and getAuditStaffSession() has already
 * mirrored into audit_staff_users (see lib/gbp-audit/session.ts) — this
 * script never creates a Clerk account, only the missing membership row
 * that lets an existing audit_staff_users row pass requireAuditStaffRole().
 * Idempotent: ON CONFLICT (user_id) DO NOTHING, same constraint
 * getAuditStaffSession()'s claimPendingInvitation() relies on.
 *
 * Usage: npx tsx scripts/audit-bootstrap-first-admin.mjs <email>
 */
import { config } from "dotenv";
import { Client } from "pg";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";

config({ path: ".env.local" });

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/audit-bootstrap-first-admin.mjs <email>");
  process.exit(1);
}

const connectionString = process.env.AUDIT_DATABASE_URL;
try {
  assertNotMainProductionDatabase(connectionString, "AUDIT_DATABASE_URL");
} catch (err) {
  if (err instanceof MainProductionDatabaseGuardError) {
    console.error(`✗ REFUSED: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const client = new Client({ connectionString });
await client.connect();
try {
  const { rows: userRows } = await client.query("SELECT id FROM audit_staff_users WHERE email = $1", [email.toLowerCase()]);
  if (userRows.length === 0) {
    console.error(`✗ Aucun compte audit_staff_users pour "${email}" — cette personne doit d'abord visiter une page /admin/audit/* connectée via Clerk pour être mirrorée.`);
    process.exit(1);
  }
  const userId = userRows[0].id;

  const { rows: roleRows } = await client.query("SELECT id FROM audit_staff_roles WHERE name = 'admin'");
  if (roleRows.length === 0) {
    console.error("✗ Le rôle 'admin' n'existe pas dans audit_staff_roles — lancer d'abord scripts/audit-db-seed-roles.mjs.");
    process.exit(1);
  }
  const adminRoleId = roleRows[0].id;

  const { rowCount } = await client.query(
    "INSERT INTO audit_staff_memberships (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
    [userId, adminRoleId],
  );

  if (rowCount > 0) {
    console.log(`+ Membership admin créé pour ${email}.`);
  } else {
    const { rows: existing } = await client.query(
      "SELECT r.name FROM audit_staff_memberships m JOIN audit_staff_roles r ON r.id = m.role_id WHERE m.user_id = $1",
      [userId],
    );
    console.log(`= Un membership existe déjà pour ${email} (rôle actuel: ${existing[0]?.name ?? "inconnu"}) — rien créé, aucun doublon.`);
  }
} finally {
  await client.end();
}
