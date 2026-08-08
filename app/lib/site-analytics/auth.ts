import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient, type BaseExternalAccountClient } from "google-auth-library";

/**
 * Workload Identity Federation auth for PUBLIC-MAP's OWN GA4 property (a
 * single fixed property, not a per-client one) — deliberately separate
 * from lib/analytics/real-provider.ts, which authenticates per-
 * organization via OAuth against a CLIENT's property.
 *
 * No service-account JSON key is ever created or stored: the org's
 * `iam.disableServiceAccountKeyCreation` policy forbids it (a deliberate
 * security choice we respect, not work around). Instead, Vercel issues a
 * short-lived OIDC token per request/build; Google Cloud exchanges it via
 * Workload Identity Federation for a token that impersonates the already-
 * authorized service account. See the Google Cloud console setup (pool
 * `vercel`, provider `vercel`, principal scoped to
 * `environment:preview` only) documented in the project's setup notes —
 * that IAM scoping, not this code, is what keeps Production unable to
 * authenticate even though OIDC issuance is a project-wide Vercel toggle.
 *
 * Mirrors the "degrade cleanly instead of throwing" convention already
 * used for RESEND_API_KEY (lib/email/resend.ts): with any of the env vars
 * below missing, callers get a clear reason string instead of a crash, so
 * the dashboard can render an "unavailable" state per section rather than
 * a broken page.
 *
 * GA4_PROPERTY_ID is the numeric GA4 property id ("123456789", found in
 * GA4 Admin > Property Settings) — NOT the gtag.js measurement id
 * (G-DSRTDWQ0P2), which is a different identifier used only by the
 * client-side tag.
 */

type Ga4AuthResult = { ok: true; auth: BaseExternalAccountClient; propertyId: string } | { ok: false; reason: string };

let cached: Ga4AuthResult | null = null;

function readRequiredEnv(): { projectNumber: string; serviceAccountEmail: string; poolId: string; providerId: string; propertyId: string } | { error: string } {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const propertyId = process.env.GA4_PROPERTY_ID;

  const missing = [
    !projectNumber && "GCP_PROJECT_NUMBER",
    !serviceAccountEmail && "GCP_SERVICE_ACCOUNT_EMAIL",
    !poolId && "GCP_WORKLOAD_IDENTITY_POOL_ID",
    !providerId && "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
    !propertyId && "GA4_PROPERTY_ID",
  ].filter(Boolean);
  if (missing.length > 0) return { error: `Missing env var(s): ${missing.join(", ")}.` };

  return { projectNumber: projectNumber!, serviceAccountEmail: serviceAccountEmail!, poolId: poolId!, providerId: providerId!, propertyId: propertyId! };
}

export function getGa4Auth(): Ga4AuthResult {
  if (cached) return cached;

  const env = readRequiredEnv();
  if ("error" in env) {
    cached = { ok: false, reason: env.error };
    return cached;
  }

  try {
    // The GCP provider is configured with an "Allowed audience"
    // (https://vercel.com/[team-slug]) rather than Google's self-
    // describing "Default audience" — so the subject token's `aud` claim
    // must be Vercel's own default OIDC audience (no `audience` option
    // passed to getVercelOidcToken; it defaults to that value already).
    // The `audience` field below is unrelated: it's the STS routing
    // parameter identifying which pool/provider to exchange against, not
    // the token's own `aud` claim — always the resource-path format
    // regardless of which audience mode the provider uses.
    const auth = ExternalAccountClient.fromJSON({
      type: "external_account",
      audience: `//iam.googleapis.com/projects/${env.projectNumber}/locations/global/workloadIdentityPools/${env.poolId}/providers/${env.providerId}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.serviceAccountEmail}:generateAccessToken`,
      subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
    });
    if (auth) auth.scopes = ["https://www.googleapis.com/auth/analytics.readonly"];
    if (!auth) throw new Error("ExternalAccountClient.fromJSON returned null — check the external_account config shape.");
    cached = { ok: true, auth, propertyId: env.propertyId };
  } catch (err) {
    cached = { ok: false, reason: err instanceof Error ? err.message : "Failed to initialize GA4 Workload Identity Federation auth." };
  }
  return cached;
}
