#!/usr/bin/env node
/**
 * Read-only: lists policies on storage.objects and flags any that grant
 * access to anon/public. Never prints secrets — only policy/role metadata.
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

const client = new Client({ connectionString });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT policyname, roles, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'`,
  );
  console.log(`Policies sur storage.objects : ${rows.length}`);
  for (const r of rows) console.log(`  ${r.policyname} — cmd=${r.cmd} — roles=${JSON.stringify(r.roles)}`);
  const risky = rows.filter((r) => r.roles.includes("anon") || r.roles.includes("public"));
  console.log(risky.length === 0 ? "OK — aucune policy n'accorde d'accès à anon/public sur storage.objects" : "FAIL — accès anon/public détecté");
} finally {
  await client.end();
}
