import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeDatabaseTarget, buildPreflightReport, formatPreflightReport } from "./preview-schema-preflight.mjs";

const OK_FILES = [
  { name: "0000_a.sql", sql: `CREATE TABLE "users" ("id" uuid PRIMARY KEY);` },
  { name: "0001_b.sql", sql: `CREATE TABLE "memberships" ("id" uuid PRIMARY KEY);\n--> statement-breakpoint\nALTER TABLE "memberships" ADD CONSTRAINT "m1" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");` },
];

test("describeDatabaseTarget: reports \"not configured\" when no connection string is given, rather than throwing", () => {
  assert.deepEqual(describeDatabaseTarget(undefined), { configured: false });
  assert.deepEqual(describeDatabaseTarget(""), { configured: false });
});

test("describeDatabaseTarget: extracts host/port/database/user and NEVER exposes the real password", () => {
  const result = describeDatabaseTarget("postgresql://myuser:supersecretpassword@db.example.com:5432/mydb?sslmode=require");
  assert.equal(result.configured, true);
  assert.equal(result.host, "db.example.com");
  assert.equal(result.port, "5432");
  assert.equal(result.database, "mydb");
  assert.equal(result.user, "myuser");
  assert.ok(!result.password.includes("supersecretpassword"), "the real password must never appear in the parsed result");
  assert.doesNotMatch(JSON.stringify(result), /supersecretpassword/);
});

test("describeDatabaseTarget: defaults port to 5432 when the URL omits it", () => {
  const result = describeDatabaseTarget("postgresql://myuser:pw@db.example.com/mydb");
  assert.equal(result.port, "5432");
});

test("describeDatabaseTarget: throws a clear error on a malformed connection string, not a cryptic URL parser error", () => {
  assert.throws(() => describeDatabaseTarget("not-a-valid-url"), /Chaîne de connexion invalide/);
});

test("buildPreflightReport: never opens a connection — the underlying engine call is dryRun:true with no client, same as Phase 3", async () => {
  const report = await buildPreflightReport({
    files: OK_FILES,
    targetSchema: "preview",
    connectionString: "postgresql://myuser:pw@db.example.com:5432/mydb",
    connectionEnvVarName: "PREVIEW_SCHEMA_DATABASE_URL",
  });
  assert.equal(report.targetSchema, "preview");
  assert.equal(report.connectionEnvVarName, "PREVIEW_SCHEMA_DATABASE_URL");
  assert.equal(report.database.configured, true);
  assert.equal(report.database.host, "db.example.com");
  assert.deepEqual(report.migrationFiles, ["0000_a.sql", "0001_b.sql"]);
  assert.equal(report.statements[0].sql, `CREATE SCHEMA IF NOT EXISTS "preview"`);
  assert.equal(report.statements[1].sql, `SET LOCAL search_path TO "preview"`);
  assert.equal(report.statementCount, 5);
  assert.ok(report.statements.every((s) => !/public/i.test(s.sql)));
});

test("buildPreflightReport: reports the unconfigured state cleanly when the env var isn't set, still returns the SQL plan", async () => {
  const report = await buildPreflightReport({
    files: OK_FILES,
    targetSchema: "preview",
    connectionString: undefined,
    connectionEnvVarName: "PREVIEW_SCHEMA_DATABASE_URL",
  });
  assert.equal(report.database.configured, false);
  assert.equal(report.statementCount, 5, "the SQL plan must still be fully computable even with no DB configured");
});

test("buildPreflightReport: separates checks already run (guards 1-3) from checks pending real execution (guards 4-6)", async () => {
  const report = await buildPreflightReport({
    files: OK_FILES,
    targetSchema: "preview",
    connectionString: undefined,
    connectionEnvVarName: "PREVIEW_SCHEMA_DATABASE_URL",
  });
  assert.equal(report.checksAlreadyRun.length, 3);
  assert.equal(report.checksPendingRealExecution.length, 3);
  assert.ok(report.checksPendingRealExecution.every((c) => /PAS encore exécuté/.test(c)), "pending checks must be explicitly labeled as not yet run");
});

test("buildPreflightReport: refuses \"public\" as a target schema before building anything, same as the engine", async () => {
  await assert.rejects(() =>
    buildPreflightReport({ files: OK_FILES, targetSchema: "public", connectionString: undefined, connectionEnvVarName: "X" }),
  );
});

test("formatPreflightReport: ends with the mandatory explicit confirmation that no SQL was sent", async () => {
  const report = await buildPreflightReport({
    files: OK_FILES,
    targetSchema: "preview",
    connectionString: undefined,
    connectionEnvVarName: "PREVIEW_SCHEMA_DATABASE_URL",
  });
  const text = formatPreflightReport(report);
  assert.match(text, /aucune commande SQL n'a été envoyée au serveur/i);
  assert.match(text, /aucune connexion PostgreSQL n'a été ouverte/i);
});

test("formatPreflightReport: never leaks a real password into the printed report", async () => {
  const report = await buildPreflightReport({
    files: OK_FILES,
    targetSchema: "preview",
    connectionString: "postgresql://myuser:supersecretpassword@db.example.com:5432/mydb",
    connectionEnvVarName: "PREVIEW_SCHEMA_DATABASE_URL",
  });
  const text = formatPreflightReport(report);
  assert.doesNotMatch(text, /supersecretpassword/);
});

test("formatPreflightReport: lists every migration file and every SQL statement in exact order", async () => {
  const report = await buildPreflightReport({
    files: OK_FILES,
    targetSchema: "preview",
    connectionString: undefined,
    connectionEnvVarName: "PREVIEW_SCHEMA_DATABASE_URL",
  });
  const text = formatPreflightReport(report);
  assert.match(text, /0000_a\.sql/);
  assert.match(text, /0001_b\.sql/);
  assert.match(text, /\[1\/5\].*CREATE SCHEMA/);
  assert.match(text, /\[2\/5\].*SET LOCAL search_path/);
});

test("integration: preflight report over all 13 real db/migrations files matches the Phase 3 dry-run plan exactly", async () => {
  const dir = join("db", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  assert.equal(files.length, 13);

  const report = await buildPreflightReport({
    files,
    targetSchema: "preview",
    connectionString: undefined,
    connectionEnvVarName: "PREVIEW_SCHEMA_DATABASE_URL",
  });
  assert.equal(report.statementCount, 205);
  assert.equal(report.migrationFiles.length, 13);
  for (const { sql } of report.statements) {
    assert.equal((sql.match(/public/gi) ?? []).length, 0);
  }
});
