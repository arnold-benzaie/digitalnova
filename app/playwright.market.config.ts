import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * Dedicated, fully self-contained E2E config for the 2026-08
 * Canada/Europe market-as-source-of-truth feature — mirrors
 * playwright.approval.config.ts's exact pattern (own port, same fully
 * isolated local Docker Postgres, real Clerk Development sign-in
 * tokens) rather than reusing that suite's own testDir, to keep this
 * feature's lifecycle independent.
 */
loadEnv({ path: ".env.e2e.local" });

const LOCAL_MARKET_DATABASE_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_MARKET_DATABASE_URL)) {
  throw new Error("REFUS : LOCAL_MARKET_DATABASE_URL ressemble à Supabase Production.");
}
if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("REFUS : CLERK_SECRET_KEY doit être une clé de Développement (sk_test_) — voir .env.e2e.local.");
}

export default defineConfig({
  testDir: "./e2e-market",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  webServer: {
    command: "npm run dev -- --port 3603",
    url: "http://localhost:3603/sign-in",
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: LOCAL_MARKET_DATABASE_URL,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
    },
  },
  use: {
    baseURL: "http://localhost:3603",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
