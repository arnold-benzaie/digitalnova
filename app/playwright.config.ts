import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite for PUBLIC-MAP Audit only. Runs against an ALREADY-RUNNING dev
 * server (no `webServer` block here on purpose) — this suite must never be
 * responsible for choosing which database that server talks to; that
 * responsibility stays with whoever started `npm run dev` and is verified
 * independently in e2e/global-setup.ts. See e2e/README.md.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Generous, not arbitrary: this dev server compiles routes on first
  // request (webpack, not turbopack) — earlier manual testing this session
  // repeatedly saw 15-20s first-loads on individual pages. The full
  // lifecycle test visits ~10 distinct routes in one run.
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3600",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Single desktop project — full-lifecycle.spec.ts runs once, not once per
  // viewport (it creates and cleans up real data; tripling it would triple
  // that for no benefit). Responsive coverage lives inside
  // e2e/responsive.spec.ts, which opens its own contexts per viewport.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
