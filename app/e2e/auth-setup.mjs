#!/usr/bin/env node
/**
 * One-off script (not a Playwright test) that establishes a REAL,
 * authenticated Clerk session against the LOCAL dev server (localhost:3600),
 * for the already-existing real admin account (contact@public-map.com).
 * Uses Clerk's own "sign-in token" Backend API (POST /v1/sign_in_tokens) —
 * Clerk's documented mechanism for password-less sign-in for automation —
 * never a fabricated or guessed credential. Mirrors e2e-preview/auth-setup.mjs,
 * minus the Vercel protection-bypass header (not applicable locally).
 *
 * Prerequisite: the dev server must be running with DATABASE_URL pointed at
 * the "preview" schema (see e2e/README.md) — that schema already has a real
 * membership for this account on the main app; without it, /admin/layout.tsx
 * would deny access before ever reaching the Audit-specific check below.
 *
 * Output: playwright/.auth/local-admin.json (Playwright storageState).
 */
import { chromium } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });

const LOCAL_ORIGIN = "http://localhost:3600";
const ADMIN_USER_ID = "user_3GVa84nBjinLnBEr6veCyFzEUsE"; // contact@public-map.com

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
const page = await context.newPage();
page.on("console", (msg) => { if (msg.type() === "error") console.log(`[browser:${msg.type()}]`, msg.text()); });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(`${LOCAL_ORIGIN}/sign-in?__clerk_ticket=${tokenData.token}&redirect_url=/admin`, { waitUntil: "load", timeout: 30000 });
await page.waitForURL(/\/admin/, { timeout: 30000 }).catch(() => {});
if (!page.url().includes("/admin")) {
  await page.goto(`${LOCAL_ORIGIN}/admin`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
}

const url = page.url();
console.log("URL après tentative de connexion:", url);
if (!url.includes("/admin")) {
  await page.screenshot({ path: "/tmp/local-auth-debug.png" });
  throw new Error("La connexion Clerk via sign-in token n'a pas abouti à /admin — voir /tmp/local-auth-debug.png");
}

await context.storageState({ path: "playwright/.auth/local-admin.json" });
console.log("Session enregistrée dans playwright/.auth/local-admin.json");

await browser.close();
