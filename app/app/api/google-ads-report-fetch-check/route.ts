import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { GoogleAdsApiError, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { getGoogleAdsConnection, getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";

/**
 * TEMPORARY diagnostic route (2026-08) — the account (4902761507) is now
 * selected but the performance report call fails with "Impossible de
 * récupérer les données Google Ads pour le moment." Reproduces, from
 * inside the real Preview runtime, byte-for-byte the same 2 calls
 * getGoogleAdsPerformanceReport() (lib/google-ads/reports.ts) makes —
 * same customerId/loginCustomerId read from the real stored connection,
 * same GAQL query text — plus a minimal `customer` cross-check query, to
 * isolate exactly which call fails and why.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked). VERCEL_ENV==="preview"-gated, header-secret
 * protected. Deleted in the very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "a38634b1d8225b1113f5f8d544522a269f5ad59e4bf2924cbc6d740c85b6a06f";

function timingSafeHashCompare(candidate: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = Buffer.from(EXPECTED_SECRET_HASH, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function maskCustomerId(id: string | null): string | null {
  if (!id) return id;
  if (id.length <= 5) return "***";
  return `${id.slice(0, 3)}***${id.slice(-2)}`;
}

function describeError(err: unknown) {
  if (err instanceof GoogleAdsApiError) {
    return { httpStatus: err.httpStatus, googleErrorStatus: err.googleErrorStatus, googleErrorCode: err.googleErrorCode, message: err.message, requestId: err.requestId };
  }
  return sanitizeGoogleAdsError(err);
}

const MINIMAL_CUSTOMER_QUERY = "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer";

// Byte-for-byte the same queries lib/google-ads/reports.ts builds for
// LAST_30_DAYS (matching the UI's selected range in the screenshot).
const SUMMARY_QUERY = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date DURING LAST_30_DAYS
  `;
const CAMPAIGNS_QUERY = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC
  `;

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const provided = request.headers.get("x-diagnostic-secret");
  if (!provided || !timingSafeHashCompare(provided)) {
    return new NextResponse(null, { status: 403 });
  }

  const [connectionRow] = await db.select({ organizationId: googleAdsConnections.organizationId }).from(googleAdsConnections).limit(1);
  if (!connectionRow) {
    return NextResponse.json({ error: "no_connection_row_found" }, { status: 404 });
  }

  const connection = await getGoogleAdsConnection(connectionRow.organizationId);
  if (!connection?.customerId) {
    return NextResponse.json({ error: "no_customer_id_selected_on_connection" }, { status: 404 });
  }

  const maskedCustomerId = maskCustomerId(connection.customerId);
  const maskedLoginCustomerId = maskCustomerId(connection.loginCustomerId);

  let accessToken: string;
  try {
    accessToken = await getValidGoogleAdsAccessToken(connectionRow.organizationId);
  } catch (err) {
    return NextResponse.json({ stage: "get_access_token", customerId: maskedCustomerId, loginCustomerId: maskedLoginCustomerId, error: describeError(err) }, { status: 200 });
  }

  async function runQuery(label: string, query: string) {
    try {
      const rows = await searchGoogleAds({ accessToken, customerId: connection!.customerId!, loginCustomerId: connection!.loginCustomerId, query });
      return { label, ok: true, rowCount: rows.length, sampleRow: rows[0] ?? null };
    } catch (err) {
      return { label, ok: false, query: query.trim(), customerId: maskedCustomerId, loginCustomerId: maskedLoginCustomerId, error: describeError(err) };
    }
  }

  const [minimalCustomer, summary, campaigns] = await Promise.all([
    runQuery("minimal_customer_query", MINIMAL_CUSTOMER_QUERY),
    runQuery("summary_query_last_30_days", SUMMARY_QUERY),
    runQuery("campaigns_query_last_30_days", CAMPAIGNS_QUERY),
  ]);

  return NextResponse.json({
    stage: "complete",
    customerId: maskedCustomerId,
    loginCustomerId: maskedLoginCustomerId,
    minimalCustomer,
    summary,
    campaigns,
  });
}
