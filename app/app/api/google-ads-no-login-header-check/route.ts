import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { listAccessibleCustomers } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";

/**
 * TEMPORARY diagnostic route (2026-08) — for each customer ID
 * listAccessibleCustomers() returns, runs `SELECT customer.id,
 * customer.manager FROM customer` WITHOUT any login-customer-id header
 * (unlike discoverGoogleAdsAccounts(), which currently always sets it to
 * the account's own ID) — tests whether that forced header is itself
 * what's causing both real accounts to fail. Deliberately bypasses
 * lib/google-ads/client.ts's shared request helper here to capture the
 * FULL sanitized Google Ads error shape (error.code, error.details[]
 * with per-error errorCode/message/requestId) that GoogleAdsApiError
 * normally discards down to message/httpStatus/googleErrorStatus only —
 * needed to determine the real cause rather than assume MCC/login-
 * customer-id is required.
 *
 * Never logs/returns: developer token, access token, refresh token, or
 * full customer IDs (masked). Only Google's own structured, sanitized
 * error body is surfaced — no secrets appear anywhere in that shape.
 *
 * VERCEL_ENV==="preview"-gated, header-secret protected. Deleted in the
 * very next commit on this branch once used.
 */
const EXPECTED_SECRET_HASH = "367caa2ae458cfdc25e944c5fc3c12e637a7ade837da81b2d5b1226d7d4e2858";

function timingSafeHashCompare(candidate: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = Buffer.from(EXPECTED_SECRET_HASH, "hex");
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

function maskCustomerId(id: string): string {
  if (id.length <= 5) return "***";
  return `${id.slice(0, 3)}***${id.slice(-2)}`;
}

const API_VERSION = "v25";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

/** Raw request deliberately bypassing lib/google-ads/client.ts's shared
 * helper — needed here only to inspect the full error body (details[],
 * code) before it gets narrowed down to message/httpStatus/
 * googleErrorStatus by the app's own sanitizeGoogleAdsError(). No
 * login-customer-id header is ever sent by this function — that's the
 * exact thing being tested. */
async function rawSearchNoLoginHeader(accessToken: string, customerId: string, query: string) {
  const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const requestIdHeader = res.headers.get("request-id");
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  return { ok: res.ok, status: res.status, data, requestIdHeader };
}

const CUSTOMER_TYPE_QUERY = "SELECT customer.id, customer.manager FROM customer";

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

  const results = [];
  for (const id of topLevelIds) {
    const { ok, status, data, requestIdHeader } = await rawSearchNoLoginHeader(accessToken, id, CUSTOMER_TYPE_QUERY);
    if (ok) {
      const rows = (data as { results?: { customer?: { manager?: boolean } }[] })?.results ?? [];
      results.push({ maskedCustomerId: maskCustomerId(id), ok: true, manager: rows[0]?.customer?.manager === true });
    } else {
      const errorBody = (data as { error?: { code?: number; message?: string; status?: string; details?: unknown[] } })?.error;
      results.push({
        maskedCustomerId: maskCustomerId(id),
        ok: false,
        httpStatus: status,
        requestIdHeader,
        errorCode: errorBody?.code,
        errorStatus: errorBody?.status,
        errorMessage: errorBody?.message,
        errorDetails: errorBody?.details,
      });
    }
  }

  return NextResponse.json({ stage: "complete", results });
}
