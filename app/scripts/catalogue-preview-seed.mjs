#!/usr/bin/env node
/**
 * PUBLIC-MAP — P0.1B.2 catalogue data seed — PREVIEW SCHEMA ONLY.
 *
 * Deliberately narrow, same posture as scripts/preview-schema-apply.mjs:
 *   - Target schema is ALWAYS "preview" — not a CLI option, not an env
 *     var. Writing to "public" is structurally impossible through this
 *     file.
 *   - Reads PREVIEW_SCHEMA_DATABASE_URL only — never DATABASE_URL.
 *   - Defaults to --dry-run. --execute additionally requires typing the
 *     literal word APPLY at an interactive prompt.
 *   - Idempotent: every INSERT uses ON CONFLICT DO NOTHING keyed on the
 *     table's natural/unique key, so re-running this script never
 *     duplicates rows.
 *   - Refuses to run at all if the canonical dataset itself doesn't pass
 *     its own structural checks (see db/catalogue/canonical-dataset.test.mjs)
 *     — this script re-validates the same invariants inline rather than
 *     trusting that the test file was run first.
 *   - Refuses to run if any row is missing a NOT NULL column value —
 *     never sends a NULL into a NOT NULL column and lets Postgres reject
 *     it after the fact; catches it before opening a connection at all.
 *
 * Usage:
 *   npx tsx scripts/catalogue-preview-seed.mjs
 *     → dry-run (default): prints the full plan, opens no connection.
 *   npx tsx scripts/catalogue-preview-seed.mjs --execute
 *     → prints the same plan, then asks to type APPLY before touching anything for real.
 */
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { SERVICES, MARKET_OFFERS, RELATIONS, LEGACY_IDENTIFIERS } from "../db/catalogue/canonical-dataset.mjs";

config({ path: ".env.local" });

const TARGET_SCHEMA = "preview";
const CONNECTION_ENV_VAR = "PREVIEW_SCHEMA_DATABASE_URL";
const EXECUTE = process.argv.includes("--execute");

function fail(reason) {
  console.error(`\nÉCHEC — ${reason}`);
  console.error("Arrêt avant toute connexion — aucune base de données n'a été touchée.");
  process.exit(1);
}

// ---- structural + NOT NULL validation (no DB connection needed) ----

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

console.log("══════════════════════════════════════════════════════════════════════");
console.log("PUBLIC-MAP — Catalogue data seed — PREVIEW schema uniquement");
console.log("══════════════════════════════════════════════════════════════════════\n");
console.log(`1. Schéma cible : "${TARGET_SCHEMA}"`);
console.log(`2. Variable d'environnement : ${CONNECTION_ENV_VAR}\n`);
console.log("3. Dataset (comptes structurels, tous vérifiés ci-dessus) :");
console.log(`   services: ${SERVICES.length}`);
console.log(`   service_market_offers: ${MARKET_OFFERS.length}`);
console.log(`   service_relations: ${RELATIONS.length} (PACK_INCLUDES=${packIncludes.length}, DUO_INCLUDES=${duoIncludes.length})`);
console.log(`   service_legacy_identifiers: ${LEGACY_IDENTIFIERS.length}\n`);

if (nullViolations.length > 0) {
  console.log(`4. ✗ ${nullViolations.length} valeur(s) NOT NULL manquante(s) — INSERTION BLOQUÉE :`);
  for (const v of nullViolations) console.log(`   - ${v}`);
  console.log("\nCes colonnes sont NOT NULL dans le schéma approuvé (P0.1B.1). Aucune valeur");
  console.log("de remplacement n'a été inventée pour les combler — cf. commentaires dans");
  console.log("db/catalogue/canonical-dataset.mjs (descriptionEn: null, jamais sourcée).");
  fail(`${nullViolations.length} NOT NULL violation(s) — dataset ne correspond pas exactement à ce qui peut être inséré tel quel`);
}

console.log("4. ✓ Aucune valeur NOT NULL manquante.");
console.log("\n──────────────────────────────────────────────────────────────────────");
console.log(EXECUTE ? "Mode --execute demandé." : "Mode dry-run (défaut) — aucune connexion PostgreSQL ouverte, aucune instruction envoyée.");
console.log("──────────────────────────────────────────────────────────────────────");

if (!EXECUTE) {
  console.log("\nRelancer avec --execute pour proposer une exécution réelle (confirmation interactive requise).");
  process.exit(0);
}

// ---- real execution path (never reached while nullViolations.length > 0) ----

const connectionString = process.env[CONNECTION_ENV_VAR];
if (!connectionString) fail(`${CONNECTION_ENV_VAR} n'est pas défini. Rien n'a été tenté.`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Cible : ${CONNECTION_ENV_VAR} → schéma "${TARGET_SCHEMA}". Taper "APPLY" pour insérer réellement ce dataset, toute autre réponse annule : `);
rl.close();
if (answer.trim() !== "APPLY") {
  console.log("Annulé — aucune instruction envoyée.");
  process.exit(0);
}

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SET LOCAL search_path TO "${TARGET_SCHEMA}"`);

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

  await client.query("COMMIT");
  console.log("✓ Appliqué — transaction validée (COMMIT).");
} catch (err) {
  await client.query("ROLLBACK");
  console.error(`✗ Erreur — ROLLBACK complet effectué. Rien n'a été inséré. Détail : ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
