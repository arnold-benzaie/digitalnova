import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { listAccessibleCustomers, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";

/**
 * TEMPORARY diagnostic route (2026-08) — distinguishes, using the exact
 * same code path as discoverGoogleAdsAccounts() (lib/google-ads/accounts.ts),
 * whether listAccessibleCustomers() genuinely returns 0 customer IDs vs.
 * returns 1+ IDs whose subsequent customer_client search calls fail and
 * are silently swallowed by that function's own `catch { continue; }`.
 * Reuses the app's real getValidGoogleAdsAccessToken() (real decrypt,
 * real Preview encryption key) and the real listAccessibleCustomers/
 * searchGoogleAds — this is diagnostic-only, no new logic, no writes.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * any other secret. Customer IDs are masked (first 3 + last 2 digits
 * only) before being included in the response. Only sanitized Google
 * error fields (message/httpStatus/googleErrorStatus, already the
 * established safe shape via sanitizeGoogleAdsError) are returned for
 * failed customer_client calls.
 *
 * VERCEL_ENV==="preview"-gated, header-secret protected. Deleted in the
 * very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "71c87af7a810ad33c4fd5d1a61cd1783ad4138b91152d3d491c8c70b18866e1f";

function timingSafeHashCompare(candidate: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = Buffer.from(EXPECTED_SECRET_HASH, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function maskCustomerId(id: string): string {
  if (id.length <= 5) return "***";
  return `${id.slice(0, 3)}***${id.slice(-2)}`;
}

// Byte-for-byte the same query discoverGoogleAdsAccounts() uses (see
// lib/google-ads/accounts.ts) — duplicated here rather than exported,
// since this whole file is deleted right after use.
const CUSTOMER_CLIENT_QUERY = `
  SELECT
    customer_client.client_customer,
    customer_client.level,
    customer_client.manager,
    customer_client.descriptive_name,
    customer_client.currency_code,
    customer_client.time_zone,
    customer_client.status
  FROM customer_client
  WHERE customer_client.level <= 1
`;

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const provided = request.headers.get("x-diagnostic-secret");
  if (!provided || !timingSafeHashCompare(provided)) {
    return new NextResponse(null, { status: 403 });
  }

  const [connection] = await db.select({ organizationId: googleAdsConnections.organizationId }).from(googleAdsConnections).limit(1);
  if (!connection) {
    return NextResponse.json({ error: "no_connection_row_found" }, { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidGoogleAdsAccessToken(connection.organizationId);
  } catch (err) {
    return NextResponse.json({ stage: "get_access_token", error: sanitizeGoogleAdsError(err) }, { status: 200 });
  }

  let topLevelIds: string[];
  try {
    topLevelIds = await listAccessibleCustomers(accessToken);
  } catch (err) {
    return NextResponse.json({ stage: "list_accessible_customers", error: sanitizeGoogleAdsError(err) }, { status: 200 });
  }

  const perCustomerResults = [];
  for (const topLevelId of topLevelIds) {
    try {
      const rows = await searchGoogleAds({ accessToken, customerId: topLevelId, loginCustomerId: topLevelId, query: CUSTOMER_CLIENT_QUERY });
      perCustomerResults.push({ maskedCustomerId: maskCustomerId(topLevelId), ok: true, rowCount: rows.length });
    } catch (err) {
      perCustomerResults.push({ maskedCustomerId: maskCustomerId(topLevelId), ok: false, error: sanitizeGoogleAdsError(err) });
    }
  }

  return NextResponse.json({
    stage: "complete",
    listAccessibleCustomersCount: topLevelIds.length,
    maskedCustomerIds: topLevelIds.map(maskCustomerId),
    perCustomerResults,
  });
}
