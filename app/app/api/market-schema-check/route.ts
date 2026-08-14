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
 * before authorizing migrations 0026/0027. Re-created after the first
 * attempt was blocked by a missing Clerk Preview configuration on this
 * branch (now fixed — see the branch-scoped Clerk env vars added
 * alongside this commit). New secret/hash from the first attempt (route
 * was unreachable then, so the old secret was never usably exercised).
 * Deleted in a follow-up commit on this same branch right after use;
 * never merged to master.
 *
 * - Refuses outright unless VERCEL_ENV === "preview" (Vercel's own runtime
 *   flag — never NODE_ENV, which Vercel sets to "production" even for
 *   Preview builds). No SQL runs at all otherwise.
 * - Gated by a one-off shared secret via header, timing-safe compared
 *   against a SHA-256 hash only — the raw secret is never committed,
 *   logged, or stored anywhere but the operator's own memory for this one
 *   diagnostic call. Not Clerk-authenticated: intentionally simple and
 *   short-lived rather than depending on the Clerk config this route
 *   exists to help validate.
 * - Strictly read-only: exactly one SELECT, nothing else. No DDL/DML, no
 *   SET search_path (the query relies entirely on whatever search_path
 *   the connection already resolves to — the whole point of this check).
 * - Response body contains only currentSchema/searchPath — never
 *   DATABASE_URL, host, user, password, or any other env var.
 */
const EXPECTED_SECRET_HASH = "b9bfd515590164fa182a6b001a5aded171652dea960c2e8e6e68361760f33620";

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
