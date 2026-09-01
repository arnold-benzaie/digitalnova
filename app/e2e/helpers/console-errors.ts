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

export type ConsoleErrorCollector = {
  /**
   * Uncaught JS exceptions (`[pageerror] …`) plus meaningful
   * `console.error` (`[console] …`), in arrival order. A live array — read
   * it at assertion time. Assert `expect(collector.errors).toEqual([])`.
   */
  readonly errors: string[];
};

/**
 * Attach `pageerror` + `console` listeners to `page` for its lifetime and
 * return an isolated per-call collector. No global state — call it once
 * per page/test.
 */
export function collectConsoleErrors(page: Page): ConsoleErrorCollector {
  const errors: string[] = [];

  page.on("pageerror", (err) => {
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
