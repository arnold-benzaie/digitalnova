import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase C-1 — the ONE server-side config
 * boundary for Discovery provider credentials. Mirrors
 * lib/radar-intelligence/config-loader.ts's exact discipline (that file's
 * own docstring: "the ONLY module... that reads process.env" for its
 * layer) — this is that same discipline for lib/radar-discovery/**.
 *
 * NO existing Google env var convention in this repo covers a Places API
 * key: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_OAUTH_REDIRECT_URI
 * (lib/google/oauth.ts) are an OAuth CLIENT credential for a completely
 * different auth flow (GBP/Search Console/Analytics, per-organization
 * consent) — Places API (New) uses a single, simple server API key, not
 * OAuth. Verified by repo-wide search before choosing this name (mission
 * section 2's explicit requirement) — no reuse was possible, so a new,
 * documented convention is introduced here: GOOGLE_PLACES_API_KEY +
 * GOOGLE_PLACES_ENABLED, the exact same {ENABLED, API_KEY} shape
 * radar-intelligence's own config-loader.ts already established for
 * Anthropic/OpenAI — same fail-closed rules, same reasoning.
 *
 * FAIL-CLOSED: `enabledFlag` is true ONLY when the env var is exactly
 * "true" or "1". `effectiveEnabled` requires BOTH the flag AND a
 * non-empty credential — an enabled flag with no key never calls Google
 * (mission section 9: "ne jamais considérer une absence de clé API comme
 * une raison pour effectuer un appel" holds in the other direction too:
 * a key with the flag off must also never call). Unset env -> disabled,
 * Discovery Core unaffected, no external call.
 *
 * `apiKey` is server-only, never serialized to a client, and the
 * configured-provider factory (configured-google-places.ts) consumes it
 * ONLY to construct the HTTP transport, then lets it fall out of scope —
 * never logged, never returned, never persisted.
 */

export const GOOGLE_PLACES_ENABLED_ENV_VAR = "GOOGLE_PLACES_ENABLED";
export const GOOGLE_PLACES_API_KEY_ENV_VAR = "GOOGLE_PLACES_API_KEY";
export const GOOGLE_PLACES_ENABLED_TRUE_VALUES = ["true", "1"];

export type LoadedGooglePlacesConfig = {
  enabledFlag: boolean;
  hasCredential: boolean;
  effectiveEnabled: boolean;
  /** Never logged / serialized to a client. null unless hasCredential. */
  apiKey: string | null;
};

export type LoadedRadarDiscoveryConfig = {
  googlePlaces: LoadedGooglePlacesConfig;
};

type EnvLike = Record<string, string | undefined>;

/**
 * @param env injectable for tests — defaults to process.env, the only
 *            place this module (and lib/radar-discovery/** as a whole)
 *            reads it.
 */
export function loadRadarDiscoveryConfig(env: EnvLike = process.env): LoadedRadarDiscoveryConfig {
  const rawEnabled = typeof env[GOOGLE_PLACES_ENABLED_ENV_VAR] === "string" ? env[GOOGLE_PLACES_ENABLED_ENV_VAR]!.trim() : "";
  const enabledFlag = GOOGLE_PLACES_ENABLED_TRUE_VALUES.includes(rawEnabled);

  const rawKey = typeof env[GOOGLE_PLACES_API_KEY_ENV_VAR] === "string" ? env[GOOGLE_PLACES_API_KEY_ENV_VAR]!.trim() : "";
  const hasCredential = rawKey.length > 0;

  return {
    googlePlaces: {
      enabledFlag,
      hasCredential,
      effectiveEnabled: enabledFlag && hasCredential,
      apiKey: hasCredential ? rawKey : null,
    },
  };
}
