import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePublicSchemaReferences, validateAllMigrationFiles } from "./preview-schema-migration-validator.mjs";

test("accepts a file with no mention of \"public\" at all", () => {
  const sql = `CREATE TABLE "widgets" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL);`;
  const result = validatePublicSchemaReferences(sql, "0000_test.sql");
  assert.equal(result.totalMentions, 0);
  assert.equal(result.handledMentions, 0);
});

test("accepts the exact handled pattern: REFERENCES \"public\".\"table\"", () => {
  const sql = `ALTER TABLE "memberships" ADD CONSTRAINT "x" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;`;
  const result = validatePublicSchemaReferences(sql, "0000_test.sql");
  assert.equal(result.totalMentions, 1);
  assert.equal(result.handledMentions, 1);
});

test("accepts multiple handled references in the same file", () => {
  const sql = [
    `ALTER TABLE "a" ADD CONSTRAINT "a1" FOREIGN KEY ("x") REFERENCES "public"."users"("id");`,
    `ALTER TABLE "b" ADD CONSTRAINT "b1" FOREIGN KEY ("y") REFERENCES "public"."organizations"("id");`,
  ].join("\n");
  const result = validatePublicSchemaReferences(sql, "0000_test.sql");
  assert.equal(result.totalMentions, 2);
  assert.equal(result.handledMentions, 2);
});

test("rejects CREATE INDEX ... ON \"public\".\"table\"", () => {
  const sql = `CREATE INDEX "foo_idx" ON "public"."foo" USING btree ("bar");`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0010_new.sql"), /forme SQL non gérée/);
});

test("rejects a column DEFAULT calling a public-schema function", () => {
  const sql = `ALTER TABLE "x" ALTER COLUMN "y" SET DEFAULT public.some_fn();`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0010_new.sql"), /forme SQL non gérée/);
});

test("rejects an unquoted public.\"Table\" reference (not the exact quoted+anchored pattern)", () => {
  const sql = `ALTER TABLE "x" ADD CONSTRAINT "x1" FOREIGN KEY ("y") REFERENCES public."Table"("id");`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0010_new.sql"), /forme SQL non gérée/);
});

test("rejects CREATE VIEW in the public schema", () => {
  const sql = `CREATE VIEW "public"."my_view" AS SELECT * FROM "users";`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0010_new.sql"), /forme SQL non gérée/);
});

test("rejects CREATE FUNCTION in the public schema", () => {
  const sql = `CREATE FUNCTION "public"."my_func"() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0010_new.sql"), /forme SQL non gérée/);
});

test("rejects an uppercase \"PUBLIC\" schema reference (different, case-sensitive identifier — never silently treated as the same schema)", () => {
  const sql = `ALTER TABLE "x" ADD CONSTRAINT "x1" FOREIGN KEY ("y") REFERENCES "PUBLIC"."users"("id");`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0010_new.sql"), /forme SQL non gérée/);
});

test("deliberately over-eager: flags an unrelated word containing \"public\" as a substring (e.g. a hypothetical comment)", () => {
  const sql = `-- publications table\nCREATE TABLE "publications" ("id" uuid PRIMARY KEY);`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0010_new.sql"), /forme SQL non gérée/);
});

test("error message names the offending file", () => {
  const sql = `CREATE INDEX "x" ON "public"."foo" ("bar");`;
  assert.throws(() => validatePublicSchemaReferences(sql, "0099_offender.sql"), /0099_offender\.sql/);
});

test("validateAllMigrationFiles passes through per-file results when everything is clean", () => {
  const files = [
    { name: "0000_a.sql", sql: `CREATE TABLE "a" ("id" uuid PRIMARY KEY);` },
    { name: "0001_b.sql", sql: `ALTER TABLE "b" ADD CONSTRAINT "b1" FOREIGN KEY ("x") REFERENCES "public"."a"("id");` },
  ];
  const results = validateAllMigrationFiles(files);
  assert.equal(results.length, 2);
  assert.equal(results[0].handledMentions, 0);
  assert.equal(results[1].handledMentions, 1);
});

test("validateAllMigrationFiles stops at the first offending file and names it", () => {
  const files = [
    { name: "0000_a.sql", sql: `CREATE TABLE "a" ("id" uuid PRIMARY KEY);` },
    { name: "0001_bad.sql", sql: `CREATE INDEX "x" ON "public"."a" ("id");` },
    { name: "0002_c.sql", sql: `CREATE TABLE "c" ("id" uuid PRIMARY KEY);` },
  ];
  assert.throws(() => validateAllMigrationFiles(files), /0001_bad\.sql/);
});
