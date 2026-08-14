import "server-only";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";

/**
 * Minimal REST client for the Google Ads API — deliberately NOT the
 * `google-ads-api` npm package (heavier dependency, gRPC/protobuf) and NOT
 * part of `googleapis` (which doesn't cover Google Ads at all). Plain
 * `fetch()` against the official REST interface, current stable version
 * verified at implementation time (v25, released 2026-07-22).
 *
 * Every call requires Authorization (OAuth access token) + developer-token
 * headers; login-customer-id is added only when accessing a client account
 * through a manager (see lib/google-ads/accounts.ts). This is the ONLY
 * module that constructs a Google Ads HTTP request — everything else goes
 * through searchGoogleAds()/listAccessibleCustomers() below.
 *
 * GOOGLE_ADS_API_BASE_URL_OVERRIDE is a TEST-ONLY escape hatch: when set,
 * requests go to that base instead of the real Google endpoint — used
 * exclusively by playwright.google-ads.config.ts to point a local
 * fixture-driven mock server (e2e-google-ads/mock-google-ads-server.mjs)
 * in place of https://googleads.googleapis.com, since Playwright can only
 * intercept browser-initiated requests, not this server-side fetch(). It
 * is never set in Production or Preview (not in .env.example, not part of
 * any Vercel environment) — when unset (the only real-world case),
 * behavior is identical to before this override existed.
 */
const API_VERSION = "v25";
const BASE_URL = process.env.GOOGLE_ADS_API_BASE_URL_OVERRIDE || `https://googleads.googleapis.com/${API_VERSION}`;

export class GoogleAdsApiError extends Error {
  httpStatus?: number;
  googleErrorStatus?: string;
  constructor(sanitized: { message: string; httpStatus?: number; googleErrorStatus?: string }) {
    super(sanitized.message);
    this.name = "GoogleAdsApiError";
    this.httpStatus = sanitized.httpStatus;
    this.googleErrorStatus = sanitized.googleErrorStatus;
  }
}

/** True precisely when Google Ads itself reports that the CURRENTLY
 * SELECTED customer ID is no longer usable (access revoked, account
 * closed/suspended) — as opposed to a transient/quota/network failure.
 * Only this specific signal should ever cause PUBLIC-MAP to silently
 * drop a remembered selection back to the account-selection screen;
 * anything else must surface as a plain "try again" error. Duck-typed on
 * the sanitized shape (not `instanceof GoogleAdsApiError`) so callers'
 * tests can simulate it without importing this class through a fully
 * mocked module. */
export function isCustomerInaccessibleError(err: unknown): boolean {
  const e = err as { httpStatus?: unknown; googleErrorStatus?: unknown } | null;
  return e?.httpStatus === 403 || e?.googleErrorStatus === "PERMISSION_DENIED";
}

function developerToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN n'est pas configuré.");
  return token;
}

async function googleAdsRequest({
  accessToken,
  loginCustomerId,
  path,
  method = "GET",
  body,
}: {
  accessToken: string;
  loginCustomerId?: string | null;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken(),
    "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const res = await fetch(`${BASE_URL}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (!res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
    throw new GoogleAdsApiError(sanitizeGoogleAdsError({ response: { status: res.status, data } }));
  }
  return res.json();
}

/** GET customers:listAccessibleCustomers — no customer ID, no
 * login-customer-id, ignores any supplied one (per Google's own docs).
 * Returns bare customer IDs (dashes/prefix stripped). */
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const data = await googleAdsRequest({ accessToken, path: "customers:listAccessibleCustomers" });
  const resourceNames = (data.resourceNames as string[] | undefined) ?? [];
  return resourceNames.map((rn) => rn.replace("customers/", ""));
}

/** POST customers/{id}/googleAds:search, paginated. `:search` (not
 * `:searchStream`) — simpler response/pagination shape, appropriate for
 * the small result sets V1 needs (a handful of accounts/campaigns), never
 * a per-row streaming concern here. */
export async function searchGoogleAds(params: {
  accessToken: string;
  customerId: string;
  loginCustomerId?: string | null;
  query: string;
}): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  do {
    const data = await googleAdsRequest({
      accessToken: params.accessToken,
      loginCustomerId: params.loginCustomerId,
      path: `customers/${params.customerId}/googleAds:search`,
      method: "POST",
      body: { query: params.query, pageToken, pageSize: 1000 },
    });
    results.push(...((data.results as Record<string, unknown>[] | undefined) ?? []));
    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);
  return results;
}
