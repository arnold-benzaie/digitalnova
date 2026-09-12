/**
 * RADAR INTELLIGENCE V2.1 — Phase E — the current capability of this
 * codebase's credential-rotation path for a THIRD-PARTY provider
 * credential (Anthropic/OpenAI API key).
 *
 * A plain constant, deliberately NOT inside a "use server" action file
 * (Next.js only allows async function exports there) — both the OWNER
 * page and lib/actions/radar-ai-provider-ops.ts import it from here.
 *
 * `rotateDeveloperApiKey` / `rotateIntegrationApiKey` /
 * `rotateWebhookEndpointSecret` elsewhere in this repo all rotate
 * PUBLIC-MAP's OWN issued secrets (hashed, stored in this DB) — a
 * completely different concern from writing a value into Vercel's
 * Production environment for a third-party provider. No server-side
 * secret-manager write path for that exists in this codebase, so this is
 * fixed at "external-only" — never computed from a feature flag or env
 * probe, so it can never drift into silently claiming a write path
 * exists. It changes only when a genuinely reviewed secret-manager write
 * path is introduced in a future, separately authorized mission.
 */
export const CREDENTIAL_OPERATIONS_CAPABILITY = "external-only" as const;
export type CredentialOperationsCapability = typeof CREDENTIAL_OPERATIONS_CAPABILITY;
