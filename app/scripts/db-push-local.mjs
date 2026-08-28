#!/usr/bin/env node
/**
 * PUBLIC-MAP — DATABASE TOOLING SAFETY / Phase S2. Safe entry point for
 * applying schema changes to the developer's own local, disposable
 * Postgres instance. This is the ONLY sanctioned way to run
 * `drizzle-kit push` against LOCAL_TEST_DATABASE_URL — it never delegates
 * to a raw `npx drizzle-kit push` without going through every check below
 * first, and it never reads or falls back to DATABASE_URL (see
 * drizzle.local.config.ts / db/guard-local-only.ts).
 *
 * Named db:push:local (not "migrate") because the underlying operation is
 * genuinely `drizzle-kit push`, which diffs and applies the schema
 * directly — there is no separate, reviewable migration file involved,
 * unlike `db:generate`. The confirmation phrase below is still "MIGRATE",
 * matching scripts/audit-db-migrate.mjs's own established token, so
 * there's exactly one phrase to remember across this repo's two local-
 * safety wrappers even though the command names differ.
 *
 * Usage (or `npm run db:push:local` / `npm run db:push:local -- --dry-run`):
 *   npx tsx scripts/db-push-local.mjs            # interactive, asks to type MIGRATE
 *   npx tsx scripts/db-push-local.mjs --dry-run   # shows the target, applies nothing
 *
 * What it does, in order:
 *   1. Loads .env.local
 *   2. Reads LOCAL_TEST_DATABASE_URL only — DATABASE_URL is never read or
 *      accepted as a fallback.
 *   3. Refuses immediately (via db/guard-local-only.ts) unless the
 *      resolved URL's hostname is exactly localhost or 127.0.0.1.
 *   4. Prints the target host + port + database name and a fixed "LOCAL"
 *      classification — never the username, password, full URL, or any
 *      query parameters.
 *   5. On --dry-run, stops here (pure inspection, zero risk, drizzle-kit
 *      is never spawned).
 *   6. Otherwise, requires typing the literal word MIGRATE to continue —
 *      no --yes flag, no force/bypass option exists on purpose.
 *   7. Runs `drizzle-kit push --config=drizzle.local.config.ts`, which
 *      re-validates the same guard on its own (belt-and-suspenders — see
 *      drizzle.local.config.ts).
 */
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { assertLocalOnlyDatabase, LocalOnlyDatabaseGuardError } from "../db/guard-local-only.ts";

export const CONFIRMATION_TOKEN = "MIGRATE";

/** Never includes the username or password — only what's safe to print. */
export function redactForDisplay(connectionString) {
  const url = new URL(connectionString);
  return { host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, "") || "(unknown)" };
}

export function describeTarget(connectionString) {
  const { host, port, database } = redactForDisplay(connectionString);
  return { host, port, database, classification: "LOCAL" };
}

export function describeOperation() {
  return "drizzle-kit push --config=drizzle.local.config.ts";
}

/**
 * Injectable for tests: argv/env/promptFn/spawnFn/log/error all default to
 * the real process-level equivalents, but a test can pass fakes so this
 * function never touches stdin, spawns a real subprocess, or reads real
 * environment variables. Returns a plain result object instead of calling
 * process.exit() itself — the CLI entry point below does that.
 */
export async function run({ argv = process.argv.slice(2), env = process.env, promptFn, spawnFn = spawn, log = console.log, error = console.error } = {}) {
  const isDryRun = argv.includes("--dry-run");
  const connectionString = env.LOCAL_TEST_DATABASE_URL;

  try {
    assertLocalOnlyDatabase(connectionString, "LOCAL_TEST_DATABASE_URL");
  } catch (err) {
    if (err instanceof LocalOnlyDatabaseGuardError) {
      error(`✗ REFUSED: ${err.message}`);
      return { ok: false, spawned: false, refused: true, reason: err.message };
    }
    throw err;
  }

  const target = describeTarget(connectionString);

  log("─".repeat(60));
  log("PUBLIC-MAP — local-only database push target");
  log("─".repeat(60));
  log(`  Host           : ${target.host}:${target.port}`);
  log(`  Database       : ${target.database}`);
  log(`  Classification : ${target.classification}`);
  log(`  Operation      : ${describeOperation()}`);
  log("─".repeat(60));

  if (isDryRun) {
    log("Dry run — nothing applied, drizzle-kit was never spawned. Re-run without --dry-run to push for real.");
    return { ok: true, spawned: false, dryRun: true, target };
  }

  const ask =
    promptFn ??
    (async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Type "${CONFIRMATION_TOKEN}" to apply this push, anything else to cancel: `);
      rl.close();
      return answer;
    });

  const answer = await ask();
  if (answer.trim() !== CONFIRMATION_TOKEN) {
    log("Cancelled — no changes made.");
    return { ok: true, spawned: false, cancelled: true };
  }

  log("Running drizzle-kit push against the target above...");
  return new Promise((resolve) => {
    const child = spawnFn("npx", ["drizzle-kit", "push", "--config=drizzle.local.config.ts"], {
      stdio: "inherit",
      env,
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, spawned: true, exitCode: code });
    });
  });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  config({ path: ".env.local" });
  const result = await run();
  process.exit(result.ok ? 0 : 1);
}
