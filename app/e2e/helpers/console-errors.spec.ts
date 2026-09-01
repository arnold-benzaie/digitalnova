// PHASE T-1.4-D — tests for the pure predicate in
// e2e/helpers/console-errors.ts.
//
// A @playwright/test spec (not node:test): it lives under `testDir: "./e2e"`,
// so anything named `*.test.mjs` here is auto-collected by Playwright and
// would side-effect-run its node:test bodies during collection. This form
// is collected as a normal, fast, browser-less Playwright test instead.
//
// No `page` / no browser is used — these are pure string-classification
// assertions on isBrowserResourceLoadNoise().
import { expect, test } from "@playwright/test";

import { isBrowserResourceLoadNoise } from "./console-errors";

// --- MUST be classified as ignorable browser transport noise ----------
const IGNORE = [
  "Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR", // the T-1.4-C flake
  "Failed to load resource: net::ERR_CONNECTION_REFUSED",
  "Failed to load resource: net::ERR_FAILED",
  "Failed to load resource: net::ERR_NAME_NOT_RESOLVED",
  "Failed to load resource: net::ERR_HTTP2_PROTOCOL_ERROR", // codes may carry digits
  "  Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR  ", // surrounding whitespace normalized
];

// --- MUST remain visible / fatal -------------------------------------
const RETAIN = [
  "Failed to load resource: the server responded with a status of 404 (Not Found)",
  "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  "TypeError: Cannot read properties of undefined (reading 'x')",
  "Some app error mentioning ERR_SSL_PROTOCOL_ERROR", // contains the code, but not the anchored shape
  "ERR_CONNECTION_REFUSED", // bare code, not the full line
  "Failed to load resource", // no `net::ERR_` / status suffix — be conservative
  "[Report Only] Refused to connect because it violates the following Content Security Policy directive",
  "Warning: An update to Foo inside a test was not wrapped in act(...)", // React noise still surfaces (not our call to hide)
  "Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR — https://example.test/x", // trailing detail => not the exact shape
  "prefix Failed to load resource: net::ERR_FAILED", // not anchored at start
  "",
];

test("isBrowserResourceLoadNoise ignores ONLY the anchored Chromium net::ERR_<CODE> resource-load shape", () => {
  for (const text of IGNORE) {
    expect(isBrowserResourceLoadNoise(text), `should ignore: ${JSON.stringify(text)}`).toBe(true);
  }
});

test("isBrowserResourceLoadNoise retains HTTP 4xx/5xx resource errors, JS exceptions, CSP, and near-misses", () => {
  for (const text of RETAIN) {
    expect(isBrowserResourceLoadNoise(text), `should retain: ${JSON.stringify(text)}`).toBe(false);
  }
});

test("isBrowserResourceLoadNoise does not use a bare substring match on 'ERR_'", () => {
  expect(isBrowserResourceLoadNoise("something ERR_ something")).toBe(false);
  // missing the 'Failed to load resource: ' prefix
  expect(isBrowserResourceLoadNoise("net::ERR_SSL_PROTOCOL_ERROR")).toBe(false);
});
