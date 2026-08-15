import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { GoogleAdsApiError, listAccessibleCustomers, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";

/**
 * TEMPORARY diagnostic route (2026-08) — for each customer ID
 * listAccessibleCustomers() returns, determines whether it's a
 * manager/MCC account or a direct advertiser account via `SELECT
 * customer.id, customer.manager FROM customer` — a query valid against
 * ANY accessible account type (unlike customer_client, which is what
 * discoverGoogleAdsAccounts() currently always tries first and which
 * failed for both real accounts in the prior diagnostic round).
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked: first 3 + last 2 digits). Errors go through
 * the real GoogleAdsApiError's own httpStatus/googleErrorStatus fields
 * directly (not re-derived via sanitizeGoogleAdsError, which expects a
 * raw fetch-shaped error, not an already-thrown GoogleAdsApiError
 * instance — reading the instance's own fields avoids losing that detail,
 * unlike the prior diagnostic route).
 *
 * VERCEL_ENV==="preview"-gated, header-secret protected. Deleted in the
 * very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "32e4ecdd518c37e240844f31e26a539858e27b14bd98341f9c27ea028b615089";

function timingSafeHashCompare(candidate: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = Buffer.from(EXPECTED_SECRET_HASH, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function maskCustomerId(id: string): string {
  if (id.length <= 5) return "***";
  return `${id.slice(0, 3)}***${id.slice(-2)}`;
}

function describeError(err: unknown): { message: string; httpStatus?: number; googleErrorStatus?: string } {
  if (err instanceof GoogleAdsApiError) {
    return { message: err.message, httpStatus: err.httpStatus, googleErrorStatus: err.googleErrorStatus };
  }
  return sanitizeGoogleAdsError(err);
}

const CUSTOMER_TYPE_QUERY = `
  SELECT
    customer.id,
    customer.manager
  FROM customer
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
    return NextResponse.json({ stage: "get_access_token", error: describeError(err) }, { status: 200 });
  }

  let topLevelIds: string[];
  try {
    topLevelIds = await listAccessibleCustomers(accessToken);
  } catch (err) {
    return NextResponse.json({ stage: "list_accessible_customers", error: describeError(err) }, { status: 200 });
  }

  const results = [];
  for (const id of topLevelIds) {
    try {
      const rows = await searchGoogleAds({ accessToken, customerId: id, loginCustomerId: id, query: CUSTOMER_TYPE_QUERY });
      const customer = rows[0]?.customer as Record<string, unknown> | undefined;
      results.push({ maskedCustomerId: maskCustomerId(id), ok: true, manager: customer?.manager === true });
    } catch (err) {
      results.push({ maskedCustomerId: maskCustomerId(id), ok: false, error: describeError(err) });
    }
  }

  return NextResponse.json({ stage: "complete", results });
}
