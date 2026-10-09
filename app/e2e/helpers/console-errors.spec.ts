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

import {
  CORRELATION_WINDOW_MS,
  MAX_TRACKED_FAILED_REQUESTS,
  isBrowserResourceLoadNoise,
  isWebkitKnownNavigationLoadFailedNoise,
  isWebkitRscPrefetchAbortNoise,
  recentFailedUrls,
  recordFailedRequest,
  type FailedRequestEntry,
} from "./console-errors";

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

// --- isWebkitRscPrefetchAbortNoise: the 2026-10 WebKit Link-prefetch-abort flake ---

const WEBKIT_PREFETCH_ABORT_IGNORE = [
  "/localhost:3600/admin/audit/liste?sort=score&dir=asc&_rsc=0yLwRauoNzWZWd-Y due to access control checks.",
  "/localhost:3600/admin/audit/nouveau?_rsc=GJRGSB3Irqjndfiq due to access control checks.",
  "/localhost:3600/admin/audit/e56819a9-d0bb-4e6e-8175-cc035a50a70a?_rsc=cjGxwq79WnrAte-X due to access control checks.",
];

test("isWebkitRscPrefetchAbortNoise ignores ONLY the exact WebKit RSC-prefetch-abort shape, and only under webkit", () => {
  for (const text of WEBKIT_PREFETCH_ABORT_IGNORE) {
    expect(isWebkitRscPrefetchAbortNoise(text, "webkit"), `should ignore under webkit: ${JSON.stringify(text)}`).toBe(true);
  }
});

test("isWebkitRscPrefetchAbortNoise never ignores the same message under chromium/firefox", () => {
  for (const text of WEBKIT_PREFETCH_ABORT_IGNORE) {
    expect(isWebkitRscPrefetchAbortNoise(text, "chromium")).toBe(false);
    expect(isWebkitRscPrefetchAbortNoise(text, "firefox")).toBe(false);
    expect(isWebkitRscPrefetchAbortNoise(text, "")).toBe(false);
  }
});

test("isWebkitRscPrefetchAbortNoise never ignores WebKit's generic, URL-less abort message", () => {
  // The sibling shape actually observed on retry — no URL, no `_rsc=`, so a
  // real app-level "Load failed" elsewhere could produce the exact same
  // text. Must stay fatal.
  expect(isWebkitRscPrefetchAbortNoise("TypeError: Load failed", "webkit")).toBe(false);
});

test("isWebkitRscPrefetchAbortNoise never ignores a non-localhost host, a missing _rsc marker, or a real app error mentioning the phrase", () => {
  expect(isWebkitRscPrefetchAbortNoise("/example.com/admin/audit/liste?_rsc=abc due to access control checks.", "webkit")).toBe(false);
  expect(isWebkitRscPrefetchAbortNoise("/localhost:3600/admin/audit/liste?sort=score due to access control checks.", "webkit")).toBe(false);
  expect(isWebkitRscPrefetchAbortNoise("TypeError: blocked due to access control checks.", "webkit")).toBe(false);
  expect(isWebkitRscPrefetchAbortNoise("/localhost:3600/admin/audit/liste?_rsc=abc due to access control checks. extra trailing text", "webkit")).toBe(false);
});

// --- isWebkitKnownNavigationLoadFailedNoise: the bare, URL-less sibling shape ---

const RSC_CANCELED_URL = "http://localhost:3600/admin/audit/liste?_rsc=0yLwRauoNzWZWd-Y";
const CLERK_CLIENT_CANCELED_URL = "https://next-akita-2.clerk.accounts.dev/v1/client?__clerk_api_version=2026-05-12&__clerk_db_jwt=dvb_x";
const CLERK_ENV_CANCELED_URL = "https://next-akita-2.clerk.accounts.dev/v1/environment?__clerk_api_version=2026-05-12&_method=PATCH";

test("case 1: webkit + exact message + a canceled RSC request in context -> filtered", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [RSC_CANCELED_URL] })).toBe(true);
});

test("case 2: webkit + exact message + a canceled Clerk v1/client or v1/environment request in context -> filtered", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [CLERK_CLIENT_CANCELED_URL] })).toBe(true);
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [CLERK_ENV_CANCELED_URL] })).toBe(true);
});

test("case 3: chromium + the exact same message and context -> never filtered (engine-specific)", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "chromium", { recentlyFailedRequestUrls: [RSC_CANCELED_URL] })).toBe(false);
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "firefox", { recentlyFailedRequestUrls: [CLERK_CLIENT_CANCELED_URL] })).toBe(false);
});

test("case 4: webkit + exact message + no known context at all -> never filtered (conservative default)", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", {})).toBe(false);
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [] })).toBe(false);
});

