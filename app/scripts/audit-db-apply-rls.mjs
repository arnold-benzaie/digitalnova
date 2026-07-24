#!/usr/bin/env node
/**
 * Applies db/audit-migrations/rls-policies.sql's executable SQL (RLS enable
 * + audit_app-only policies) against AUDIT_DATABASE_URL, then runs
 * read-only verification: RLS-enabled flag per table, policy listing, and
 * an empirical anon-role access test. Never prints connection details or
 * secrets — only table/policy/role metadata, which is not sensitive.
 */
import { config } from "dotenv";
import fs from "node:fs";
import { Client } from "pg";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";

config({ path: ".env.local" });

const connectionString = process.env.AUDIT_DATABASE_URL;
if (!connectionString) {
  console.error("✗ AUDIT_DATABASE_URL is not set.");
  process.exit(1);
}

try {
  assertNotMainProductionDatabase(connectionString, "AUDIT_DATABASE_URL");
} catch (err) {
  if (err instanceof MainProductionDatabaseGuardError) {
    console.error(`✗ REFUSED: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const PROTECTED_TABLES = [
  "audit_staff_users", "audit_staff_roles", "audit_staff_memberships",
  "audit_prospects", "audit_businesses",
  "gbp_audits", "gbp_audit_findings", "gbp_finding_status_history",
  "gbp_audit_evidence", "gbp_correction_tasks", "gbp_competitors",
  "gbp_audit_reports", "gbp_report_access_links", "gbp_report_views",
  "gbp_service_offers", "gbp_quote_requests", "email_templates",
  "gbp_audit_comments", "audit_activity_log", "audit_webhook_deliveries",
];

const client = new Client({ connectionString });
await client.connect();

try {
  console.log("=== 1. Application de rls-policies.sql ===");
  const sql = fs.readFileSync(new URL("../db/audit-migrations/rls-policies.sql", import.meta.url), "utf8");
  await client.query(sql);
  console.log("OK — RLS activé + policies créées.\n");

  console.log("=== 2. RLS activé par table ===");
  const { rows: rlsRows } = await client.query(
    `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename`,
    [PROTECTED_TABLES],
  );
  const foundTables = new Set(rlsRows.map((r) => r.tablename));
  for (const t of PROTECTED_TABLES) {
    if (!foundTables.has(t)) {
      console.log(`  ?? ${t} — table absente de la base (non créée par les migrations ?)`);
      continue;
    }
    const row = rlsRows.find((r) => r.tablename === t);
    console.log(`  ${row.rowsecurity ? "OK" : "FAIL"} — ${t} : rowsecurity=${row.rowsecurity}`);
  }
  console.log("");

  console.log("=== 3. Policies définies ===");
  const { rows: policyRows } = await client.query(
    `SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename`,
  );
  for (const p of policyRows) {
    console.log(`  ${p.tablename} — ${p.policyname} — cmd=${p.cmd} — roles=${JSON.stringify(p.roles)}`);
  }
  console.log(`  Total : ${policyRows.length} policies`);
  const grantedToAnonOrAuth = policyRows.filter(
    (p) => p.roles.includes("anon") || p.roles.includes("authenticated") || p.roles.includes("public"),
  );
  console.log(
    grantedToAnonOrAuth.length === 0
      ? "  OK — aucune policy n'accorde d'accès à anon/authenticated/public.\n"
      : `  FAIL — ${grantedToAnonOrAuth.length} policy(ies) accordent un accès à anon/authenticated/public !\n`,
  );

  console.log("=== 4. Test empirique d'accès anonyme (SET ROLE anon) ===");
  for (const t of PROTECTED_TABLES) {
    if (!foundTables.has(t)) continue;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE anon");
      // t comes from the fixed PROTECTED_TABLES array above, not user input.
      const { rows } = await client.query(`SELECT count(*) FROM public."${t}"`);
      await client.query("ROLLBACK");
      const count = Number(rows[0].count);
      console.log(`  ${count === 0 ? "OK" : "FAIL"} — ${t} : ${count} ligne(s) visible(s) par anon`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.log(`  OK — ${t} : accès refusé (${err.code ?? "erreur"} — ${err.message.split("\n")[0]})`);
    }
  }
} finally {
  await client.end();
}
