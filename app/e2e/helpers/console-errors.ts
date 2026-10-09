// PHASE T-1.4-D — shared console/page error collector for the E2E suite.
//
// Several specs assert "the page opened with no runtime errors" by
// collecting `pageerror` + every `console` message of type "error" and
// requiring the bucket to be empty. That over-collects: Chromium AUTO-LOGS
// a console `error` for ANY subresource/navigation the page fails to load,
// e.g.
//
//   Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR
//
// which is browser transport noise, not an application runtime error — and
// it is provably flaky here (T-1.4-C): the Clerk *Development* browser SDK
// opportunistically fires a background `https://localhost:3600/sign-in`
// handshake that the plain-HTTP local dev server cannot answer, producing
// exactly that line at random points in a long suite run. The page itself
// stays authenticated and renders normally.
//
// This helper records EVERY `pageerror` and EVERY meaningful
// `console.error(...)`, and drops ONLY the one proven-noisy shape:
//
//   Failed to load resource: net::ERR_<UPPERCASE_CODE>
//
// Deliberately NARROW for this first fix (T-1.4-D §2):
//   - HTTP-status resource failures ("...the server responded with a
//     status of 404 / 500 ...") are STILL fatal — a first-party 4xx/5xx
//     can be a real regression, and we have no evidence they cause the
//     Clerk flake.
//   - CSP violations, hydration errors, React errors, authorization
//     errors, and any `console.error("<message>")` remain fatal.
//
// Pure test infrastructure: no timer, no network, no DB, no Clerk call,
// no application-runtime import.
import type { Page, ConsoleMessage } from "@playwright/test";

/**
 * True ONLY for Chromium's transport-layer resource-load console line:
 *   `Failed to load resource: net::ERR_<CODE>`
 * (e.g. ERR_SSL_PROTOCOL_ERROR, ERR_CONNECTION_REFUSED, ERR_FAILED,
 * ERR_NAME_NOT_RESOLVED, ERR_HTTP2_PROTOCOL_ERROR, …).
 *
 * NOT true for HTTP-status resource failures, messages that merely contain
 * "ERR_" somewhere, a bare "Failed to load resource", CSP reports, or any
 * application error. Anchored — never a substring `includes` check.
 */
export function isBrowserResourceLoadNoise(text: string): boolean {
  return /^Failed to load resource: net::ERR_[A-Z0-9_]+$/.test(text.trim());
}

/**
 * True ONLY for WebKit's own wording for a Next.js Link-prefetch RSC
 * fetch that got aborted by a same-test client-side navigation racing
 * ahead of it (confirmed 2026-10 via Playwright trace network inspection
 * on e2e/audit-module-coverage.spec.ts: the underlying GET always comes
 * back as a normal same-origin 200 `text/x-component` response — no real
 * CORS/CSP violation ever occurs). Chromium swallows the same
 * prefetch-cancellation silently; WebKit instead raises it as an
 * uncaught `pageerror` shaped exactly like:
 *   /localhost:<port>/<path>?...&_rsc=<token> due to access control checks.
 *
 * Deliberately narrow — NOT a bare substring check on "access control
 * checks": requires the `webkit` engine, the `localhost:<port>` host,
 * the `_rsc=` prefetch marker, and the exact trailing phrase, all at
 * once. A real application error happening to mention "access control"
 * (or WebKit's unrelated bare `TypeError: Load failed` for a genuine
 * network failure, which carries neither a URL nor `_rsc=`) never
 * matches this shape and stays fatal.
 *
 * Note: `_rsc=` is also present on a client-side RSC *navigation* fetch, not
 * only on a Link prefetch; this predicate sees only the message text and
 * cannot tell the two apart.
 */
export function isWebkitRscPrefetchAbortNoise(text: string, browserName: string): boolean {
  if (browserName !== "webkit") return false;
  return /^\/localhost:\d+\/\S*[?&]_rsc=\S+ due to access control checks\.$/.test(text.trim());
}

/**
 * True ONLY for a known-safe URL that this exact same navigation-abort
 * mechanism (see isWebkitRscPrefetchAbortNoise above) is already proven
 * to cancel: a same-origin Next.js Link-prefetch RSC fetch (`_rsc=` on
 * localhost), or the Clerk Development SDK's own periodic background
 * resync calls (`v1/client`, `v1/environment`) to its cross-origin
 * `*.clerk.accounts.dev` host. Confirmed 2026-10 via direct Playwright
 * trace network inspection of two real WebKit failures
 * (e2e/audit-module-coverage.spec.ts, e2e/full-lifecycle.spec.ts): in
 * both, these exact URL shapes showed `status: -1` (canceled, never a
 * response) at the same moment sibling requests with the same `_rsc=`
 * token returned a normal 200 — i.e. the server was up and answering,
 * the browser canceled the request client-side because of a fast
 * navigation. Never true for any other URL shape, including any other
 * cross-origin host.
 */
function isKnownSafeCanceledResource(url: string): boolean {
  if (/^http:\/\/localhost:\d+\/\S*[?&]_rsc=/.test(url)) return true;
  if (/^https:\/\/[^/]+\.clerk\.accounts\.dev\/v1\/(client|environment)(\?|$)/.test(url)) return true;
  return false;
}

