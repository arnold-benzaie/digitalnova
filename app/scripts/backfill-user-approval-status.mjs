#!/usr/bin/env node
/**
 * One-time data backfill for the 2026-07 user-approval feature. Must run
 * strictly BETWEEN migrations 0010 (adds users.status as a bare nullable
 * column, no default) and 0011 (locks it to NOT NULL DEFAULT 'pending') —
 * every row gets an explicit, correct status here while the column is
 * still nullable, so no existing user is ever implicitly/transiently
 * "pending" the way a single ADD COLUMN ... DEFAULT 'pending' NOT NULL
 * would have made them for the split second before this script ran.
 *
 * Idempotent: every statement is safe to re-run.
 *   - roles: ON CONFLICT DO NOTHING (unique on name).
 *   - users.status: plain UPDATE ... WHERE — re-running re-asserts the same
 *     value, never creates a row or changes anything already correct.
 *   - organizations.is_internal: only written when exactly one row matches
 *     and it isn't already flagged; otherwise the script prints a clear
 *     message and leaves the data untouched rather than guessing. Prints
 *     the candidate's id/name/slug/created_at BEFORE writing, so a human
 *     reviewing the run's output can confirm it's really PUBLIC-MAP before
 *     trusting the result.
 * Never deletes or modifies any existing role or membership row.
 *
 * Connection: reads DATABASE_URL from process.env as-is (no dotenv config
 * call here) — the caller decides which env file to source, so this
 * script can never silently default to any particular database. Refuses
 * to run against a host that looks like the shared Supabase project
 * unless ALLOW_SUPABASE_HOST=1 is explicitly set, as a last-resort guard
 * against accidentally pointing this at Production.
 *
 * Usage: DATABASE_URL=postgresql://... npx tsx scripts/backfill-user-approval-status.mjs
 */
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ DATABASE_URL is not set in the environment running this script.");
  process.exit(1);
}
const targetHost = new URL(connectionString).hostname;
if (/supabase\.com$/i.test(targetHost) && process.env.ALLOW_SUPABASE_HOST !== "1") {
  console.error(`✗ REFUSED: target host "${targetHost}" looks like the shared Supabase project (possibly Production).`);
  console.error("  This script is for the local/isolated approval-feature database only.");
  console.error("  Set ALLOW_SUPABASE_HOST=1 only if you have independently verified this is NOT Production.");
  process.exit(1);
}

const NEW_ROLES = ["agent", "supervisor"];
const INTERNAL_ORG_NAME = "PUBLIC-MAP";

