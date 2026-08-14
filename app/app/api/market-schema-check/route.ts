import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * TEMPORARY diagnostic route (2026-08) — confirms, from inside the actual
 * running Vercel Preview deployment, what `current_schema()` /
 * `current_setting('search_path')` the app's own `db` client (db/index.ts,
 * reading process.env.DATABASE_URL exactly like every real request does)
 * resolves to. Exists solely to verify Preview/Production schema isolation
 * before authorizing migrations 0026/0027 — see the market-as-source-of-
 * truth chantier. Deleted in a follow-up commit on this same branch right
 * after use; never merged to master.
 *
 * - Refuses outright unless VERCEL_ENV === "preview" (Vercel's own runtime
 *   flag — never NODE_ENV, which Vercel sets to "production" even for
 *   Preview builds). No SQL runs at all otherwise.
 * - Gated by a one-off shared secret via header, timing-safe compared
 *   against a SHA-256 hash only — the raw secret is never committed,
 *   logged, or stored anywhere but the operator's own memory for this one
 *   diagnostic call. Not Clerk-authenticated: this branch has no
 *   Preview-scoped Clerk keys configured, so reusing the app's own
 *   session-based staff auth isn't reliably reachable for a route this
 *   narrow and short-lived.
 * - Strictly read-only: exactly one SELECT, nothing else. No DDL/DML, no
 *   SET search_path (the query relies entirely on whatever search_path
 *   the connection already resolves to — the whole point of this check).
 * - Response body contains only currentSchema/searchPath — never
 *   DATABASE_URL, host, user, password, or any other env var.
 */
const EXPECTED_SECRET_HASH = "4913ba942885fcba37e5a557185622ea8ec5b221513bf0e311daaa4b59d3eae8";

function timingSafeHashCompare(candidate: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = Buffer.from(EXPECTED_SECRET_HASH, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const provided = request.headers.get("x-diagnostic-secret");
  if (!provided || !timingSafeHashCompare(provided)) {
    return new NextResponse(null, { status: 403 });
  }

  const { rows } = await db.execute(sql`select current_schema() as "currentSchema", current_setting('search_path') as "searchPath"`);

  return NextResponse.json({
    currentSchema: rows[0]?.currentSchema ?? null,
    searchPath: rows[0]?.searchPath ?? null,
  });
}
