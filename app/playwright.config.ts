import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite for PUBLIC-MAP Audit only. Runs against a PRODUCTION-mode local
 * server (`next build` + `next start -p 3600` via the `build:e2e` /
 * `start:e2e` scripts — T-1.4-A Plan B). Production mode removes the two
 * things that made `next dev` unusable for a sustained ~83-test run: the
 * dev-only per-request heap watchdog that `process.exit(77)`s the worker,
 * and webpack on-demand recompilation / HMR-graph retention. There is no
 * dev watchdog code path under `next start`.
 *
 * The `webServer` block is a pre-suite HEALTH GATE, not a builder:
 * `reuseExistingServer: true` reuses whatever already listens on :3600 and
 * only polls it for readiness before the first test. It does NOT build — the
 * E2E workflow runs `npm run build:e2e` first (see e2e/README.md), so the
 * tested build always matches the working tree. The database target (Docker
 * local vs Supabase cloud) stays a decision of whoever starts the server:
 * the fallback `command` inherits the ambient env, and e2e/global-setup.ts
 * hard-fails the run if the target is not the local Audit test database.
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
  // Readiness gate only — see the file header. Reuses the already-running
  // production-mode server on :3600; the `command` is a fallback for a bare
  // `npm run test:e2e` with no server up. It only STARTS a build — run
  // `npm run build:e2e` first so the served `.next` matches the working tree.
  webServer: {
    command: "npm run start:e2e",
    url: "http://localhost:3600/api/gbp-audit/e2e-db-target",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3600",
    // Real Clerk session for the existing admin account (contact@public-map.com),
    // established once by e2e/auth-setup.mjs — see e2e/README.md for the
    // required dev-server startup command (DATABASE_URL on the "preview"
    // schema + a matching audit_staff_memberships row in the local Docker DB).
    storageState: "playwright/.auth/local-admin.json",
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
