#!/usr/bin/env node
/**
 * Bootstraps the main app's org/role/invitation data in the `preview`
 * schema (see the 2026-07 Phase 4 work) — the missing prerequisite for
 * app/admin/layout.tsx's getCurrentSession() to resolve any session at
 * all on Preview. No official seed/bootstrap script for this ever existed
 * in this repo (verified against full git history) and it is never
 * auto-created (lib/dev-org.ts's getOrCreateDevOrganization() requires an
 * existing membership, it does not create one).
 *
 * Deliberately reuses the application's OWN invitation-claim mechanism
 * (lib/session.ts's claimPendingInvitation()) instead of writing a
 * membership row directly: this script only seeds `roles` (a fixed
 * lookup — admin/staff/client, identical content to production) and one
 * `invitations` row. The membership itself is created by real application
 * code the next time this account signs in for real — not duplicated
 * logic, not a shortcut around the existing model.
 *
 * Idempotent: safe to re-run — every insert is ON CONFLICT DO NOTHING.
 *
 * Usage: npx tsx scripts/preview-bootstrap-first-admin.mjs <email>
 */
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/preview-bootstrap-first-admin.mjs <email>");
  process.exit(1);
}

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error("✗ DATABASE_URL is not set.");
  process.exit(1);
}
const connectionString = baseUrl.includes("?")
  ? `${baseUrl}&options=-c%20search_path%3Dpreview`
  : `${baseUrl}?options=-c%20search_path%3Dpreview`;

const ROLES = ["admin", "staff", "client"]; // identical content to production's roles table
const ORG_NAME = "[PREVIEW] Public Maps";

const client = new Client({ connectionString });
await client.connect();
try {
  const { rows: schemaCheck } = await client.query("SELECT current_schema()");
  if (schemaCheck[0].current_schema !== "preview") {
    console.error(`✗ REFUSED: search_path resolved to "${schemaCheck[0].current_schema}", not "preview". Arrêt avant toute écriture.`);
    process.exit(1);
  }

  for (const name of ROLES) {
    const { rowCount } = await client.query("INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
    console.log(rowCount > 0 ? `  + rôle "${name}" créé` : `  = rôle "${name}" déjà présent`);
  }
  const { rows: adminRoleRows } = await client.query("SELECT id FROM roles WHERE name = 'admin'");
  const adminRoleId = adminRoleRows[0].id;

  let { rows: orgRows } = await client.query("SELECT id FROM organizations WHERE name = $1", [ORG_NAME]);
  if (orgRows.length === 0) {
    ({ rows: orgRows } = await client.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [ORG_NAME]));
    console.log(`  + organisation "${ORG_NAME}" créée`);
  } else {
    console.log(`  = organisation "${ORG_NAME}" déjà présente`);
  }
  const orgId = orgRows[0].id;

  const { rows: existingInvite } = await client.query(
    "SELECT id, status FROM invitations WHERE email = $1 AND organization_id = $2",
    [email.toLowerCase(), orgId],
  );
  if (existingInvite.length === 0) {
    await client.query(
      "INSERT INTO invitations (organization_id, email, role_id, status) VALUES ($1, $2, $3, 'pending')",
      [orgId, email.toLowerCase(), adminRoleId],
    );
    console.log(`  + invitation admin créée pour ${email}`);
  } else {
    console.log(`  = invitation déjà présente pour ${email} (statut: ${existingInvite[0].status})`);
  }

  const { rows: memberCheck } = await client.query(
    `SELECT m.user_id FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE u.email = $1 AND m.organization_id = $2`,
    [email.toLowerCase(), orgId],
  );
  console.log(`\nMembership déjà réclamé pour ${email} ? ${memberCheck.length > 0 ? "OUI" : "NON — sera créé au prochain vrai sign-in via claimPendingInvitation()"}`);
} finally {
  await client.end();
}
