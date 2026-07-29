import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transformMigrationToSchema, validateAndTransform, validateAndTransformAll } from "./preview-schema-migration-transformer.mjs";

test("rewrites the exact handled pattern to the target schema", () => {
  const sql = `ALTER TABLE "memberships" ADD CONSTRAINT "x" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;`;
  const result = transformMigrationToSchema(sql, "preview");
  assert.equal(result, `ALTER TABLE "memberships" ADD CONSTRAINT "x" FOREIGN KEY ("user_id") REFERENCES "preview"."users"("id") ON DELETE cascade ON UPDATE no action;`);
});

test("rewrites every occurrence in a multi-statement file", () => {
  const sql = [
    `ALTER TABLE "a" ADD CONSTRAINT "a1" FOREIGN KEY ("x") REFERENCES "public"."users"("id");`,
    `ALTER TABLE "b" ADD CONSTRAINT "b1" FOREIGN KEY ("y") REFERENCES "public"."organizations"("id");`,
  ].join("\n");
  const result = transformMigrationToSchema(sql, "preview");
  assert.equal((result.match(/REFERENCES "preview"\./g) ?? []).length, 2);
  assert.equal((result.match(/REFERENCES "public"\./g) ?? []).length, 0);
});

test("is a no-op on a file with no \"public\" reference — passes through byte-for-byte", () => {
  const sql = `CREATE TABLE "widgets" (\n\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL\n);`;
  assert.equal(transformMigrationToSchema(sql, "preview"), sql);
});

test("never touches CREATE TABLE, column definitions, or statement-breakpoint markers", () => {
  const sql = `CREATE TABLE "memberships" (\n\t"id" uuid PRIMARY KEY,\n\t"user_id" uuid NOT NULL\n);\n--> statement-breakpoint\nALTER TABLE "memberships" ADD CONSTRAINT "x" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");`;
  const result = transformMigrationToSchema(sql, "preview");
  assert.match(result, /CREATE TABLE "memberships" \(\n\t"id" uuid PRIMARY KEY,\n\t"user_id" uuid NOT NULL\n\);/);
  assert.match(result, /--> statement-breakpoint/);
  assert.match(result, /REFERENCES "preview"\."users"/);
});

test("uses whatever target schema name is passed, not a hardcoded \"preview\"", () => {
  const sql = `ALTER TABLE "a" ADD CONSTRAINT "a1" FOREIGN KEY ("x") REFERENCES "public"."users"("id");`;
  const result = transformMigrationToSchema(sql, "some_other_schema");
  assert.match(result, /REFERENCES "some_other_schema"\."users"/);
});

test("rejects an unsafe/malformed target schema name rather than interpolating it blindly", () => {
  const sql = `ALTER TABLE "a" ADD CONSTRAINT "a1" FOREIGN KEY ("x") REFERENCES "public"."users"("id");`;
  assert.throws(() => transformMigrationToSchema(sql, 'preview"; DROP TABLE users; --'), /Nom de schéma cible invalide/);
  assert.throws(() => transformMigrationToSchema(sql, ""), /Nom de schéma cible invalide/);
  assert.throws(() => transformMigrationToSchema(sql, "Preview"), /Nom de schéma cible invalide/); // uppercase not allowed — keep it simple/predictable
});

test("validateAndTransform refuses to transform a file that hasn't passed validation", () => {
  const file = { name: "0010_bad.sql", sql: `CREATE INDEX "x" ON "public"."foo" ("bar");` };
  assert.throws(() => validateAndTransform(file, "preview"), /forme SQL non gérée/);
});

test("validateAndTransform returns the transformed SQL for a valid file", () => {
  const file = { name: "0000_ok.sql", sql: `ALTER TABLE "a" ADD CONSTRAINT "a1" FOREIGN KEY ("x") REFERENCES "public"."users"("id");` };
  const result = validateAndTransform(file, "preview");
  assert.equal(result.name, "0000_ok.sql");
  assert.match(result.sql, /REFERENCES "preview"\."users"/);
});

test("validateAndTransformAll stops at the first invalid file, transforms nothing from it", () => {
  const files = [
    { name: "0000_ok.sql", sql: `CREATE TABLE "a" ("id" uuid PRIMARY KEY);` },
    { name: "0001_bad.sql", sql: `CREATE INDEX "x" ON "public"."a" ("id");` },
  ];
  assert.throws(() => validateAndTransformAll(files, "preview"), /0001_bad\.sql/);
});

test("integration: transforming all 19 real db/migrations files leaves zero \"public\" mentions", () => {
  const dir = join("db", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));

  assert.equal(files.length, 19, "expected exactly the 19 known migration files (including 0018 for integration_api_keys.last_used_ip and webhook_delivery_attempts headers) — re-check this test if the count legitimately changed");

  const transformed = validateAndTransformAll(files, "preview");
  for (const { name, sql } of transformed) {
    const remaining = (sql.match(/public/gi) ?? []).length;
    assert.equal(remaining, 0, `${name} still mentions "public" ${remaining} time(s) after transformation`);
    assert.ok(/preview/.test(sql) || !/REFERENCES/.test(sql), `${name} : transformation ne semble pas avoir été appliquée`);
  }
});
