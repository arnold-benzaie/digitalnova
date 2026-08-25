// Pure static check — no database connection, no imports of the module
// itself (which requires "server-only" + a live DATABASE_URL to import
// cleanly). Reads the source text directly and asserts the READ-ONLY
// guarantee structurally: no Drizzle write call, no export whose name
// suggests a mutation. This is deliberately independent of
// queries.integration.test.mjs so it can catch a regression even if
// nobody remembers to add a new integration test for a new export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "queries.ts"), "utf8");

test("queries.ts never calls a Drizzle write method", () => {
  for (const forbidden of ["db.insert(", "db.update(", "db.delete(", ".onConflictDoUpdate(", ".returning("]) {
    assert.ok(!source.includes(forbidden), `found forbidden write call: ${forbidden}`);
  }
});

test("queries.ts exports no function named like a mutation", () => {
  const exportedNames = [...source.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
  assert.ok(exportedNames.length > 0, "sanity check: the regex above must actually find exports");
  const forbiddenVerbs = /^(insert|create|update|delete|remove|upsert|seed|mutate|save|write|set|patch)/i;
  for (const name of exportedNames) {
    assert.ok(!forbiddenVerbs.test(name), `export "${name}" reads like a mutation, not a read`);
  }
});
