import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { GoogleAdsApiError, listAccessibleCustomers, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { discoverGoogleAdsAccounts, isSelectableGoogleAdsAccount } from "@/lib/google-ads/accounts";
import { getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";

/**
 * TEMPORARY diagnostic route (2026-08) — a client account (490-276-1507)
 * was just created under the manager (610-469-3894) already confirmed
 * accessible; the manager already shows it in the real Google Ads UI, but
 * PUBLIC-MAP Preview still shows "no account accessible". Checks, from
 * inside the real Preview runtime with the real stored OAuth grant:
 * (1) listAccessibleCustomers() raw output, (2) the manager's
 * customer_client rows — exactly what discoverGoogleAdsAccounts() sees —
 * with full per-row detail (level/manager/status/descriptiveName/
 * clientCustomer), (3) the same query WITH an explicit login-customer-id
 * set to the manager itself (cross-check), (4) whether the new child
 * account is independently reachable via a direct `customer` query using
 * login-customer-id: manager, (5) the real discoverGoogleAdsAccounts()
 * final output and whether isSelectableGoogleAdsAccount() would keep or
 * drop the child's row if it appears.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked). VERCEL_ENV==="preview"-gated, header-secret
 * protected. Deleted in the very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "c3a38abb98d9291f5adb0963b918c595cae9c53e9e7d596e9bf45d12260b4cde";

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
const CUSTOMER_QUERY = "SELECT customer.id, customer.manager, customer.descriptive_name, customer.status FROM customer";

const MANAGER_ID = "6104693894";
const CHILD_ID = "4902761507";

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

  // 1) listAccessibleCustomers()
  let topLevelIds: string[];
  try {
    topLevelIds = await listAccessibleCustomers(accessToken);
  } catch (err) {
    return NextResponse.json({ stage: "list_accessible_customers", error: describeError(err) }, { status: 200 });
  }

  // 2) customer_client on the manager, exactly as discoverGoogleAdsAccounts() calls it — no login-customer-id, pageSize:null.
  let managerCustomerClientRows: unknown;
  try {
    const rows = await searchGoogleAds({ accessToken, customerId: MANAGER_ID, query: CUSTOMER_CLIENT_QUERY, pageSize: null });
    managerCustomerClientRows = {
      ok: true,
      rowCount: rows.length,
      rows: rows.map((row) => {
        const cc = (row as { customerClient?: Record<string, unknown> }).customerClient;
        const clientCustomerId = typeof cc?.clientCustomer === "string" ? cc.clientCustomer.replace("customers/", "") : null;
        return {
          maskedClientCustomerId: clientCustomerId ? maskCustomerId(clientCustomerId) : null,
          isTheNewChild: clientCustomerId === CHILD_ID,
          level: cc?.level,
          manager: cc?.manager,
          status: cc?.status,
          descriptiveName: cc?.descriptiveName,
          selectableVerdict: cc ? isSelectableGoogleAdsAccount(cc) : null,
        };
      }),
    };
  } catch (err) {
    managerCustomerClientRows = { ok: false, error: describeError(err) };
  }

  // 3) Same query but WITH an explicit login-customer-id = manager itself (cross-check).
  let managerCustomerClientWithLoginHeader: unknown;
  try {
    const rows = await searchGoogleAds({ accessToken, customerId: MANAGER_ID, loginCustomerId: MANAGER_ID, query: CUSTOMER_CLIENT_QUERY, pageSize: null });
    managerCustomerClientWithLoginHeader = { ok: true, rowCount: rows.length };
  } catch (err) {
    managerCustomerClientWithLoginHeader = { ok: false, error: describeError(err) };
  }

  // 4) Is the new child independently reachable via a direct `customer` query, using login-customer-id: manager?
  let childDirectQuery: unknown;
  try {
    const rows = await searchGoogleAds({ accessToken, customerId: CHILD_ID, loginCustomerId: MANAGER_ID, query: CUSTOMER_QUERY, pageSize: null });
    const customer = (rows[0] as { customer?: Record<string, unknown> })?.customer;
    childDirectQuery = { ok: true, found: rows.length > 0, manager: customer?.manager, status: customer?.status, descriptiveName: customer?.descriptiveName };
  } catch (err) {
    childDirectQuery = { ok: false, error: describeError(err) };
  }

  // 5) The REAL, currently deployed discoverGoogleAdsAccounts().
  const finalAccounts = await discoverGoogleAdsAccounts(accessToken);

  return NextResponse.json({
    stage: "complete",
    listAccessibleCustomersCount: topLevelIds.length,
    maskedCustomerIds: topLevelIds.map(maskCustomerId),
    managerCustomerClientRows,
    managerCustomerClientWithLoginHeader,
    childDirectQuery,
    finalDiscoveredAccountsCount: finalAccounts.length,
    finalDiscoveredAccounts: finalAccounts.map((a) => ({ maskedCustomerId: maskCustomerId(a.customerId), loginCustomerId: a.loginCustomerId ? maskCustomerId(a.loginCustomerId) : null })),
  });
}