const client = new Client({ connectionString });
await client.connect();
try {
  const { rows: dbInfo } = await client.query("SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS addr, inet_server_port() AS port");
  console.log(`Connecté à : ${dbInfo[0].db}@${targetHost}:${dbInfo[0].port} (utilisateur ${dbInfo[0].usr})`);

  console.log("\n1. Rôles supplémentaires (agent, supervisor)");
  for (const name of NEW_ROLES) {
    const { rowCount } = await client.query("INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
    console.log(rowCount > 0 ? `  + rôle "${name}" créé` : `  = rôle "${name}" déjà présent`);
  }

  console.log("\n2. Statut explicite pour chaque utilisateur existant (colonne encore nullable à ce stade — migration 0011 pas encore appliquée)");
  const { rowCount: promoted } = await client.query(`
    UPDATE users SET status = 'active'
    WHERE id IN (SELECT DISTINCT user_id FROM memberships) AND status IS DISTINCT FROM 'active'
  `);
  console.log(`  + ${promoted} utilisateur(s) avec membership → status = 'active'`);
  const { rowCount: setPending } = await client.query(`
    UPDATE users SET status = 'pending'
    WHERE id NOT IN (SELECT DISTINCT user_id FROM memberships) AND status IS DISTINCT FROM 'pending'
  `);
  console.log(`  + ${setPending} utilisateur(s) sans membership → status = 'pending'`);
  const { rows: nullCheck } = await client.query("SELECT count(*)::int AS n FROM users WHERE status IS NULL");
  if (nullCheck[0].n > 0) {
    console.error(`✗ ÉCHEC — ${nullCheck[0].n} utilisateur(s) encore avec status NULL après cette étape. Arrêt avant la migration 0011.`);
    process.exit(1);
  }

  console.log("\n3. Vérification : aucun administrateur existant ne doit rester pending/refused/suspended");
  const { rows: badAdmins } = await client.query(`
    SELECT u.id, u.email, u.status
    FROM users u JOIN memberships m ON m.user_id = u.id JOIN roles r ON r.id = m.role_id
    WHERE r.name = 'admin' AND u.status <> 'active'
  `);
  if (badAdmins.length > 0) {
    console.error("✗ ÉCHEC DE VÉRIFICATION — administrateur(s) existant(s) non actif(s) après backfill :");
    for (const row of badAdmins) console.error(`    ${row.email} (${row.id}) → status = ${row.status}`);
    console.error("Aucune autre donnée n'a été modifiée par cette vérification. Arrêt.");
    process.exit(1);
  }
  console.log("  ✓ aucun administrateur non actif détecté.");

  console.log(`\n4. Organisation interne (candidate: nom = "${INTERNAL_ORG_NAME}") — pour le routage déterministe des notifications`);
  const hasSlugColumn = await columnExists(client, "organizations", "slug");
  const orgSelectColumns = hasSlugColumn ? "id, name, slug, created_at, is_internal" : "id, name, created_at, is_internal";
  const { rows: matches } = await client.query(`SELECT ${orgSelectColumns} FROM organizations WHERE name = $1`, [INTERNAL_ORG_NAME]);
  for (const row of matches) {
    const slugDisplay = hasSlugColumn ? (row.slug ?? "(colonne slug présente mais vide)") : "non disponible (aucune colonne slug dans le schéma actuel)";
    console.log(
      `  Candidat → id=${row.id} | nom="${row.name}" | slug=${slugDisplay} | créée le ${new Date(row.created_at).toISOString()} | is_internal actuel=${row.is_internal}`,
    );
  }
  if (matches.length === 0) {
    console.warn(`  ⚠ Aucune organisation nommée "${INTERNAL_ORG_NAME}" trouvée — is_internal non défini.`);
    console.warn(`    Les notifications "nouvel utilisateur pending" échoueront tant qu'aucune organisation n'aura is_internal = true.`);
    console.warn(`    Aucune donnée modifiée pour cette étape.`);
  } else if (matches.length > 1) {
    console.error(`  ✗ ${matches.length} organisations nommées "${INTERNAL_ORG_NAME}" trouvées ci-dessus — ambigu, refus de deviner.`);
    console.error("    Aucune donnée modifiée pour cette étape. Résolvez le doublon puis relancez ce script.");
  } else if (matches[0].is_internal) {
    console.log(`  = organisation confirmée ci-dessus déjà marquée is_internal.`);
  } else {
    await client.query("UPDATE organizations SET is_internal = true WHERE id = $1", [matches[0].id]);
    console.log(`  + organisation confirmée ci-dessus marquée is_internal = true.`);
  }

  console.log("\nBackfill terminé. Aucun rôle ni membership existant n'a été supprimé ou modifié.");

  console.log("\n" + "─".repeat(60));
  console.log("RAPPORT RÉCAPITULATIF");
  console.log("─".repeat(60));
  const { rows: statusCounts } = await client.query(`
    SELECT status, count(*)::int AS n FROM users GROUP BY status ORDER BY status
  `);
  console.log("Utilisateurs par statut :");
  for (const row of statusCounts) console.log(`  ${row.status.padEnd(10)} : ${row.n}`);

  const { rows: adminRows } = await client.query(`
    SELECT count(*)::int AS n
    FROM users u JOIN memberships m ON m.user_id = u.id JOIN roles r ON r.id = m.role_id
    WHERE r.name = 'admin'
  `);
  console.log(`\nAdministrateurs (memberships role=admin) : ${adminRows[0].n}`);

  const { rows: roleRows } = await client.query("SELECT name FROM roles ORDER BY name");
  console.log(`\nRôles présents : ${roleRows.map((r) => r.name).join(", ")}`);

  const { rows: internalOrgRows } = await client.query("SELECT id, name FROM organizations WHERE is_internal = true");
  console.log(
    `\nOrganisation interne : ${internalOrgRows.length === 1 ? `${internalOrgRows[0].name} (${internalOrgRows[0].id})` : `AUCUNE ou AMBIGUË (${internalOrgRows.length} ligne(s)) — notifications pending non routables`}`,
  );

  const { rows: notifRows } = await client.query(`
    SELECT
      count(*) FILTER (WHERE type = 'user.pending_approval')::int AS pending_notifs,
      count(*) FILTER (WHERE type = 'user.pending_approval' AND read = false)::int AS pending_notifs_unread,
      count(*)::int AS total_notifs
    FROM notifications
  `);
  console.log(
    `\nNotifications : ${notifRows[0].total_notifs} au total, ${notifRows[0].pending_notifs} de type "user.pending_approval" (${notifRows[0].pending_notifs_unread} non lue(s)) — aucune n'est créée par ce script, seulement par le code applicatif au moment réel des inscriptions.`,
  );
  console.log("─".repeat(60));
} finally {
  await client.end();
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [table, column],
  );
  return rows.length > 0;
}
