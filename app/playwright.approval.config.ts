import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * Dedicated, fully self-contained E2E config for the 2026-07 user-approval
 * feature — entirely separate from playwright.config.ts (which drives the
 * Audit module's suite and the pre-commit hook) so this never touches that
 * suite's server/db lifecycle. Starts its OWN dev server, on its OWN port
 * (3601, not the Audit suite's 3600), with DATABASE_URL pointed at the
 * fully isolated local Docker Postgres set up for this feature
 * (public-map-approval-test-db, port 5434) — never Supabase Production —
 * and Clerk Development keys (never Production) from .env.e2e.local.
 */
loadEnv({ path: ".env.e2e.local" });

const LOCAL_APPROVAL_DATABASE_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_APPROVAL_DATABASE_URL)) {
  throw new Error("REFUS : LOCAL_APPROVAL_DATABASE_URL ressemble à Supabase Production.");
}
if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("REFUS : CLERK_SECRET_KEY doit être une clé de Développement (sk_test_) — voir .env.e2e.local.");
}

export default defineConfig({
  testDir: "./e2e-approval",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Generous: each test's first navigation to a not-yet-compiled route
  // triggers a webpack dev-mode first-compile (several seconds per route,
  // observed repeatedly in this codebase's other E2E suites), and this
  // spec visits 5+ distinct routes across its tests.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  webServer: {
    command: "npm run dev -- --port 3601",
    url: "http://localhost:3601/sign-in",
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: LOCAL_APPROVAL_DATABASE_URL,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
    },
  },
  use: {
    baseURL: "http://localhost:3601",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
