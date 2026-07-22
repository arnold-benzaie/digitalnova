#!/usr/bin/env node
/**
 * Seeds the 3 fixed audit_staff_roles rows (admin | supervisor | staff) —
 * see db/audit-schema.ts. Idempotent (ON CONFLICT (name) DO NOTHING).
 * This was previously only ever done ad hoc via Drizzle Studio against the
 * local Docker DB, so it was missing on the real Supabase project — see
 * scripts/audit-e2e-connectivity-test.mjs, which caught the gap.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";

config({ path: ".env.local" });

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

const ROLES = ["admin", "supervisor", "staff"];

const client = new Client({ connectionString });
await client.connect();
try {
  for (const name of ROLES) {
    const { rowCount } = await client.query("INSERT INTO audit_staff_roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
    console.log(rowCount > 0 ? `  + ${name} créé` : `  = ${name} déjà présent`);
  }
  const { rows } = await client.query("SELECT name FROM audit_staff_roles ORDER BY name");
  console.log("Rôles présents:", rows.map((r) => r.name).join(", "));
} finally {
  await client.end();
}
