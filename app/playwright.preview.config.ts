import { defineConfig, devices } from "@playwright/test";

/**
 * Separate config for real E2E validation against the live Vercel Preview
 * deployment (see e2e-preview/) — never the local dev server. Reuses the
 * authenticated storageState produced by e2e-preview/auth-setup.mjs (a
 * real Clerk session via Clerk's own sign-in-token API, no password).
 *
 * Deliberately does NOT set extraHTTPHeaders for the Vercel protection
 * bypass secret here — that would apply to EVERY request in the context,
 * including cross-origin ones to Clerk's own CDN, breaking ITS CORS
 * preflight (reproduced and diagnosed earlier this session). Each spec
 * scopes the header itself via context.route(), see e2e-preview/fixtures.ts.
 */
export const PREVIEW_ORIGIN = "https://app-jdfcwphuy-arnold-benzaies-projects.vercel.app";

export default defineConfig({
  testDir: "./e2e-preview",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e-preview/report", open: "never" }]],
  use: {
    baseURL: PREVIEW_ORIGIN,
    storageState: "playwright/.auth/preview-admin.json",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