test("case 5: webkit + a real application error that merely mentions 'Load failed' but has no known-safe context -> never filtered", () => {
  // Not an exact match on the anchored phrase — a genuine app error could
  // legitimately contain this text as part of a longer message.
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed to fetch client data", "webkit", { recentlyFailedRequestUrls: [RSC_CANCELED_URL] })).toBe(false);
  expect(isWebkitKnownNavigationLoadFailedNoise("Error: Load failed: payment rejected", "webkit", { recentlyFailedRequestUrls: [CLERK_CLIENT_CANCELED_URL] })).toBe(false);
  // Exact message, but the only context available is an UNRELATED failed
  // resource (e.g. a genuinely broken third-party image) — must stay fatal.
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: ["https://example.com/broken-image.png"] })).toBe(false);
});

test("isWebkitKnownNavigationLoadFailedNoise never becomes a blanket 'ignore all TypeError Load failed under webkit' rule", () => {
  // Same exact message, same engine, across many irrelevant contexts —
  // every single one must stay fatal; only the two proven-safe URL
  // shapes ever flip this to true.
  const irrelevantContexts = [
    {},
    { recentlyFailedRequestUrls: [] },
    { recentlyFailedRequestUrls: ["https://api.example.com/webhook"] },
    { recentlyFailedRequestUrls: ["http://localhost:3600/admin/audit/liste"] }, // no _rsc=
    { recentlyFailedRequestUrls: ["https://clerk.accounts.dev.evil.example.com/v1/client"] }, // lookalike host
    { recentlyFailedRequestUrls: ["https://other-app.clerk.accounts.dev/v1/sessions"] }, // right host, wrong path
  ];
  for (const context of irrelevantContexts) {
    expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", context), `must stay fatal for ${JSON.stringify(context)}`).toBe(false);
  }
});

// --- 4F.12-B: every correlated failure must be proven-safe (not just one) ---

const UNSAFE_API_URL = "https://api.example.com/x";
const LOCALHOST_NO_RSC_URL = "http://localhost:3600/admin/audit/liste";

test("4F.12-B: a safe RSC URL alone -> filtered under webkit", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [RSC_CANCELED_URL] })).toBe(true);
});

test("4F.12-B: a safe Clerk URL alone -> filtered under webkit", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [CLERK_CLIENT_CANCELED_URL] })).toBe(true);
});

test("4F.12-B: a safe RSC URL mixed with an unsafe API failure -> fatal", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [RSC_CANCELED_URL, UNSAFE_API_URL] })).toBe(false);
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [UNSAFE_API_URL, RSC_CANCELED_URL] })).toBe(false);
});

test("4F.12-B: a safe Clerk URL mixed with a localhost URL without _rsc -> fatal", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [CLERK_CLIENT_CANCELED_URL, LOCALHOST_NO_RSC_URL] })).toBe(false);
});

test("4F.12-B: an empty list -> fatal", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [] })).toBe(false);
});

test("4F.12-B: an unsafe URL alone -> fatal", () => {
  expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", "webkit", { recentlyFailedRequestUrls: [UNSAFE_API_URL] })).toBe(false);
});

test("4F.12-B: every one of these contexts stays fatal under chromium and firefox", () => {
  const contexts = [
    { recentlyFailedRequestUrls: [RSC_CANCELED_URL] },
    { recentlyFailedRequestUrls: [CLERK_CLIENT_CANCELED_URL] },
    { recentlyFailedRequestUrls: [RSC_CANCELED_URL, UNSAFE_API_URL] },
    { recentlyFailedRequestUrls: [CLERK_CLIENT_CANCELED_URL, LOCALHOST_NO_RSC_URL] },
    { recentlyFailedRequestUrls: [] },
    { recentlyFailedRequestUrls: [UNSAFE_API_URL] },
  ];
  for (const browser of ["chromium", "firefox"]) {
    for (const context of contexts) {
      expect(isWebkitKnownNavigationLoadFailedNoise("TypeError: Load failed", browser, context), `${browser} must stay fatal for ${JSON.stringify(context)}`).toBe(false);
    }
  }
});

// --- 4F.12-B: correlation window and bounded buffer of the collector ---

test("4F.12-B: recentFailedUrls keeps a failure exactly at the window bound and drops one just past it", () => {
  const now = 1_000_000;
  const buffer = [
    { url: "at-bound", at: now - CORRELATION_WINDOW_MS },
    { url: "past-bound", at: now - (CORRELATION_WINDOW_MS + 1) },
    { url: "fresh", at: now },
  ];
  expect(CORRELATION_WINDOW_MS).toBe(2000);
  expect(recentFailedUrls(buffer, now)).toEqual(["at-bound", "fresh"]);
});

test("4F.12-B: recordFailedRequest never keeps more than the bounded number of entries, dropping the oldest", () => {
  expect(MAX_TRACKED_FAILED_REQUESTS).toBe(10);
  const buffer: FailedRequestEntry[] = [];
  for (let i = 0; i < 15; i++) recordFailedRequest(buffer, { url: `u${i}`, at: i });
  expect(buffer).toHaveLength(MAX_TRACKED_FAILED_REQUESTS);
  expect(buffer.map((e) => e.url)).toEqual(["u5", "u6", "u7", "u8", "u9", "u10", "u11", "u12", "u13", "u14"]);
});
