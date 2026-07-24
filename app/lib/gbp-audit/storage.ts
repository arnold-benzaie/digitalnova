import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY. The `server-only` import above makes Next.js throw a build
 * error if this module is ever imported from a "use client" component —
 * AUDIT_SUPABASE_SERVICE_ROLE_KEY must never reach the browser bundle.
 *
 * All four buckets (see AUDIT_STORAGE_BUCKETS) must be created PRIVATE
 * (public: false) — see ensureAuditBucketsExist() below, or create them by
 * hand in the Supabase dashboard: Storage → New bucket → toggle "Public
 * bucket" OFF. A private bucket returns 404 for any unsigned request; the
 * only way to read an object is a signed URL minted here, server-side,
 * with a short expiry.
 *
 * Verified end-to-end against the real public-map-audit Supabase project:
 * bucket creation/privacy, upload, signed-URL read (content byte-for-byte
 * match), and unsigned-access rejection (400) all confirmed working.
 */

export const AUDIT_STORAGE_BUCKETS = {
  evidence: "audit-evidence",
  reports: "audit-reports",
  attachments: "audit-attachments",
  businessDocuments: "business-documents",
} as const;

export type AuditStorageBucket = (typeof AUDIT_STORAGE_BUCKETS)[keyof typeof AUDIT_STORAGE_BUCKETS];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — see .env.example (PUBLIC-MAP Audit Supabase project section).`);
  }
  return value;
}

/**
 * One client, built lazily (not at module load) so importing this file
 * doesn't itself require the env vars to be set yet — only calling one of
 * the functions below does. Uses the service_role key: this client can
 * read/write any object in any bucket, which is exactly why it must never
 * leave the server (see the `server-only` guard above).
 */
function getServiceClient() {
  const url = requireEnv("NEXT_PUBLIC_AUDIT_SUPABASE_URL");
  const serviceRoleKey = requireEnv("AUDIT_SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

/** Run once against a fresh project (idempotent — skips buckets that already exist). */
export async function ensureAuditBucketsExist(): Promise<void> {
  const supabase = getServiceClient();
  const { data: existing, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  const existingNames = new Set((existing ?? []).map((b) => b.name));

  for (const bucket of Object.values(AUDIT_STORAGE_BUCKETS)) {
    if (existingNames.has(bucket)) continue;
    const { error } = await supabase.storage.createBucket(bucket, { public: false });
    if (error) throw new Error(`Failed to create private bucket "${bucket}": ${error.message}`);
  }
}

/** Upload a file (e.g. an evidence screenshot) to a private bucket. `path` should be namespaced, e.g. `${findingId}/${filename}`. */
export async function uploadToAuditBucket(
  bucket: AuditStorageBucket,
  path: string,
  file: Blob | Buffer,
  contentType: string,
): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType, upsert: false });
  if (error) throw new Error(`Failed to upload to ${bucket}/${path}: ${error.message}`);
}

/**
 * Short-lived signed URL — the ONLY way any confidential file (evidence,
 * PDF report, attachment, business document) is ever served. Default 5
 * minutes: long enough for a page to load an image/PDF, short enough that
 * a leaked/logged URL stops working almost immediately. Never cache this
 * URL beyond the request that needed it.
 */
export async function getSignedAuditFileUrl(
  bucket: AuditStorageBucket,
  path: string,
  expiresInSeconds = 300,
): Promise<string> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error(`Failed to sign URL for ${bucket}/${path}: ${error?.message ?? "unknown error"}`);
  return data.signedUrl;
}

export async function deleteFromAuditBucket(bucket: AuditStorageBucket, path: string): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(`Failed to delete ${bucket}/${path}: ${error.message}`);
}

// The one-time base64→Storage backfill lives in
// scripts/audit-db-migrate-evidence-to-storage.mjs, not here — this
// module's `server-only` import (top of file) makes it unimportable from a
// plain script context, so a standalone script needs its own copy of this
// logic regardless.
