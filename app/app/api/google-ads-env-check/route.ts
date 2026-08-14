import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * TEMPORARY diagnostic route (2026-08) — confirms, from inside the actual
 * running Vercel Preview deployment, whether the 4 Google Ads OAuth env
 * vars are present at runtime (booleans only — never values, never
 * lengths, never prefixes). Re-created after GOOGLE_CLIENT_ID was fixed
 * on Vercel (previously resolved falsy despite correct-looking scoping
 * metadata). Preview-only, header-secret gated, deleted in the very next
 * commit once used.
 */
const EXPECTED_SECRET_HASH = "9cfcc9d21c679d8d5a4e8bd19f3506688119972ffa9124824c23a507507dcb71";

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

  return NextResponse.json({
    GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    GOOGLE_ADS_DEVELOPER_TOKEN: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    GOOGLE_ADS_OAUTH_REDIRECT_URI: Boolean(process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI),
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  });
}
