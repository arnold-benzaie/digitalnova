import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * Dedicated, fully self-contained E2E config for the AI Assistant widget
 * (2026-08, Phase 1A) — entirely separate from playwright.config.ts (the
 * Audit module suite / pre-commit hook) and playwright.approval.config.ts,
 * mirroring the latter's exact pattern: own dev server port (3604, not
 * yet used by any other suite on this branch), own fully isolated local
 * Docker Postgres (public-map-approval-test-db, port 5434 — already
 * migrated for chat_conversations/chat_messages), Clerk Development keys
 * (never Production) from .env.e2e.local. No mock external API server is
 * needed here (unlike a future real-provider suite) — lib/chat/ai-mock-
 * provider.ts runs entirely in-process, no network call to fake.
 */
loadEnv({ path: ".env.e2e.local" });

const LOCAL_CHAT_DATABASE_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_CHAT_DATABASE_URL)) {
  throw new Error("REFUS : LOCAL_CHAT_DATABASE_URL ressemble à Supabase Production.");
}
if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("REFUS : CLERK_SECRET_KEY doit être une clé de Développement (sk_test_) — voir .env.e2e.local.");
}

export default defineConfig({
  testDir: "./e2e-chat",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  webServer: {
    command: "npm run dev -- --port 3604",
    url: "http://localhost:3604/sign-in",
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: LOCAL_CHAT_DATABASE_URL,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
    },
  },
  use: {
    baseURL: "http://localhost:3604",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Chromium-based mobile emulation (not devices["iPhone 13"]/WebKit):
    // the one mobile test here checks viewport-driven CSS behavior
    // (overflow, visibility), which is engine-agnostic — WebKit is known
    // to hang in sandboxed macOS environments, an unnecessary dependency
    // for this check.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
