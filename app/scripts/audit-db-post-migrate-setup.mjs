#!/usr/bin/env node
/**
 * Runs the two steps that MUST happen after every `npm run audit:db:migrate`
 * against a project that has never had them run before (a fresh Supabase
 * project, or a CI-provisioned test database): seeding the 3 fixed
 * audit_staff_roles rows, and applying db/audit-migrations/rls-policies.sql.
 *
 * Neither step is run automatically by drizzle-kit — schema migrations only
 * cover table structure, not data seeds or RLS/policy DDL. Before this
 * script existed, both were separate manual steps that were easy to forget
 * (see scripts/audit-db-seed-roles.mjs and scripts/audit-db-apply-rls.mjs,
 * still usable standalone). Both steps are idempotent — safe to re-run
 * after every future migration, not just the first one, since RLS coverage
 * must be re-verified whenever a new table is added (a whitelist-based
 * version of rls-policies.sql once went stale this exact way — see the
 * dynamic pg_tables iteration in that file).
 *
 * Usage: npm run audit:db:post-migrate-setup
 * (or: npx tsx scripts/audit-db-post-migrate-setup.mjs)
 */
import { spawn } from "node:child_process";

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", script], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`))));
  });
}

console.log("=== 1/2 : Seeding des rôles staff (idempotent) ===");
await run("scripts/audit-db-seed-roles.mjs");

console.log("\n=== 2/2 : Application de RLS + policies (idempotent) ===");
await run("scripts/audit-db-apply-rls.mjs");

console.log("\nOK — post-migration setup terminé.");
