#!/usr/bin/env node
/**
 * PUBLIC-MAP — catalogue data seed — PRODUCTION `public` schema ONLY.
 *
 * Deliberately a SEPARATE file from scripts/catalogue-preview-seed.mjs
 * rather than a shared script with a target parameter — that script is
 * intentionally hardcoded to the `preview` schema and PREVIEW_SCHEMA_
 * DATABASE_URL; giving it a target argument would make "which database
 * am I about to write to" a runtime decision instead of a file-level one,
 * exactly the ambiguity this script exists to avoid.
 *
 * Safety guards, each a hard refusal before any row is written:
 *   - refuses if VERCEL_ENV === "preview" (this must only ever run from a
 *     human's own machine or a Production-context job, never a Preview
 *     deployment or Preview CI run);
 *   - refuses if PREVIEW_SCHEMA_DATABASE_URL is present in the process
 *     environment at all — never read as a connection source, and its
 *     mere presence is treated as a signal this isn't a clean Production
 *     context;
 *   - reads DATABASE_URL only;
 *   - refuses unless a live `SELECT current_schema()` returns exactly
 *     "public";
 *   - refuses unless all 4 catalogue tables already exist (this script
 *     seeds data, it never runs DDL — migration 0029 must already be
 *     applied through the normal Drizzle migration path);
 *   - refuses unless migration 0029_heavy_the_fallen is recorded in
 *     drizzle.__drizzle_migrations, matched against the `when` timestamp
 *     Drizzle itself wrote there — read from db/migrations/meta/_journal.json
 *     at runtime, never hardcoded, so this stays correct if migrations are
 *     regenerated;
 *   - refuses if the canonical dataset doesn't pass the same structural
 *     invariants as the Preview seed script (counts, no nested pack, the
 *     explicitly-rejected pack_local_growth -> pack_gbp_seo_launch pair,
 *     no NOT NULL gaps) — re-validated here, never assumed already checked;
 *   - refuses if any market_offers row's market/currency pairing is wrong
 *     (belt-and-suspenders on top of the DB's own CHECK constraint);
 *   - refuses if the final per-table row count doesn't exactly match the
 *     canonical dataset's own count — these are brand-new tables, so
 *     "more rows than the canonical dataset" after insertion is itself
 *     treated as an unexpected final state, not silently accepted.
 * No bypass flag exists for any of the above — every refusal exits
 * non-zero before COMMIT is ever reached.
 *
 * Everything (validation + INSERT + count verification) runs inside one
 * transaction. ON CONFLICT DO NOTHING on the real unique constraint of
 * each table — a row that already exists is left completely untouched,
 * this script never issues an UPDATE.
 *
 * Usage:
 *   npx tsx scripts/catalogue-production-seed.mjs
 *     → dry-run (default): runs every check and every INSERT for real
 *       inside the transaction, verifies final counts, then ALWAYS rolls
 *       back — nothing is ever persisted in this mode, regardless of
 *       outcome.
 *   npx tsx scripts/catalogue-production-seed.mjs --execute
 *     → same checks and inserts, then asks to type APPLY before COMMIT.
 *       Typing anything else rolls back.
 */
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";
import { SERVICES, MARKET_OFFERS, RELATIONS, LEGACY_IDENTIFIERS } from "../db/catalogue/canonical-dataset.mjs";

config({ path: ".env.local" });

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_SCHEMA = "public";
const MIGRATION_TAG = "0029_heavy_the_fallen";
const CATALOGUE_TABLES = ["services", "service_market_offers", "service_relations", "service_legacy_identifiers"];
const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = !EXECUTE || process.argv.includes("--dry-run");

function fail(reason) {
  console.error(`\nÉCHEC — ${reason}`);
  console.error("Arrêt — aucune base de données n'a été touchée au-delà de ce point.");
  process.exit(1);
}

// ---- environment guards (before any DB connection is opened) ----

if (process.env.VERCEL_ENV === "preview") {
  fail('VERCEL_ENV === "preview" — ce script ne doit jamais s\'exécuter depuis un contexte Preview.');
}
if (process.env.PREVIEW_SCHEMA_DATABASE_URL) {
  fail("PREVIEW_SCHEMA_DATABASE_URL est présente dans l'environnement — refus par précaution, jamais lue comme source par ce script.");
}
if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL n'est pas définie. Rien n'a été tenté.");
}

// ---- structural + NOT NULL validation of the canonical dataset (no DB connection needed) ----

const NOT_NULL_SERVICE_FIELDS = ["serviceId", "type", "category", "priceDerivation", "displayNameFr", "displayNameEn", "descriptionFr", "descriptionEn"];
const nullViolations = [];
for (const s of SERVICES) {
  for (const field of NOT_NULL_SERVICE_FIELDS) {
    if (s[field] === null || s[field] === undefined) nullViolations.push(`services.${s.serviceId}.${field}`);
  }
}

