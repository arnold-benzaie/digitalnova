import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { GoogleAdsApiError, listAccessibleCustomers, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { getValidGoogleAdsAccessToken } from "@/lib/google-ads/tokens";

export type DiscoveredGoogleAdsAccount = {
  customerId: string; // no dashes
  loginCustomerId: string | null; // manager account ID needed to reach this one, if any
  descriptiveName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
};

// customer_client.level <= 1 expands one level under each directly
// accessible account (itself + direct children) — deep MCC hierarchies
// (grandchildren) are out of scope for V1: extra calls for a case that's
// rare for PUBLIC-MAP's client base, consistent with the "avoid
// unnecessary calls" quota discipline (Basic Access).
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

/** True precisely for a real, usable advertiser account: not a manager
 * itself (you never run/report ads directly on an MCC), and not a
 * status Google itself reports as unusable. Exported so this "what counts
 * as selectable" rule is unit-testable without a network call. */
export function isSelectableGoogleAdsAccount(row: {
  manager?: unknown;
  status?: unknown;
}): boolean {
  if (row.manager === true) return false;
  // CANCELED/CLOSED/SUSPENDED accounts would only ever error on a report
  // call — filtering them out here means the selection list never offers
  // a choice that's guaranteed to fail next.
  return row.status === undefined || row.status === "ENABLED";
}

/** Never the full customer ID in any log — first 3 + last 2 digits only,
 * enough to correlate log lines without exposing the account identifier
 * in full. */
function maskCustomerId(id: string): string {
  if (id.length <= 5) return "***";
  return `${id.slice(0, 3)}***${id.slice(-2)}`;
}

/** Logs a discovery failure for one account — httpStatus/googleErrorStatus/
 * googleErrorCode/message/requestId only, never developer token, access
 * token, or refresh token (none of those are ever part of the sanitized
 * shape to begin with — see lib/google-ads/errors.ts). Reads the fields
 * directly off a GoogleAdsApiError instance rather than re-sanitizing it
 * (sanitizeGoogleAdsError expects a raw fetch-shaped error, not an
 * already-thrown GoogleAdsApiError, whose details live in flat
 * properties instead of a nested `.response`). This is the ONLY place
 * this failure is surfaced — previously it was silently discarded,
 * which is exactly what hid a real CUSTOMER_NOT_ENABLED account state
 * behind a generic "no account accessible" UI message. */
function logGoogleAdsDiscoveryError(topLevelId: string, err: unknown): void {
  const sanitized = err instanceof GoogleAdsApiError
    ? { httpStatus: err.httpStatus, googleErrorStatus: err.googleErrorStatus, googleErrorCode: err.googleErrorCode, message: err.message, requestId: err.requestId }
    : sanitizeGoogleAdsError(err);
  console.error("[google-ads] discovery failed for account", maskCustomerId(topLevelId), sanitized);
}

/** Discovers every REAL, currently-accessible Google Ads advertiser
 * account for the given access token. Never trusts a customerId from
 * anywhere but this live discovery — see selectGoogleAdsAccount() below,
 * the only place a client-submitted customerId is ever validated. */
export async function discoverGoogleAdsAccounts(accessToken: string): Promise<DiscoveredGoogleAdsAccount[]> {
  const topLevelIds = await listAccessibleCustomers(accessToken);
  const accounts: DiscoveredGoogleAdsAccount[] = [];

  for (const topLevelId of topLevelIds) {
    let rows: Record<string, unknown>[];
    try {
      // No login-customer-id here by default — confirmed against a real
      // Preview account that forcing it to the account's own ID (as this
      // used to do) is itself invalid when the account is a manager
      // queried about itself (Google rejects it with INVALID_ARGUMENT).
      // A direct, manager-less account also needs no header. Retrying
      // with a manager ID is deliberately NOT implemented here — only
      // add that once Google's response gives an explicit signal that
      // one is required, rather than guessing.
      rows = await searchGoogleAds({ accessToken, customerId: topLevelId, query: CUSTOMER_CLIENT_QUERY });
    } catch (err) {
      // A directly-listed customer this query itself fails against (e.g.
      // CUSTOMER_NOT_ENABLED, or any other account-level state issue) is
      // skipped for selection — one bad account must never hide every
      // good one from the client — but the reason is now always logged,
      // never silently discarded.
      logGoogleAdsDiscoveryError(topLevelId, err);
      continue;
    }
    for (const row of rows) {
      const cc = row.customerClient as Record<string, unknown> | undefined;
      if (!cc || !isSelectableGoogleAdsAccount(cc)) continue;
      const level = Number(cc.level ?? 0);
      const clientCustomer = typeof cc.clientCustomer === "string" ? cc.clientCustomer.replace("customers/", "") : topLevelId;
      accounts.push({
        customerId: clientCustomer,
        loginCustomerId: level > 0 ? topLevelId : null,
        descriptiveName: typeof cc.descriptiveName === "string" ? cc.descriptiveName : null,
        currencyCode: typeof cc.currencyCode === "string" ? cc.currencyCode : null,
        timeZone: typeof cc.timeZone === "string" ? cc.timeZone : null,
      });
    }
  }

  // De-dupe — the same client account can in principle be reachable
  // through more than one manager path; keep the first discovered entry.
  const seen = new Set<string>();
  return accounts.filter((a) => (seen.has(a.customerId) ? false : (seen.add(a.customerId), true)));
}

export async function getGoogleAdsAccountsForOrganization(organizationId: string): Promise<DiscoveredGoogleAdsAccount[]> {
  const accessToken = await getValidGoogleAdsAccessToken(organizationId);
  return discoverGoogleAdsAccounts(accessToken);
}

/**
 * Persists the client's chosen account — ONLY after re-verifying, with a
 * FRESH discovery call using the connection's own OAuth token, that this
 * exact customerId is genuinely accessible right now. A customerId
 * submitted by the browser is never trusted on its own — this is the
 * mission's own explicit requirement ("Ne jamais faire confiance à un
 * Customer ID fourni directement par le frontend sans vérifier que le
 * token OAuth de l'utilisateur a réellement accès à ce compte").
 */
export async function selectGoogleAdsAccount(organizationId: string, customerId: string): Promise<DiscoveredGoogleAdsAccount> {
  const accounts = await getGoogleAdsAccountsForOrganization(organizationId);
  const match = accounts.find((a) => a.customerId === customerId);
  if (!match) {
    throw new Error("Ce compte Google Ads n'est pas accessible avec l'autorisation actuelle — reconnectez-vous ou choisissez un autre compte.");
  }

  await db
    .update(googleAdsConnections)
    .set({
      customerId: match.customerId,
      loginCustomerId: match.loginCustomerId,
      customerDescriptiveName: match.descriptiveName,
      customerCurrencyCode: match.currencyCode,
      customerTimeZone: match.timeZone,
      updatedAt: new Date(),
    })
    .where(eq(googleAdsConnections.organizationId, organizationId));

  return match;
}

/** "Changer de compte" — clears the selected account WITHOUT disconnecting
 * the OAuth grant itself (the refresh token/scopes stay intact), so the
 * client goes back to the selection step rather than having to
 * re-authorize from scratch. */
export async function clearGoogleAdsAccountSelection(organizationId: string): Promise<void> {
  await db
    .update(googleAdsConnections)
    .set({
      customerId: null,
      loginCustomerId: null,
      customerDescriptiveName: null,
      customerCurrencyCode: null,
      customerTimeZone: null,
      lastSyncedAt: null,
      lastSyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(googleAdsConnections.organizationId, organizationId));
}
