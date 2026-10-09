// 4F.14-E — pure unit coverage for the accepted FK-name truncation
// exceptions of scripts/migration-replay-check.mjs. No Docker, no database:
// the script's main() only runs when invoked directly, so importing it here
// exposes its helpers without starting a container. The real-Postgres side
// of the same check (the truncation actually happening, and the relation
// read back from pg_catalog) is `npm run db:verify:migrations` itself.
//
// Run with: npx tsx --test scripts/migration-replay-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const { KNOWN_FK_NAME_TRUNCATIONS, isKnownFkNameTruncation, legacyFkDefinitionDiffs } = await import("./migration-replay-check.mjs");

const LEDGER_FK = "discovery_budget_ledger_reservation_id_discovery_budget_reservations_id_fk";
// The name PostgreSQL 16 actually stored on a fresh replay (4F.14-D run).
const LEDGER_FK_STORED = "discovery_budget_ledger_reservation_id_discovery_budget_reserva";

function latestSnapshotForeignKeys() {
  const dir = "db/migrations/meta";
  const file = readdirSync(dir).filter((f) => /^\d{4}_snapshot\.json$/.test(f)).sort().at(-1);
  const snap = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  return Object.values(snap.tables).flatMap((t) => Object.values(t.foreignKeys ?? {}));
}

function ledgerEntry() {
  return KNOWN_FK_NAME_TRUNCATIONS.find((kt) => kt.snapshotName === LEDGER_FK);
}

function pgCatalogDefinition(entry, overrides = {}) {
  return {
    storedName: entry.storedName,
    constraintType: "FOREIGN KEY",
    sourceTable: entry.fromTable,
    sourceColumns: [...entry.fromColumns],
    referencedTable: entry.toTable,
    referencedColumns: [...entry.toColumns],
    onDelete: entry.onDelete,
    ...overrides,
  };
}

test("exactly three accepted truncations, each over 63 bytes and stored as its own 63-byte prefix", () => {
  assert.equal(KNOWN_FK_NAME_TRUNCATIONS.length, 3);
  for (const kt of KNOWN_FK_NAME_TRUNCATIONS) {
    assert.ok(Buffer.byteLength(kt.snapshotName) > 63, `${kt.snapshotName} must actually exceed NAMEDATALEN`);
    assert.equal(kt.storedName, kt.snapshotName.slice(0, 63));
    assert.equal(Buffer.byteLength(kt.storedName), 63);
  }
});

test("the 0047 ledger FK is stored under the exact name PostgreSQL produced", () => {
  assert.equal(ledgerEntry()?.storedName, LEDGER_FK_STORED);
});

test("every accepted truncation records the same relation as the latest drizzle snapshot", () => {
  const snapFks = latestSnapshotForeignKeys();
  for (const kt of KNOWN_FK_NAME_TRUNCATIONS) {
    const fk = snapFks.find((f) => f.name === kt.snapshotName);
    assert.ok(fk, `${kt.snapshotName} must exist in the latest snapshot`);
    assert.equal(fk.tableFrom, kt.fromTable);
    assert.deepEqual(fk.columnsFrom, kt.fromColumns);
    assert.equal(fk.tableTo, kt.toTable);
    assert.deepEqual(fk.columnsTo, kt.toColumns);
    assert.equal(fk.onDelete.toUpperCase(), kt.onDelete);
  }
});

test("the ledger exception matches migration 0047's own DDL (reservation_id -> discovery_budget_reservations.id, ON DELETE SET NULL)", () => {
  const sql = readFileSync("db/migrations/0047_chilly_ink.sql", "utf8");
  const ddl = sql.split("--> statement-breakpoint").find((s) => s.includes(`"${LEDGER_FK}"`));
  assert.ok(ddl, "0047 must declare the ledger FK");
  assert.match(ddl, /ALTER TABLE "discovery_budget_ledger" ADD CONSTRAINT/);
  assert.match(ddl, /FOREIGN KEY \("reservation_id"\) REFERENCES "public"\."discovery_budget_reservations"\("id"\)/);
  assert.match(ddl, /ON DELETE set null/);
  assert.deepEqual(
    { from: ledgerEntry().fromTable, cols: ledgerEntry().fromColumns, to: ledgerEntry().toTable, toCols: ledgerEntry().toColumns, onDelete: ledgerEntry().onDelete },
    { from: "discovery_budget_ledger", cols: ["reservation_id"], to: "discovery_budget_reservations", toCols: ["id"], onDelete: "SET NULL" },
  );
});

test("no other snapshot FK exceeds 63 bytes — a new over-long name is never silently covered", () => {
  const accepted = new Set(KNOWN_FK_NAME_TRUNCATIONS.map((kt) => kt.snapshotName));
  const overLong = latestSnapshotForeignKeys().filter((f) => Buffer.byteLength(f.name) > 63).map((f) => f.name);
  assert.deepEqual(overLong.filter((n) => !accepted.has(n)), []);
});

test("isKnownFkNameTruncation accepts only the exact (snapshot name, source table, stored name) triples", () => {
  for (const kt of KNOWN_FK_NAME_TRUNCATIONS) {
    assert.equal(isKnownFkNameTruncation({ name: kt.snapshotName, tableFrom: kt.fromTable }, kt.storedName), true);
  }
  assert.equal(isKnownFkNameTruncation({ name: LEDGER_FK, tableFrom: "discovery_budget_ledger" }, LEDGER_FK_STORED.slice(0, 62)), false);
  assert.equal(isKnownFkNameTruncation({ name: LEDGER_FK, tableFrom: "discovery_budget_reservations" }, LEDGER_FK_STORED), false);
  const unknown = "some_other_table_some_column_id_some_far_too_long_target_table_id_fk";
  assert.equal(isKnownFkNameTruncation({ name: unknown, tableFrom: "some_other_table" }, unknown.slice(0, 63)), false);
});

test("legacyFkDefinitionDiffs: the correct pg_catalog relation of every exception verifies with no difference", () => {
  for (const kt of KNOWN_FK_NAME_TRUNCATIONS) {
    assert.deepEqual(legacyFkDefinitionDiffs(kt, pgCatalogDefinition(kt)), []);
  }
});

test("legacyFkDefinitionDiffs: the ledger FK is rejected if its real relation differs in any way", () => {
  const kt = ledgerEntry();
  const cases = {
    "ON DELETE CASCADE": { onDelete: "CASCADE" },
    "ON DELETE NO ACTION": { onDelete: "NO ACTION" },
    "wrong referenced table": { referencedTable: "discovery_budget_ledger" },
    "wrong referenced column": { referencedColumns: ["reservation_id"] },
    "wrong source table": { sourceTable: "discovery_budget_reservations" },
    "wrong source column": { sourceColumns: ["id"] },
    "not a foreign key": { constraintType: "u" },
  };
  for (const [label, overrides] of Object.entries(cases)) {
    assert.ok(legacyFkDefinitionDiffs(kt, pgCatalogDefinition(kt, overrides)).length > 0, `${label} must be a difference`);
  }
  assert.equal(legacyFkDefinitionDiffs(kt, null).length, 1, "a missing constraint must be a difference");
});

test("legacyFkDefinitionDiffs: the two historical CASCADE exceptions still reject SET NULL", () => {
  for (const kt of KNOWN_FK_NAME_TRUNCATIONS.filter((e) => e.snapshotName !== LEDGER_FK)) {
    assert.equal(kt.onDelete, "CASCADE");
    assert.ok(legacyFkDefinitionDiffs(kt, pgCatalogDefinition(kt, { onDelete: "SET NULL" })).length > 0);
  }
});