export type KnownNavigationFailureContext = {
  /**
   * URLs of requests that failed/were canceled within a short window
   * immediately before this pageerror fired, if any are known to the
   * caller. Deliberately the ONLY context this predicate accepts —
   * WebKit's `TypeError: Load failed` pageerror carries no URL or
   * request id of its own, so correlating it with a specific canceled
   * request is the caller's (collectConsoleErrors's) responsibility via
   * `page.on("requestfailed", ...)`; this function only judges whether
   * ANY of the URLs it's given look like one of the two proven-safe
   * cancellation shapes above.
   */
  recentlyFailedRequestUrls?: readonly string[];
};

/**
 * True ONLY for WebKit's bare, URL-less wording for the SAME proven
 * navigation-abort mechanism as isWebkitRscPrefetchAbortNoise — observed
 * as a sibling shape in the same two real failures (2026-10): instead of
 * `"<url> due to access control checks."`, WebKit sometimes raises just
 * `"TypeError: Load failed"` with no URL attached to the exception
 * itself. Since this exact message could equally be a genuine
 * application fetch failure, it is NEVER filtered on the message alone
 * — only when ALSO correlated (via `context`) with a request to one of
 * the two independently-proven-safe URL shapes having failed/canceled
 * in the same short window. No context -> never filtered (the correct,
 * conservative default: better to leave the test flaky than risk hiding
 * a real error — see collectConsoleErrors's own CORRELATION_WINDOW_MS
 * for how that window is sized).
 *
 * KNOWN LIMITATION (documented, not silently assumed away): this
 * doesn't check the canceled request's own failure reason
 * (Playwright's `request.failure()?.errorText`), which would let this
 * be tightened further (e.g. requiring WebKit's own cancellation-style
 * errorText specifically, not just "any failure"). That value hasn't
 * been empirically captured yet — doing so needs a live, instrumented
 * WebKit run, deliberately deferred to a separate, explicitly-scoped
 * mission rather than guessed at here.
 */
export function isWebkitKnownNavigationLoadFailedNoise(text: string, browserName: string, context: KnownNavigationFailureContext): boolean {
  if (browserName !== "webkit") return false;
  if (text.trim() !== "TypeError: Load failed") return false;
  const urls = context.recentlyFailedRequestUrls ?? [];
  // 4F.12-B — ALL correlated failures must be proven-safe, not just one: a
  // genuine app fetch failing in the same window shows up here as a
  // non-safe URL, and must keep the error fatal.
  return urls.length > 0 && urls.every(isKnownSafeCanceledResource);
}

export type ConsoleErrorCollector = {
  /**
   * Uncaught JS exceptions (`[pageerror] …`) plus meaningful
   * `console.error` (`[console] …`), in arrival order. A live array — read
   * it at assertion time. Assert `expect(collector.errors).toEqual([])`.
   */
  readonly errors: string[];
};

// How recent a canceled request must be, relative to a pageerror, to be
// considered its likely cause by isWebkitKnownNavigationLoadFailedNoise.
// Deliberately short: long enough to tolerate realistic event-ordering
// jitter between `requestfailed` and `pageerror` for the SAME cancellation,
// short enough that a failure from a much earlier, unrelated point in a
// long test (e2e/full-lifecycle.spec.ts navigates dozens of times) can
// never be mistaken for this one's cause.
export const CORRELATION_WINDOW_MS = 2000;
// How many recent failed-request URLs to remember at once — several
// sibling prefetches can fail within the same instant (confirmed in both
// real failures), so a single most-recent slot isn't enough.
export const MAX_TRACKED_FAILED_REQUESTS = 10;

export type FailedRequestEntry = { url: string; at: number };

/** Appends `entry` to the rolling buffer, dropping the oldest entries beyond `max`. */
export function recordFailedRequest(buffer: FailedRequestEntry[], entry: FailedRequestEntry, max = MAX_TRACKED_FAILED_REQUESTS): void {
  buffer.push(entry);
  while (buffer.length > max) buffer.shift();
}

/** URLs of the buffered failures at most `windowMs` old at `now` (inclusive bound). */
export function recentFailedUrls(buffer: readonly FailedRequestEntry[], now: number, windowMs = CORRELATION_WINDOW_MS): string[] {
  return buffer.filter((r) => now - r.at <= windowMs).map((r) => r.url);
}

/**
 * Attach `pageerror` + `console` listeners to `page` for its lifetime and
 * return an isolated per-call collector. No global state — call it once
 * per page/test.
 */
export function collectConsoleErrors(page: Page): ConsoleErrorCollector {
  const errors: string[] = [];
  const browserName = page.context().browser()?.browserType().name() ?? "";

  // Minimal extension of context needed by isWebkitKnownNavigationLoadFailedNoise
  // (see that function's own docs) — a rolling buffer of {url, at}, pruned
  // to CORRELATION_WINDOW_MS at read time, never used for anything else.
  const recentlyFailedRequests: FailedRequestEntry[] = [];
  page.on("requestfailed", (request) => {
    recordFailedRequest(recentlyFailedRequests, { url: request.url(), at: Date.now() });
  });

  page.on("pageerror", (err) => {
    const recentlyFailedRequestUrls = recentFailedUrls(recentlyFailedRequests, Date.now());
    if (isWebkitKnownNavigationLoadFailedNoise(err.message, browserName, { recentlyFailedRequestUrls })) return;
    if (isWebkitRscPrefetchAbortNoise(err.message, browserName)) return;
    errors.push(`[pageerror] ${err.message}`);
  });

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isBrowserResourceLoadNoise(text)) return;
    errors.push(`[console] ${text}`);
  });

  return { errors };
}
