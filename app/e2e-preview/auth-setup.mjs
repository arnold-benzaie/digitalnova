#!/usr/bin/env node
/**
 * One-off script (not a Playwright test) that establishes a REAL,
 * authenticated Clerk session against the real Vercel Preview deployment,
 * for the already-existing real admin account (contact@public-map.com —
 * the same account the user signed in with locally this session). Uses
 * Clerk's own "sign-in token" Backend API (POST /v1/sign_in_tokens) —
 * Clerk's documented mechanism for exactly this (server-to-server,
 * password-less sign-in for automation/testing) — never a fabricated or
 * guessed credential. The token is single-use and short-lived (30 min).
 *
 * Also carries the Vercel "Protection Bypass for Automation" secret on
 * every request in this browser context, so the deployment's own SSO wall
 * never blocks the real app underneath from being reached.
 *
 * Output: playwright/.auth/preview-admin.json (Playwright storageState),
 * reused by every real test against Preview so the token is consumed once.
 */
import { chromium } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";

loadDotenv({ path: ".env.local" });

const PREVIEW_ORIGIN = "https://app-jdfcwphuy-arnold-benzaies-projects.vercel.app";
const ADMIN_USER_ID = "user_3GVa84nBjinLnBEr6veCyFzEUsE"; // contact@public-map.com — real, already-existing Audit admin

const bypassSecret = readFileSync("/tmp/.vercel-bypass-secret", "utf8").trim();
const clerkSecret = process.env.CLERK_SECRET_KEY;
if (!clerkSecret) throw new Error("CLERK_SECRET_KEY absent de .env.local");

const tokenRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
  method: "POST",
  headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ user_id: ADMIN_USER_ID, expires_in_seconds: 1800 }),
});
const tokenData = await tokenRes.json();
if (!tokenRes.ok || !tokenData.token) {
  throw new Error(`Échec de création du sign-in token Clerk: ${JSON.stringify(tokenData.errors ?? tokenData)}`);
}
console.log("Sign-in token Clerk créé (id):", tokenData.id);

const browser = await chromium.launch();
const context = await browser.newContext();
// Scoped to our own Preview origin only — extraHTTPHeaders would apply this
// to EVERY request in the context, including cross-origin ones to Clerk's
// own CDN (next-akita-2.clerk.accounts.dev), which then fails ITS OWN CORS
// preflight because it doesn't allow this header. Route-based filtering
// keeps the bypass header exactly where it belongs.
await context.route(`${PREVIEW_ORIGIN}/**`, (route) => {
  const headers = { ...route.request().headers(), "x-vercel-protection-bypass": bypassSecret };
  route.continue({ headers });
});
const page = await context.newPage();
page.on("console", (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));
page.on("requestfailed", (req) => console.log("[requestfailed]", req.url(), req.failure()?.errorText));
page.on("response", async (res) => {
  if (res.status() >= 400 && res.url().startsWith(PREVIEW_ORIGIN)) {
    const body = await res.text().catch(() => "(corps illisible)");
    console.log(`[response ${res.status()}]`, res.url());
    console.log(body.slice(0, 2000));
  }
});

// Visiting with __clerk_ticket lets Clerk's own client script consume the
// sign-in token and establish a real session — this is Clerk's documented
// ticket-based sign-in flow, not a bypass of anything on Clerk's side.
// waitUntil: "load", not "networkidle" — this project's own e2e suite
// already documents networkidle never resolving reliably (HMR/Clerk's own
// polling keep the connection non-idle).
await page.goto(`${PREVIEW_ORIGIN}/sign-in?__clerk_ticket=${tokenData.token}`, { waitUntil: "load", timeout: 30000 });
await page.waitForURL(/\/admin/, { timeout: 30000 }).catch(() => {});

const url = page.url();
console.log("URL après tentative de connexion:", url);
if (!url.includes("/admin")) {
  await page.screenshot({ path: "/tmp/preview-auth-debug.png" });
  throw new Error("La connexion Clerk via sign-in token n'a pas abouti à /admin — voir /tmp/preview-auth-debug.png");
}

await context.storageState({ path: "playwright/.auth/preview-admin.json" });
console.log("Session enregistrée dans playwright/.auth/preview-admin.json");

await browser.close();
