import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPreviewSchemaMigrations, ExecutionEngineError } from "./preview-schema-execution-engine.mjs";

/**
 * In-memory test double — never opens a socket, never talks to any real
 * Postgres instance (local or remote). Matches the minimal `query(sql,
 * params?)` shape the engine expects. `existingTableCount` simulates what
 * a real `information_schema.tables` count query would return; `failOn`
 * lets a test simulate a mid-batch failure to prove rollback behavior.
 */
function makeFakeClient({ existingTableCount = 0, failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT count(*)")) {
        return { rows: [{ count: existingTableCount }] };
      }
      if (failOn && sql.includes(failOn)) {
        throw new Error(`simulated failure on: ${failOn}`);
      }
      return { rows: [] };
    },
  };
}

const OK_FILES = [
  { name: "0000_a.sql", sql: `CREATE TABLE "users" ("id" uuid PRIMARY KEY);` },
  { name: "0001_b.sql", sql: `CREATE TABLE "memberships" ("id" uuid PRIMARY KEY);\n--> statement-breakpoint\nALTER TABLE "memberships" ADD CONSTRAINT "m1" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");` },
];

test("refuses \"public\" as a target schema, before touching validation or any client", async () => {
  await assert.rejects(
    () => applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "public", dryRun: true }),
    ExecutionEngineError,
  );
});

test("refuses other reserved schema names", async () => {
  for (const bad of ["pg_catalog", "information_schema", "PUBLIC", ""]) {
    await assert.rejects(() => applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: bad, dryRun: true }), ExecutionEngineError);
  }
});

test("dry run: no client required, none contacted, returns the full statement plan", async () => {
  const result = await applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.applied, false);
  assert.equal(result.statements[0].sql, `CREATE SCHEMA IF NOT EXISTS "preview"`);
  assert.equal(result.statements[1].sql, `SET LOCAL search_path TO "preview"`);
  assert.equal(result.statementCount, 5); // CREATE SCHEMA + SET LOCAL + 0000's 1 statement + 0001's 2 statements
  assert.ok(result.statements.every((s) => !/public/i.test(s.sql)), "no statement should mention \"public\" after transformation");
});

test("SET LOCAL search_path is the second statement, immediately after CREATE SCHEMA and before every unqualified CREATE TABLE/ALTER TABLE", async () => {
  const result = await applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", dryRun: true });
  const setLocalIndex = result.statements.findIndex((s) => s.sql === `SET LOCAL search_path TO "preview"`);
  assert.equal(setLocalIndex, 1, "SET LOCAL must be the second statement, right after CREATE SCHEMA");

  const unqualifiedIndexes = result.statements
    .map((s, i) => ({ i, sql: s.sql }))
    .filter(({ sql }) => /^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE)/.test(sql))
    .map(({ i }) => i);
  assert.ok(unqualifiedIndexes.length > 0, "test fixture should contain at least one unqualified statement");
  assert.ok(unqualifiedIndexes.every((i) => i > setLocalIndex), "every unqualified statement must come after SET LOCAL search_path");
});

test("uses the actual target schema name in SET LOCAL, not a hardcoded \"preview\"", async () => {
  const result = await applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "some_other_schema", dryRun: true });
  assert.equal(result.statements[1].sql, `SET LOCAL search_path TO "some_other_schema"`);
});

test("dry run never invokes a client even if one is (incorrectly) passed", async () => {
  const client = makeFakeClient();
  await applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", dryRun: true, client });
  assert.equal(client.calls.length, 0);
});

test("real run without a client is refused explicitly, not silently skipped", async () => {
  await assert.rejects(
    () => applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", dryRun: false }),
    ExecutionEngineError,
  );
});

test("propagates an unrecognized SQL form from Phase 1 validation before ever building a client query", async () => {
  const badFiles = [{ name: "0010_bad.sql", sql: `CREATE INDEX "x" ON "public"."foo" ("bar");` }];
  const client = makeFakeClient();
  await assert.rejects(() => applyPreviewSchemaMigrations({ files: badFiles, targetSchema: "preview", client }), /forme SQL non gérée/);
  assert.equal(client.calls.length, 0, "the client must never be touched if validation fails first");
});

