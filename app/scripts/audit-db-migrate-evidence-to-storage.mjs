#!/usr/bin/env node
/**
 * One-time backfill: moves any gbp_audit_evidence rows still holding
 * base64-in-Postgres bytes (from before Supabase Storage was wired up)
 * into the audit-evidence bucket, via lib/gbp-audit/storage.ts's
 * migrateToStorage(). Safe to re-run — only rows still carrying
 * content_base64 are touched; on a project where evidence has always gone
 * straight to Storage (e.g. public-map-audit today), this is a no-op.
 */
import { config } from "dotenv";
import { Client } from "pg";
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

const client = new Client({ connectionString: auditDbUrl });
await client.connect();
const supabase = createClient(process.env.NEXT_PUBLIC_AUDIT_SUPABASE_URL, process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

try {
  const { rows } = await client.query(
    `SELECT id, finding_id AS "findingId", file_name AS "fileName", mime_type AS "mimeType", content_base64 AS "contentBase64"
     FROM gbp_audit_evidence WHERE content_base64 IS NOT NULL`,
  );
  console.log(`${rows.length} ligne(s) avec content_base64 trouvée(s).`);
  if (rows.length === 0) {
    console.log("Rien à migrer.");
  } else {
    let migrated = 0;
    for (const row of rows) {
      const path = `${row.findingId}/${row.id}-${row.fileName ?? "evidence"}`;
      const buffer = Buffer.from(row.contentBase64, "base64");
      const { error: upErr } = await supabase.storage.from("audit-evidence").upload(path, buffer, { contentType: row.mimeType ?? "application/octet-stream" });
      if (upErr) throw new Error(`Upload failed for evidence ${row.id}: ${upErr.message}`);
      await client.query(
        `UPDATE gbp_audit_evidence SET storage_bucket = 'audit-evidence', storage_path = $1, content_base64 = NULL WHERE id = $2`,
        [path, row.id],
      );
      migrated++;
      console.log(`  + ${row.id} migré`);
    }
    console.log(`${migrated} ligne(s) migrée(s) vers Supabase Storage.`);
  }
} finally {
  await client.end();
}
