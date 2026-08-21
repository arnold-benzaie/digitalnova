import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { GoogleAdsApiError } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { getGoogleAdsPerformanceReport } from "@/lib/google-ads/reports";

/**
 * TEMPORARY diagnostic route (2026-08) — real end-to-end verification of
 * the pageSize fix (7f94834) against the real account (4902761507): calls
 * the actual getGoogleAdsPerformanceReport() exactly as the dashboard
 * page does. Reports success + the summary/campaign shape (impression/
 * click counts etc — business metrics, never secret) or the sanitized
 * error otherwise.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked). VERCEL_ENV==="preview"-gated, header-secret
 * protected. Deleted in the very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "f99eccf8f1510122f9dec84f81f0b3ed5b40267d032f5aeff30fb5383876d680";

function timingSafeHashCompare(candidate: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = Buffer.from(EXPECTED_SECRET_HASH, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function maskCustomerId(id: string): string {
  if (id.length <= 5) return "***";
  return `${id.slice(0, 3)}***${id.slice(-2)}`;
}

function describeError(err: unknown) {
  if (err instanceof GoogleAdsApiError) {
    return { httpStatus: err.httpStatus, googleErrorStatus: err.googleErrorStatus, googleErrorCode: err.googleErrorCode, message: err.message, requestId: err.requestId };
  }
  return sanitizeGoogleAdsError(err);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const provided = request.headers.get("x-diagnostic-secret");
  if (!provided || !timingSafeHashCompare(provided)) {
    return new NextResponse(null, { status: 403 });
  }

  const [connection] = await db
    .select({ organizationId: googleAdsConnections.organizationId, customerId: googleAdsConnections.customerId })
    .from(googleAdsConnections)
    .limit(1);
  if (!connection?.customerId) {
    return NextResponse.json({ error: "no_connection_or_no_account_selected" }, { status: 404 });
  }

  try {
    const report = await getGoogleAdsPerformanceReport(connection.organizationId, "LAST_30_DAYS");
    return NextResponse.json({
      ok: true,
      customerId: maskCustomerId(connection.customerId),
      summary: report.summary,
      campaignCount: report.campaigns.length,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, customerId: maskCustomerId(connection.customerId), error: describeError(err) }, { status: 200 });
  }
}
