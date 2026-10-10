// 4F.14-K — the preview-schema-apply dry-run builds its plan from the SQL
// files alone: no .env.local, no PREVIEW_SCHEMA_DATABASE_URL, no pg Client.
// `pg` and `dotenv` are module-mocked (constructing a Client throws), so no
// test here can open a connection. The one subprocess test runs the real
// script from a throwaway directory holding a FAKE .env.local sentinel —
// never the worktree's own .env.local.
//
// Run with: npx tsx --test --experimental-test-module-mocks scripts/preview-schema-apply.test.mjs
import { after, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dotenvCalls = [];
let clientsConstructed = 0;
mock.module("dotenv", { namedExports: { config: (opts) => dotenvCalls.push(opts) } });
mock.module("pg", {
  namedExports: {
    Client: class {
      constructor() {
        clientsConstructed += 1;
        throw new Error("test: a pg Client must never be constructed here");
      }
    },
  },
});

const { SUPPORTED_FLAGS, buildDryRunReport, main, parseApplyArgs } = await import("./preview-schema-apply.mjs");

const ENV_VAR = "PREVIEW_SCHEMA_DATABASE_URL";
const CATCH_UP = [
  "0030_lumpy_warlock.sql", "0031_stiff_leech.sql", "0032_cool_red_wolf.sql", "0033_reflective_wolf_cub.sql",
  "0034_aberrant_earthquake.sql", "0035_tough_phil_sheldon.sql", "0036_brainy_deathbird.sql",
  "0037_amused_justin_hammer.sql", "0038_pink_triton.sql", "0039_mute_chat.sql",
  "0040_radar_ai_provider_runtime_config.sql", "0041_radar_ai_provider_attempt_telemetry.sql",
  "0042_radar_ai_quota_policy.sql", "0043_radar_ai_quota_counter.sql", "0044_old_doctor_faustus.sql",
  "0045_lyrical_earthquake.sql", "0046_wise_nemesis.sql", "0047_chilly_ink.sql", "0048_parallel_nick_fury.sql",
];
const loadFiles = (names) => names.map((name) => ({ name, sql: readFileSync(join("db", "migrations", name), "utf8") }));

const savedEnvValue = process.env[ENV_VAR];
beforeEach(() => {
  delete process.env[ENV_VAR];
  dotenvCalls.length = 0;
  clientsConstructed = 0;
});
after(() => {
  if (savedEnvValue !== undefined) process.env[ENV_VAR] = savedEnvValue;
});

function captureConsole(t) {
  const out = [];
  t.mock.method(console, "log", (...a) => out.push(a.join(" ")));
  t.mock.method(console, "error", (...a) => out.push(a.join(" ")));
  return out;
}

test("parseApplyArgs keeps file order and treats --execute as the only real-run trigger", () => {
  assert.deepEqual([...SUPPORTED_FLAGS], ["--execute"]);
  assert.deepEqual(parseApplyArgs(["b.sql", "a.sql"]), { isExecute: false, fileNames: ["b.sql", "a.sql"] });
  assert.deepEqual(parseApplyArgs(["a.sql", "--execute", "b.sql"]), { isExecute: true, fileNames: ["a.sql", "b.sql"] });
});

test("parseApplyArgs rejects every unknown -- argument and an empty file list", () => {
  for (const flag of ["--exectue", "--yes", "--dry-run", "--execute=1", "--force"]) {
    const r = parseApplyArgs(["0048_parallel_nick_fury.sql", flag]);
    assert.ok(r.error?.includes(flag), `${flag} must be rejected`);
    assert.equal(r.isExecute, undefined);
  }
  assert.ok(parseApplyArgs([]).error);
  assert.ok(parseApplyArgs(["--execute"]).error);
});

test("dry-run plan for 0030-0048: 19 files in order, 81 statements, every public reference rewritten to preview", async () => {
  const report = await buildDryRunReport(loadFiles(CATCH_UP));
  assert.deepEqual(report.migrationFiles, CATCH_UP);
  assert.equal(report.statementCount, 81);
  assert.equal(report.statements[0].sql, 'CREATE SCHEMA IF NOT EXISTS "preview"');
  assert.equal(report.statements[1].sql, 'SET LOCAL search_path TO "preview"');
  const allSql = report.statements.map((s) => s.sql).join("\n");
  assert.equal((allSql.match(/public/gi) ?? []).length, 0);
  assert.equal((allSql.match(/REFERENCES "preview"\./g) ?? []).length, 22);
  const order = [...new Set(report.statements.slice(2).map((s) => s.file))];
  assert.deepEqual(order, CATCH_UP);
  assert.deepEqual(report.database, { configured: false, skipped: true });
});

test("dry-run main(): exit 0 with no env var, dotenv never loaded, no pg Client, no connection target printed", async (t) => {
  const out = captureConsole(t);
  const code = await main(CATCH_UP);
  assert.equal(code, 0);
  assert.equal(dotenvCalls.length, 0, ".env.local must not be loaded in dry-run");
  assert.equal(clientsConstructed, 0);
  assert.equal(process.env[ENV_VAR], undefined);
  const text = out.join("\n");
  assert.match(text, /Instructions SQL finales, dans leur ordre exact \(81\)/);
  assert.match(text, /non lue — mode à blanc/);
  assert.doesNotMatch(text, /Hôte|Utilisateur|Mot de passe/);
});

test("main() refuses an unknown -- argument before reading any migration or config", async (t) => {
  captureConsole(t);
  assert.equal(await main(["0048_parallel_nick_fury.sql", "--yes"]), 1);
  assert.equal(dotenvCalls.length, 0);
  assert.equal(clientsConstructed, 0);
});

test("--execute still loads .env.local and refuses before any connection when the variable is missing", async (t) => {
  captureConsole(t);
  t.mock.method(process, "exit", (code) => {
    throw Object.assign(new Error("exit"), { exitCode: code });
  });
  await assert.rejects(() => main(["--execute", "0048_parallel_nick_fury.sql"]), (err) => err.exitCode === 1);
  assert.deepEqual(dotenvCalls, [{ path: ".env.local" }]);
  assert.equal(clientsConstructed, 0);
});

test("the real-run guards are still in the source: dotenv only on --execute, table pre-check, typed APPLY, allowExisting", () => {
  const src = readFileSync("scripts/preview-schema-apply.mjs", "utf8");
  assert.doesNotMatch(src, /^import .* from "dotenv";$/m, "dotenv must not be a static import");
  const dryRunReturn = src.indexOf("if (!isExecute) {");
  const dotenvImport = src.indexOf('await import("dotenv")');
  assert.ok(dryRunReturn > 0 && dotenvImport > dryRunReturn, "dotenv is imported only after the dry-run branch returned");
  assert.match(src, /answer\.trim\(\) !== "APPLY"/);
  assert.match(src, /select table_name from information_schema\.tables where table_schema = \$1 and table_name = any/);
  assert.match(src, /allowExisting: true/);
  assert.match(src, /const TARGET_SCHEMA = "preview";/);
});

test("subprocess dry-run from a throwaway dir: a FAKE .env.local is never read and nothing from it is printed", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-preview-apply-"));
  try {
    symlinkSync(resolve("db"), join(dir, "db"));
    writeFileSync(join(dir, ".env.local"), `${ENV_VAR}=postgresql://sentinel-user:sentinel-pass@sentinel.invalid:1/sentinel\n`);
    const env = { ...process.env };
    delete env[ENV_VAR];
    const run = spawnSync(resolve("node_modules/.bin/tsx"), [resolve("scripts/preview-schema-apply.mjs"), ...CATCH_UP], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, output);
    assert.doesNotMatch(output, /sentinel/);
    assert.doesNotMatch(output, /injecting env/);
    assert.match(output, /\(81\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
