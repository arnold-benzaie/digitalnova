import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * Dedicated, fully self-contained E2E config for the Google Ads
 * integration (2026-08) — entirely separate from playwright.config.ts
 * (Audit module) and playwright.approval.config.ts (user-approval
 * feature), mirroring the latter's exact pattern: own dev server port
 * (3602), own local Docker Postgres (public-map-approval-test-db, port
 * 5434 — already migrated for google_ads_connections, never Supabase
 * Production), Clerk Development keys (never Production) from
 * .env.e2e.local.
 *
 * The one addition over that pattern: a SECOND webServer entry runs
 * e2e-google-ads/mock-google-ads-server.mjs on its own port, and the dev
 * server's env points GOOGLE_ADS_API_BASE_URL_OVERRIDE at it — see
 * lib/google-ads/client.ts's own docstring on that variable. This is what
 * makes "mocks contrôlés" possible for calls that happen server-side
 * (Playwright itself can only intercept browser-initiated requests).
 */
loadEnv({ path: ".env.e2e.local" });

const LOCAL_DATABASE_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DATABASE_URL)) {
  throw new Error("REFUS : LOCAL_DATABASE_URL ressemble à Supabase Production.");
}
if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("REFUS : CLERK_SECRET_KEY doit être une clé de Développement (sk_test_) — voir .env.e2e.local.");
}

const MOCK_GOOGLE_ADS_PORT = 4010;

// Fixed, shared, throwaway E2E-only encryption key — protects only fake
// refresh tokens seeded directly into the fully isolated local Docker
// test DB (never a real secret, never Production/Preview data). Must be
// IDENTICAL between this webServer's env and e2e-google-ads/db-fixtures.mjs
// (a separate Node process) so a fixture encrypted by one is decryptable
// by the other — a freshly randomBytes()-generated key per process
// wouldn't work here, unlike the *.integration.test.mjs files (single
// process, no cross-process sharing needed).
export const E2E_GOOGLE_ADS_ENCRYPTION_KEY = "lbIAH/cC16uAwexqs/HmjuRdcP652wLahLLidUHT+8Y=";

export default defineConfig({
  testDir: "./e2e-google-ads",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  webServer: [
    {
      command: `node e2e-google-ads/mock-google-ads-server.mjs`,
      url: `http://localhost:${MOCK_GOOGLE_ADS_PORT}/__control__/health`,
      reuseExistingServer: false,
      timeout: 15_000,
      env: { PORT: String(MOCK_GOOGLE_ADS_PORT) },
    },
    {
      command: "npm run dev -- --port 3602",
      url: "http://localhost:3602/sign-in",
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...(process.env as Record<string, string>),
        DATABASE_URL: LOCAL_DATABASE_URL,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
        GOOGLE_CLIENT_ID: "e2e-fake-client-id",
        GOOGLE_CLIENT_SECRET: "e2e-fake-client-secret",
        GOOGLE_ADS_DEVELOPER_TOKEN: "e2e-fake-developer-token",
        // Mirrors the real BASE_URL's own shape (<origin>/v25) exactly —
        // lib/google-ads/client.ts appends paths like
        // "customers:listAccessibleCustomers" directly onto this value
        // with no other normalization, so the override must include the
        // version segment too, matching what the mock server's routes
        // (e2e-google-ads/mock-google-ads-server.mjs) expect.
        GOOGLE_ADS_API_BASE_URL_OVERRIDE: `http://localhost:${MOCK_GOOGLE_ADS_PORT}/v25`,
        INTEGRATION_SECRET_ENCRYPTION_KEY: E2E_GOOGLE_ADS_ENCRYPTION_KEY,
      },
    },
  ],
  use: {
    baseURL: "http://localhost:3602",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
