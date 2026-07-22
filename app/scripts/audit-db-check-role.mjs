#!/usr/bin/env node
/**
 * Read-only check: does the `audit_app` role already exist on
 * AUDIT_DATABASE_URL's target? Never prints connection details or secrets —
 * only the boolean result. Same safety pattern as audit-db-migrate.mjs.
 */
import { config } from "dotenv";
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

const client = new Client({ connectionString });
await client.connect();
try {
  const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'audit_app'");
  console.log(rows.length > 0 ? "EXISTS" : "NOT_FOUND");
} finally {
  await client.end();
}