if (SERVICES.length !== 32) fail(`services count mismatch: expected 32, got ${SERVICES.length}`);
if (MARKET_OFFERS.length !== 52) fail(`market_offers count mismatch: expected 52, got ${MARKET_OFFERS.length}`);
const packIncludes = RELATIONS.filter((r) => r.relationType === "PACK_INCLUDES");
const duoIncludes = RELATIONS.filter((r) => r.relationType === "DUO_INCLUDES");
if (RELATIONS.length !== 19 || packIncludes.length !== 7 || duoIncludes.length !== 12) {
  fail(`relations count mismatch: expected 19 (7 PACK_INCLUDES + 12 DUO_INCLUDES), got ${RELATIONS.length} (${packIncludes.length}/${duoIncludes.length})`);
}
if (LEGACY_IDENTIFIERS.length !== 30) fail(`legacy_identifiers count mismatch: expected 30, got ${LEGACY_IDENTIFIERS.length}`);

const typeOf = Object.fromEntries(SERVICES.map((s) => [s.serviceId, s.type]));
for (const r of packIncludes) {
  if (typeOf[r.childServiceId] === "PACK") fail(`nested pack relation detected: ${r.parentServiceId} -> ${r.childServiceId} (child is itself a PACK)`);
}
const forbiddenPair = RELATIONS.some((r) => r.parentServiceId === "pack_local_growth" && r.childServiceId === "pack_gbp_seo_launch");
if (forbiddenPair) fail("pack_local_growth -> pack_gbp_seo_launch is present but was explicitly rejected (Option B decision)");

const marketCurrencyViolations = MARKET_OFFERS.filter(
  (o) => !((o.market === "CANADA" && o.currency === "CAD") || (o.market === "EUROPE" && o.currency === "EUR")),
);
if (marketCurrencyViolations.length > 0) {
  fail(`${marketCurrencyViolations.length} market/currency mismatch(es) in the canonical dataset: ${marketCurrencyViolations.map((o) => `${o.serviceId}:${o.market}/${o.currency}`).join(", ")}`);
}

if (nullViolations.length > 0) {
  fail(`${nullViolations.length} NOT NULL violation(s): ${nullViolations.join(", ")}`);
}

// ---- migration journal lookup (file read only, no DB connection yet) ----

