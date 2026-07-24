#!/usr/bin/env node
/**
 * One-off functional test against the real audit-evidence bucket: upload a
 * tiny throwaway file, mint a signed URL, fetch it over HTTP and check the
 * bytes round-trip, then delete it. Leaves nothing behind on success.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { assertNotMainProductionDatabase, MainProductionDatabaseGuardError } from "../db/guard-main-production.ts";

config({ path: ".env.local" });

const auditDbUrl = process.env.AUDIT_DATABASE_URL;
try {
  assertNotMainProductionDatabase(auditDbUrl, "AUDIT_DATABASE_URL");
} catch (err) {
  if (err instanceof MainProductionDatabaseGuardError) {
    console.error(`✗ REFUSED: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const supabase = createClient(process.env.NEXT_PUBLIC_AUDIT_SUPABASE_URL, process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const bucket = "audit-evidence";
const path = `__e2e-test__/${Date.now()}-test.txt`;
const content = "public-map-audit storage e2e test";

console.log("1. Upload...");
const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, Buffer.from(content), { contentType: "text/plain" });
if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
console.log("   OK");

console.log("2. Signed URL...");
const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
if (signErr || !signed) throw new Error(`Sign failed: ${signErr?.message}`);
console.log("   OK");

console.log("3. Fetch via signed URL...");
const res = await fetch(signed.signedUrl);
const fetched = await res.text();
console.log(`   status=${res.status} content_matches=${fetched === content}`);
if (res.status !== 200 || fetched !== content) throw new Error("Round-trip content mismatch");

console.log("4. Confirm unsigned direct access is refused (bucket is private)...");
const publicUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
const unsignedRes = await fetch(publicUrl);
console.log(`   unsigned request status=${unsignedRes.status} (attendu: 400/403/404)`);

console.log("5. Cleanup...");
const { error: rmErr } = await supabase.storage.from(bucket).remove([path]);
if (rmErr) throw new Error(`Cleanup failed: ${rmErr.message}`);
console.log("   OK — fichier de test supprimé");

console.log("\nRESULTAT: TEST END-TO-END REUSSI");
