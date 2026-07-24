#!/usr/bin/env node
/**
 * Creates the 4 PUBLIC-MAP Audit Storage buckets (idempotent) against
 * NEXT_PUBLIC_AUDIT_SUPABASE_URL, then verifies every bucket is private.
 * Guarded the same way as scripts/audit-db-migrate.mjs — refuses to run
 * against anything that looks like the main PUBLIC-MAP project.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";

// Duplicated from lib/gbp-audit/storage.ts (not imported: that module is
// guarded by `server-only`, which throws outside a Next.js server bundle —
// i.e. it can't be required from a plain script). Keep this list in sync.
const AUDIT_STORAGE_BUCKETS = {
  evidence: "audit-evidence",
  reports: "audit-reports",
  attachments: "audit-attachments",
  businessDocuments: "business-documents",
};

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_AUDIT_SUPABASE_URL;
const serviceRoleKey = process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY;
const auditDbUrl = process.env.AUDIT_DATABASE_URL;

if (!url || !serviceRoleKey || !auditDbUrl) {
  console.error("✗ NEXT_PUBLIC_AUDIT_SUPABASE_URL / AUDIT_SUPABASE_SERVICE_ROLE_KEY / AUDIT_DATABASE_URL must all be set.");
  process.exit(1);
}

// Reuses the DB guard on AUDIT_DATABASE_URL as a proxy signature check —
// same project, same rule: refuse if it looks like the main site's.
try {
  assertNotMainProductionDatabase(auditDbUrl, "AUDIT_DATABASE_URL");
} catch (err) {
  if (err instanceof MainProductionDatabaseGuardError) {
    console.error(`✗ REFUSED: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

console.log(`Target Supabase project: ${url}`);
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

console.log("Creating buckets (idempotent)...");
const { data: existing, error: listError } = await supabase.storage.listBuckets();
if (listError) throw listError;
const existingNames = new Set((existing ?? []).map((b) => b.name));
for (const bucket of Object.values(AUDIT_STORAGE_BUCKETS)) {
  if (existingNames.has(bucket)) {
    console.log(`  = ${bucket} déjà présent`);
    continue;
  }
  const { error } = await supabase.storage.createBucket(bucket, { public: false });
  if (error) throw new Error(`Failed to create private bucket "${bucket}": ${error.message}`);
  console.log(`  + ${bucket} créé`);
}

console.log("\nVerifying privacy...");
const { data: buckets, error } = await supabase.storage.listBuckets();
if (error) throw error;

let allPrivate = true;
for (const name of Object.values(AUDIT_STORAGE_BUCKETS)) {
  const b = buckets.find((x) => x.name === name);
  if (!b) {
    console.log(`  ?? ${name} — introuvable après création`);
    allPrivate = false;
    continue;
  }
  console.log(`  ${b.public ? "FAIL" : "OK"} — ${name} : public=${b.public}`);
  if (b.public) allPrivate = false;
}
console.log(allPrivate ? "\nRESULTAT: TOUS LES BUCKETS SONT PRIVES" : "\nRESULTAT: AU MOINS UN BUCKET EST PUBLIC — A CORRIGER");
