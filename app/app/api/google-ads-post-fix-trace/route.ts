import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { GoogleAdsApiError, listAccessibleCustomers, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { discoverGoogleAdsAccounts } from "@/lib/google-ads/accounts";
import { getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";

/**
 * TEMPORARY diagnostic route (2026-08) — post-ae4c549 trace. For each
 * real customer ID listAccessibleCustomers() returns, runs BOTH: (a)
 * `SELECT customer.id, customer.manager FROM customer` — the minimal
 * query that previously confirmed 610...94 is a manager — and (b) the
 * CURRENTLY DEPLOYED customer_client discovery query
 * (discoverGoogleAdsAccounts()'s own CUSTOMER_CLIENT_QUERY), both
 * exactly as the deployed code sends them (no login-customer-id,
 * pageSize:null). Then separately calls the REAL discoverGoogleAdsAccounts()
 * to show exactly what AccountSelectionSection receives. Answers
 * precisely where in the pipeline a possibly-valid account disappears.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked). Errors go through GoogleAdsApiError's own
 * httpStatus/googleErrorStatus/googleErrorCode/requestId fields.
 *
 * VERCEL_ENV==="preview"-gated, header-secret protected. Deleted in the
 * very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "bb01cd8f50ab19e1120b896d107e9b806b6485f228eb3f9a20b127f4e9416157";

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
const CUSTOMER_QUERY = "SELECT customer.id, customer.manager FROM customer";

async function traceOneQuery(accessToken: string, id: string, resource: string, query: string) {
  const base = { resource, loginCustomerIdSent: false, loginCustomerIdRelation: "none — no login-customer-id header sent, matches the account queried" };
  try {
    const rows = await searchGoogleAds({ accessToken, customerId: id, query, pageSize: null });
    if (resource === "customer") {
      const customer = (rows[0] as { customer?: { manager?: boolean } })?.customer;
      return { ...base, ok: true, manager: customer?.manager === true };
    }
    const rowSummaries = rows.map((row) => {
      const cc = (row as { customerClient?: Record<string, unknown> }).customerClient;
      return { level: cc?.level, manager: cc?.manager, status: cc?.status };
    });
    return { ...base, ok: true, rowCount: rows.length, rows: rowSummaries };
  } catch (err) {
    return { ...base, ok: false, error: describeError(err) };
  }
}

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

  const perAccountTrace = [];
  for (const id of topLevelIds) {
    const customerTrace = await traceOneQuery(accessToken, id, "customer", CUSTOMER_QUERY);
    const customerClientTrace = await traceOneQuery(accessToken, id, "customer_client", CUSTOMER_CLIENT_QUERY);
    perAccountTrace.push({ maskedCustomerId: maskCustomerId(id), customer: customerTrace, customer_client: customerClientTrace });
  }

  // The REAL, currently deployed discoverGoogleAdsAccounts() — exactly
  // what getGoogleAdsAccountsForOrganization() / AccountSelectionSection see.
  const finalAccounts = await discoverGoogleAdsAccounts(accessToken);

  return NextResponse.json({
    stage: "complete",
    listAccessibleCustomersCount: topLevelIds.length,
    maskedCustomerIds: topLevelIds.map(maskCustomerId),
    perAccountTrace,
    finalDiscoveredAccountsCount: finalAccounts.length,
    finalDiscoveredAccounts: finalAccounts.map((a) => ({
      maskedCustomerId: maskCustomerId(a.customerId),
      loginCustomerId: a.loginCustomerId ? maskCustomerId(a.loginCustomerId) : null,
      currencyCode: a.currencyCode,
    })),
  });
}
