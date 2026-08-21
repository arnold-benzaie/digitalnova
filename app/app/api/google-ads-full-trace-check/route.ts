import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { GoogleAdsApiError, listAccessibleCustomers, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { discoverGoogleAdsAccounts, isSelectableGoogleAdsAccount } from "@/lib/google-ads/accounts";
import { getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";

/**
 * TEMPORARY diagnostic route (2026-08) — full read-only trace of
 * listAccessibleCustomers() -> the CURRENTLY DEPLOYED discoverGoogleAdsAccounts()
 * (no login-customer-id header, per 76a68e2) for each real customer ID,
 * showing exactly which rows each account's customer_client query
 * returns, whether isSelectableGoogleAdsAccount() keeps or drops each
 * one, and the final discoverGoogleAdsAccounts() output — the exact
 * shape AccountSelectionSection (app/dashboard/google-ads/page.tsx)
 * receives. Built to answer "why does a possibly-valid account still
 * not show up in the UI" precisely, without guessing.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked: first 3 + last 2 digits). Errors go
 * through GoogleAdsApiError's own httpStatus/googleErrorStatus/
 * googleErrorCode/requestId fields directly.
 *
 * VERCEL_ENV==="preview"-gated, header-secret protected. Deleted in the
 * very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "42bf66324f051f319aad4f80fce559706d3b0cacd2dd6511688f448d0042c488";

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

// Byte-for-byte the same query discoverGoogleAdsAccounts() currently
// uses (lib/google-ads/accounts.ts) — duplicated here rather than
// exported, since this whole file is deleted right after use.
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
    return NextResponse.json({ stage: "get_access_token", error: describeError(err) }, { status: 200 });
  }

  // Step 1: listAccessibleCustomers() — exactly what the real code calls first.
  let topLevelIds: string[];
  try {
    topLevelIds = await listAccessibleCustomers(accessToken);
  } catch (err) {
    return NextResponse.json({ stage: "list_accessible_customers", error: describeError(err) }, { status: 200 });
  }

  // Step 2: per-account raw customer_client query, no login-customer-id —
  // exactly what the CURRENTLY DEPLOYED discoverGoogleAdsAccounts() sends.
  const perAccountTrace = [];
  for (const id of topLevelIds) {
    try {
      const rows = await searchGoogleAds({ accessToken, customerId: id, query: CUSTOMER_CLIENT_QUERY });
      const rowSummaries = rows.map((row) => {
        const cc = (row as { customerClient?: Record<string, unknown> }).customerClient;
        const selectable = cc ? isSelectableGoogleAdsAccount(cc) : false;
        return {
          maskedClientCustomerId: typeof cc?.clientCustomer === "string" ? maskCustomerId(cc.clientCustomer.replace("customers/", "")) : null,
          level: cc?.level,
          manager: cc?.manager,
          status: cc?.status,
          selectable,
        };
      });
      perAccountTrace.push({ maskedCustomerId: maskCustomerId(id), ok: true, rowCount: rows.length, rows: rowSummaries });
    } catch (err) {
      perAccountTrace.push({ maskedCustomerId: maskCustomerId(id), ok: false, error: describeError(err) });
    }
  }

  // Step 3: the REAL, currently deployed discoverGoogleAdsAccounts() —
  // exactly what getGoogleAdsAccountsForOrganization() / AccountSelectionSection see.
  const finalAccounts = await discoverGoogleAdsAccounts(accessToken);

  return NextResponse.json({
    stage: "complete",
    listAccessibleCustomersCount: topLevelIds.length,
    maskedCustomerIds: topLevelIds.map(maskCustomerId),
    perAccountTrace,
    finalDiscoveredAccountsCount: finalAccounts.length,
    finalDiscoveredAccounts: finalAccounts.map((a) => ({ maskedCustomerId: maskCustomerId(a.customerId), loginCustomerId: a.loginCustomerId ? maskCustomerId(a.loginCustomerId) : null, currencyCode: a.currencyCode })),
  });
}
