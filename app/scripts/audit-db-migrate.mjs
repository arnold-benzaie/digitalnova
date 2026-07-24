#!/usr/bin/env node
/**
 * Safe entry point for applying schema changes to the PUBLIC-MAP Audit
 * database. This is the ONLY sanctioned way to run `drizzle-kit push`
 * against AUDIT_DATABASE_URL — it never delegates to a raw `npm run
 * db:push` equivalent without going through every check below first.
 *
 * Usage (or `npm run audit:db:migrate` / `npm run audit:db:migrate -- --dry-run`):
 *   npx tsx scripts/audit-db-migrate.mjs            # interactive, asks to type MIGRATE
 *   npx tsx scripts/audit-db-migrate.mjs --dry-run   # shows the target, applies nothing
 *
 * What it does, in order:
 *   1. Loads .env.local
 *   2. Refuses immediately if AUDIT_DATABASE_URL is missing, or matches the
 *      main PUBLIC-MAP production database (host/ref signature, or an exact
 *      match with DATABASE_URL) — see db/guard-main-production.ts.
 *   3. Prints the target host + database name (password always redacted)
 *      and a plain-language environment label (LOCAL vs REMOTE).
 *   4. On --dry-run, stops here (pure inspection, zero risk).
 *   5. Otherwise, requires typing the literal word MIGRATE to continue —
 *      no --yes flag exists on purpose.
 *   6. Runs `drizzle-kit push --config=drizzle-audit.config.ts`, which
 *      re-validates the same guard on its own (belt-and-suspenders — see
 *      drizzle-audit.config.ts).
 */
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";

config({ path: ".env.local" });

const isDryRun = process.argv.includes("--dry-run");

function redact(connectionString) {
  try {
    const url = new URL(connectionString);
    return { host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, "") || "(unknown)" };
  } catch {
    return { host: "(unparseable connection string)", port: "?", database: "?" };
  }
}

function environmentLabel(host) {
  if (host === "localhost" || host === "127.0.0.1") return "LOCAL (Docker/dev database — safe to iterate on)";
  return "REMOTE — verify this is the PUBLIC-MAP Audit Supabase project, NOT the main site's database";
}

const connectionString = process.env.AUDIT_DATABASE_URL;

if (!connectionString) {
  console.error("✗ AUDIT_DATABASE_URL is not set. Copy .env.example to .env.local and fill it in first.");
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

const { host, port, database } = redact(connectionString);

console.log("─".repeat(60));
console.log("PUBLIC-MAP Audit — database migration target");
console.log("─".repeat(60));
console.log(`  Host        : ${host}:${port}`);
console.log(`  Database    : ${database}`);
console.log(`  Environment : ${environmentLabel(host)}`);
console.log(`  Config      : drizzle-audit.config.ts (schema: db/audit-schema.ts)`);
console.log("─".repeat(60));

if (isDryRun) {
  console.log("Dry run — nothing applied. Re-run without --dry-run to migrate for real.");
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Type "MIGRATE" to apply this migration, anything else to cancel: ');
rl.close();

if (answer.trim() !== "MIGRATE") {
  console.log("Cancelled — no changes made.");
  process.exit(0);
}

console.log("Running drizzle-kit push against the target above...");
const child = spawn("npx", ["drizzle-kit", "push", "--config=drizzle-audit.config.ts"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log('\n⚠ Migration applied. Now run "npm run audit:db:post-migrate-setup" — schema migrations never seed roles or apply RLS on their own.');
  }
  process.exit(code ?? 1);
});
