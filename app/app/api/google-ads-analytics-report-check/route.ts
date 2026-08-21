import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { GoogleAdsApiError } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { campaignBreakdown, computePreviousPeriodRange, getGoogleAdsAnalyticsReport } from "@/lib/google-ads/reports";

/**
 * TEMPORARY diagnostic route (2026-08) — real end-to-end verification of
 * the new analytics dashboard (749410e) against the real account
 * (4902761507): calls the actual getGoogleAdsAnalyticsReport() exactly as
 * the dashboard page does, and campaignBreakdown() on the result. Reports
 * shapes/counts (business metrics, never secret) rather than raw values,
 * to keep the response small and focused on structural correctness.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked). VERCEL_ENV==="preview"-gated, header-secret
 * protected. Deleted in the very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "15837d02a45914f718fd58bf39d3b45a3fc7d9d0daeef36b9eaa681a605697af";

function timingSafeHashCompare(candidate: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = Buffer.from(EXPECTED_SECRET_HASH, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function maskCustomerId(id: string): string {
  if (id.length <= 5) return "***";
  return `${id.slice(0, 3)}***${id.slice(-2)}`;
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

  const previousRange = computePreviousPeriodRange("LAST_30_DAYS", new Date());

  try {
    const report = await getGoogleAdsAnalyticsReport(connection.organizationId, "LAST_30_DAYS");
    const breakdowns = {
      costMicros: campaignBreakdown(report.campaigns, "costMicros"),
      conversions: campaignBreakdown(report.campaigns, "conversions"),
      clicks: campaignBreakdown(report.campaigns, "clicks"),
    };
    return NextResponse.json({
      ok: true,
      customerId: maskCustomerId(connection.customerId),
      previousPeriodWindow: previousRange,
      summary: report.summary,
      trends: report.trends,
      dailySeriesLength: report.dailySeries.length,
      dailySeriesSample: report.dailySeries.slice(0, 2),
      campaignCount: report.campaigns.length,
      breakdownCounts: { costMicros: breakdowns.costMicros.length, conversions: breakdowns.conversions.length, clicks: breakdowns.clicks.length },
    });
  } catch (err) {
    const sanitized = err instanceof GoogleAdsApiError
      ? { httpStatus: err.httpStatus, googleErrorStatus: err.googleErrorStatus, googleErrorCode: err.googleErrorCode, message: err.message }
      : sanitizeGoogleAdsError(err);
    return NextResponse.json({ ok: false, customerId: maskCustomerId(connection.customerId), error: sanitized }, { status: 200 });
  }
}