test("real run: checks existing table count, then BEGIN, each statement, COMMIT — in that exact order", async () => {
  const client = makeFakeClient({ existingTableCount: 0 });
  const result = await applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", client });
  assert.equal(result.applied, true);

  const sqlSequence = client.calls.map((c) => c.sql);
  assert.match(sqlSequence[0], /SELECT count\(\*\)/);
  assert.equal(sqlSequence[1], "BEGIN");
  assert.equal(sqlSequence[2], `CREATE SCHEMA IF NOT EXISTS "preview"`);
  assert.equal(sqlSequence[3], `SET LOCAL search_path TO "preview"`, "SET LOCAL must be sent as a real query on this same client, inside the transaction");
  assert.equal(sqlSequence.at(-1), "COMMIT");
  assert.ok(!sqlSequence.includes("ROLLBACK"));
});

test("real run: refuses to proceed if the target schema already has tables, unless allowExisting is set", async () => {
  const client = makeFakeClient({ existingTableCount: 3 });
  await assert.rejects(() => applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", client }), ExecutionEngineError);
  assert.ok(!client.calls.some((c) => c.sql === "BEGIN"), "must never start a transaction once the existing-table guard refuses");
});

test("real run: allowExisting: true proceeds even with existing tables", async () => {
  const client = makeFakeClient({ existingTableCount: 3 });
  const result = await applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", client, allowExisting: true });
  assert.equal(result.applied, true);
});

test("real run: a mid-batch failure rolls back and never commits", async () => {
  const client = makeFakeClient({ failOn: "ALTER TABLE \"memberships\"" });
  await assert.rejects(() => applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", client }), /simulated failure/);

  const sqlSequence = client.calls.map((c) => c.sql);
  assert.ok(sqlSequence.includes("BEGIN"));
  assert.ok(sqlSequence.includes("ROLLBACK"));
  assert.ok(!sqlSequence.includes("COMMIT"), "COMMIT must never run after a failed statement");
});

test("real run: SET LOCAL search_path is sent inside the same transaction that later gets rolled back", async () => {
  // This only proves the engine SENDS `SET LOCAL search_path` as a normal
  // query before the failing statement, inside the same BEGIN...ROLLBACK
  // block — i.e. it never runs outside a transaction. Whether that setting
  // is actually discarded on ROLLBACK is a guarantee PostgreSQL itself makes
  // for LOCAL settings (see the module docstring and the SET docs); this
  // fake in-memory client has no transactional state to roll back, so it
  // cannot demonstrate that part — only a real Postgres connection could,
  // which remains out of scope until Phase 4.
  const client = makeFakeClient({ failOn: "ALTER TABLE \"memberships\"" });
  await assert.rejects(() => applyPreviewSchemaMigrations({ files: OK_FILES, targetSchema: "preview", client }), /simulated failure/);

  const sqlSequence = client.calls.map((c) => c.sql);
  const beginIndex = sqlSequence.indexOf("BEGIN");
  const setLocalIndex = sqlSequence.indexOf(`SET LOCAL search_path TO "preview"`);
  const rollbackIndex = sqlSequence.indexOf("ROLLBACK");
  assert.ok(setLocalIndex > beginIndex, "SET LOCAL must run after BEGIN");
  assert.ok(setLocalIndex < rollbackIndex, "SET LOCAL must run before ROLLBACK, i.e. inside the same transaction");
});

test("integration: dry-running the engine against all 23 real db/migrations files produces a clean, fully-preview-qualified plan", async () => {
  const dir = join("db", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  assert.equal(files.length, 23);

  const result = await applyPreviewSchemaMigrations({ files, targetSchema: "preview", dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.statements[0].sql, `CREATE SCHEMA IF NOT EXISTS "preview"`);
  assert.equal(result.statements[1].sql, `SET LOCAL search_path TO "preview"`);
  assert.ok(result.statementCount > 10, "expected well more than one statement per file across 18 migrations");
  for (const { file, sql } of result.statements) {
    assert.equal((sql.match(/public/gi) ?? []).length, 0, `${file} : une instruction du plan mentionne encore "public"`);
  }
});
