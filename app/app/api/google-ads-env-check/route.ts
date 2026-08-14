import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * TEMPORARY diagnostic route (2026-08) — confirms, from inside the actual
 * running Vercel Preview deployment, whether the 4 Google Ads OAuth env
 * vars are present at runtime (booleans only — never values, never
 * lengths, never prefixes). Exists because the Google Ads dashboard page
 * still showed "not configured" after the vars were added on Vercel, and
 * the cause needed to be isolated: missing/misscoped var vs. some other
 * failure. Same design as the earlier market-schema-check route: Preview-
 * only, header-secret gated, deleted in the very next commit once used.
 */
const EXPECTED_SECRET_HASH = "8de2966245498d40708180d37ca66d98109911e4ab0c4e0c3d4a87827e2d2a97";

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
