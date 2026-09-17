import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase C-1 — the REAL server-side Google Places
 * API (New) transport. SERVER-ONLY: the `server-only` import above makes
 * this module un-bundleable into any client component.
 *
 * Mirrors lib/radar-intelligence/adapters/anthropic-http-transport.ts's
 * exact discipline: AbortController-based timeout, credential captured
 * ONLY in this factory's closure (never stored on the returned object,
 * never logged, never in an error), a fixed generic error on any failure
 * (name preserved for AbortError so the caller maps it to PROVIDER_TIMEOUT).
 *
 * AUTH: Places API (New) authenticates via the `X-Goog-Api-Key` HTTP
 * header (never a URL query parameter — a key in a URL risks leaking into
 * access logs/referrers/browser history; this transport never runs in a
 * browser anyway, but the discipline is the same one already applied
 * throughout this codebase's other providers). `X-Goog-FieldMask` carries
 * the field mask this transport receives verbatim from the caller — it
 * never constructs or edits it (google-places.ts's buildGooglePlacesFieldMask
 * owns that).
 *
 * TIMEOUT: mission section 7 — a single, explicit, centralized, testable
 * ceiling. No gateway/race exists yet in this phase (C-1 has no
 * multi-provider dispatch loop — see provider registry's own C-0
 * docstring on why that is a later phase), so THIS transport's own
 * AbortController is the ONLY timeout enforcement point, unlike
 * Anthropic's transport (whose timeout is a defensive SECOND ceiling
 * behind the gateway's own race).
 */
import type { GooglePlacesDetailsRequestDescriptor, GooglePlacesSearchRequestDescriptor } from "./google-places";

export const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
/** MISSION C-2D-4-E — base for Place Details (New) GET lookups; the real
 * placeId is appended per-call, never baked into this constant. A
 * SEPARATE base from the Text Search URL — the two endpoints are
 * genuinely different Google resources (POST search vs. GET one place),
 * never a shared code path. */
export const GOOGLE_PLACES_DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";
/** Centralized, single source of truth for this transport's timeout —
 * mission section 7: "la valeur du timeout doit être centralisée/
 * configurable". Not shared with radar-intelligence's own gateway timeout
 * (a different domain, different cost profile) — reusing THAT constant
 * would be an arbitrary coupling, not a genuine shared concern. */
export const DEFAULT_GOOGLE_PLACES_REQUEST_TIMEOUT_MS = 8_000;

export type GooglePlacesHttpTransportOptions = {
  /** The credential. Lives ONLY in this closure. */
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** MISSION C-2D-4-E — independent override from `baseUrl` (Text
   * Search's own base) — the two endpoints are never coupled. */
  detailsBaseUrl?: string;
  requestTimeoutMs?: number;
};

export type GooglePlacesTransportResult = {
  /** Raw-ish provider body; normalized by google-places.ts's own pure
   * functions, never trusted or passed upstream as-is. */
  body: unknown;
  status: number;
};

export interface GooglePlacesTransport {
  /** MUST reject (not resolve) on transport/network failure so the
   * caller's classifyGooglePlacesError()/toDiscoveryError() runs. MUST
   * NOT leak a credential in any thrown value. */
  searchText(descriptor: GooglePlacesSearchRequestDescriptor): Promise<GooglePlacesTransportResult>;
  /** MISSION C-2D-4-E — same contract as searchText(): MUST reject (never
   * resolve with a placeholder) on transport/network failure, MUST NOT
   * leak the credential. A GET request, never a POST body. */
  getDetails(descriptor: GooglePlacesDetailsRequestDescriptor): Promise<GooglePlacesTransportResult>;
}

function genericTransportError(name: string): Error {
  const err = new Error("google places transport request failed");
  err.name = name;
  return err;
}

/**
 * Constructs the real transport. Throws immediately (never returns a
 * transport that would silently fail on first use) if the credential is
 * missing/empty — mirrors anthropic-http-transport.ts's identical guard.
 * The caller (configured-google-places.ts) never constructs this without
 * an already-verified, non-empty key (mission section 9: absence of a key
 * is never itself a reason an attempt happens).
 */
export function createGooglePlacesHttpTransport(options: GooglePlacesHttpTransportOptions): GooglePlacesTransport {
  const apiKey = options.apiKey;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const url = options.baseUrl ?? GOOGLE_PLACES_TEXT_SEARCH_URL;
  const detailsUrl = options.detailsBaseUrl ?? GOOGLE_PLACES_DETAILS_BASE_URL;
  const timeoutMs =
    typeof options.requestTimeoutMs === "number" && Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
      ? Math.min(30_000, Math.trunc(options.requestTimeoutMs))
      : DEFAULT_GOOGLE_PLACES_REQUEST_TIMEOUT_MS;

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("google places http transport requires an api key");
  }
  if (typeof doFetch !== "function") {
    throw new Error("google places http transport requires a fetch implementation");
  }

  return {
    async searchText(descriptor: GooglePlacesSearchRequestDescriptor): Promise<GooglePlacesTransportResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await doFetch(url, {
          method: descriptor.method,
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": descriptor.fieldMask,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(descriptor.body),
          signal: controller.signal,
        });
      } catch (thrown) {
        clearTimeout(timer);
        const name = typeof thrown === "object" && thrown !== null && "name" in thrown ? String((thrown as { name?: unknown }).name) : "";
        if (name === "AbortError" || name === "TimeoutError") throw genericTransportError("AbortError");
        throw genericTransportError("TransportNetworkError");
      }
      clearTimeout(timer);

      const status = res.status;
      if (status < 200 || status >= 300) {
        // Error body IS read (Google's error envelope carries the safe,
        // documented `status`/`code` gRPC-style classification
        // classifyGooglePlacesError() needs) — but never the raw text is
        // propagated further than that one classification function, and
        // `message` inside it is never logged (see google-places.ts's own
        // discipline).
        let errorBody: unknown = null;
        try {
          errorBody = await res.json();
        } catch {
          // Non-JSON error body -- classification falls back to the
          // HTTP status alone.
        }
        return { body: errorBody, status };
      }

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        throw genericTransportError("InvalidJsonError");
      }
      return { body: parsed, status };
    },

    // MISSION C-2D-4-E — a GET, never a POST: no request body, the
    // placeId is part of the URL path (never a query parameter, same
    // "never let identifying data leak into logs/referrers" discipline as
    // the API key header above). Shares this transport's own
    // AbortController-per-call timeout discipline, unchanged.
    async getDetails(descriptor: GooglePlacesDetailsRequestDescriptor): Promise<GooglePlacesTransportResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await doFetch(`${detailsUrl}/${encodeURIComponent(descriptor.placeId)}`, {
          method: descriptor.method,
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": descriptor.fieldMask,
          },
          signal: controller.signal,
        });
      } catch (thrown) {
        clearTimeout(timer);
        const name = typeof thrown === "object" && thrown !== null && "name" in thrown ? String((thrown as { name?: unknown }).name) : "";
        if (name === "AbortError" || name === "TimeoutError") throw genericTransportError("AbortError");
        throw genericTransportError("TransportNetworkError");
      }
      clearTimeout(timer);

      const status = res.status;
      if (status < 200 || status >= 300) {
        let errorBody: unknown = null;
        try {
          errorBody = await res.json();
        } catch {
          // Non-JSON error body -- classification falls back to the
          // HTTP status alone, same as searchText() above.
        }
        return { body: errorBody, status };
      }

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        throw genericTransportError("InvalidJsonError");
      }
      return { body: parsed, status };
    },
  };
}
