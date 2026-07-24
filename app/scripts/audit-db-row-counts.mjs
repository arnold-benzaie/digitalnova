#!/usr/bin/env node
import { config } from "dotenv";
import { Client } from "pg";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";
config({ path: ".env.local" });
try { assertNotMainProductionDatabase(process.env.AUDIT_DATABASE_URL, "AUDIT_DATABASE_URL"); }
catch (err) { if (err instanceof MainProductionDatabaseGuardError) { console.error(err.message); process.exit(1); } throw err; }
const client = new Client({ connectionString: process.env.AUDIT_DATABASE_URL });
await client.connect();
for (const t of ["audit_prospects", "audit_businesses", "gbp_audits", "gbp_audit_findings", "gbp_audit_evidence", "audit_staff_users"]) {
  const { rows } = await client.query(`SELECT count(*) FROM ${t}`);
  console.log(`${t}: ${rows[0].count}`);
}
await client.end();