const journalPath = join(HERE, "..", "db", "migrations", "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const migrationEntry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
if (!migrationEntry) {
  fail(`${MIGRATION_TAG} introuvable dans ${journalPath} — le dépôt lui-même semble incohérent.`);
}

console.log("══════════════════════════════════════════════════════════════════════");
console.log("PUBLIC-MAP — Catalogue data seed — schéma PRODUCTION (public) uniquement");
console.log("══════════════════════════════════════════════════════════════════════\n");
console.log(`Dataset : services=${SERVICES.length}, market_offers=${MARKET_OFFERS.length}, relations=${RELATIONS.length} (PACK=${packIncludes.length}, DUO=${duoIncludes.length}), legacy_identifiers=${LEGACY_IDENTIFIERS.length}`);
console.log(`Mode    : ${DRY_RUN ? "DRY-RUN (rollback forcé, aucune persistance)" : "--execute (confirmation APPLY requise avant COMMIT)"}\n`);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let outcome = "NOT_STARTED";
try {
  await client.query("BEGIN");

  // ---- live guards, inside the transaction ----

  const { rows: schemaRows } = await client.query("SELECT current_schema() AS schema");
  const actualSchema = schemaRows[0].schema;
  console.log(`current_schema() = "${actualSchema}"`);
  if (actualSchema !== EXPECTED_SCHEMA) {
    await client.query("ROLLBACK");
    fail(`current_schema() = "${actualSchema}", attendu "${EXPECTED_SCHEMA}". Rollback effectué.`);
  }

  for (const table of CATALOGUE_TABLES) {
    const { rows } = await client.query("SELECT to_regclass($1) AS r", [`${EXPECTED_SCHEMA}.${table}`]);
    if (!rows[0].r) {
      await client.query("ROLLBACK");
      fail(`table "${EXPECTED_SCHEMA}.${table}" absente — la migration ${MIGRATION_TAG} ne semble pas appliquée. Rollback effectué.`);
    }
  }
  console.log(`Les ${CATALOGUE_TABLES.length} tables catalogue existent.`);

  const { rows: migRows } = await client.query(
    `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
    [migrationEntry.when],
  );
  if (migRows[0].n < 1) {
    await client.query("ROLLBACK");
    fail(`${MIGRATION_TAG} n'est pas enregistrée dans drizzle.__drizzle_migrations (created_at attendu = ${migrationEntry.when}). Rollback effectué.`);
  }
  console.log(`Migration ${MIGRATION_TAG} confirmée présente dans drizzle.__drizzle_migrations.`);

  // ---- inserts, same shape/order/ON CONFLICT keys as the Preview seed script ----

  for (const s of SERVICES) {
    await client.query(
      `INSERT INTO services (service_id, type, status, category, display_name_fr, display_name_en, description_fr, description_en, price_derivation)
       VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6,$7,$8)
       ON CONFLICT (service_id) DO NOTHING`,
      [s.serviceId, s.type, s.category, s.displayNameFr, s.displayNameEn, s.descriptionFr, s.descriptionEn, s.priceDerivation],
    );
  }
  for (const o of MARKET_OFFERS) {
    await client.query(
      `INSERT INTO service_market_offers (service_id, market, currency, price, payment_frequency, billing_type, tax_display, cta_type, checkout_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (service_id, market) DO NOTHING`,
      [o.serviceId, o.market, o.currency, o.price, o.paymentFrequency, o.billingType, o.taxDisplay, o.ctaType, o.checkoutStatus],
    );
  }
  for (const r of RELATIONS) {
    await client.query(
      `INSERT INTO service_relations (parent_service_id, child_service_id, relation_type, display_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (parent_service_id, child_service_id, relation_type) DO NOTHING`,
      [r.parentServiceId, r.childServiceId, r.relationType, r.displayOrder],
    );
  }
  for (const l of LEGACY_IDENTIFIERS) {
    await client.query(
      `INSERT INTO service_legacy_identifiers (service_id, legacy_identifier, source)
       VALUES ($1,$2,$3)
       ON CONFLICT (legacy_identifier) DO NOTHING`,
      [l.serviceId, l.legacyIdentifier, l.source],
    );
  }

  // ---- final-state verification, still inside the transaction ----

  const expectedCounts = { services: SERVICES.length, service_market_offers: MARKET_OFFERS.length, service_relations: RELATIONS.length, service_legacy_identifiers: LEGACY_IDENTIFIERS.length };
  const actualCounts = {};
  for (const table of CATALOGUE_TABLES) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
    actualCounts[table] = rows[0].n;
  }
  console.log("\nComptes finaux (dans la transaction, avant décision commit/rollback) :");
  console.log(actualCounts);

  const mismatches = CATALOGUE_TABLES.filter((t) => actualCounts[t] !== expectedCounts[t]);
  if (mismatches.length > 0) {
    await client.query("ROLLBACK");
    fail(
      `état final inattendu — ${mismatches.map((t) => `${t}: attendu ${expectedCounts[t]}, obtenu ${actualCounts[t]}`).join(", ")}. Rollback effectué.`,
    );
  }

  const { rows: badOffers } = await client.query(
    `SELECT service_id, market, currency FROM service_market_offers
     WHERE NOT ((market = 'CANADA' AND currency = 'CAD') OR (market = 'EUROPE' AND currency = 'EUR'))`,
  );
  if (badOffers.length > 0) {
    await client.query("ROLLBACK");
    fail(`${badOffers.length} incohérence(s) market/currency détectée(s) en base après insertion. Rollback effectué.`);
  }

  console.log("\n✓ Toutes les validations post-insertion passent (comptes exacts, aucune incohérence market/currency).");

  if (DRY_RUN) {
    await client.query("ROLLBACK");
    outcome = "DRY_RUN_ROLLED_BACK";
    console.log("\n──────────────────────────────────────────────────────────────────────");
    console.log("DRY-RUN — ROLLBACK effectué. Aucune donnée persistée.");
    console.log("Relancer avec --execute pour proposer une exécution réelle (confirmation interactive requise).");
    console.log("──────────────────────────────────────────────────────────────────────");
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Cible : DATABASE_URL → schéma "${EXPECTED_SCHEMA}" (PRODUCTION). Taper "APPLY" pour committer réellement, toute autre réponse annule : `);
    rl.close();
    if (answer.trim() !== "APPLY") {
      await client.query("ROLLBACK");
      outcome = "CANCELLED_ROLLED_BACK";
      console.log("Annulé — ROLLBACK effectué, aucune instruction persistée.");
    } else {
      await client.query("COMMIT");
      outcome = "COMMITTED";
      console.log("✓ Appliqué — transaction validée (COMMIT).");
    }
  }
} catch (err) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // connection may already be unusable after the original error; ignore.
  }
  outcome = "ERROR_ROLLED_BACK";
  console.error(`\n✗ Erreur — ROLLBACK effectué. Rien n'a été inséré. Détail : ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log(`\nRésultat final : ${outcome}`);
}
