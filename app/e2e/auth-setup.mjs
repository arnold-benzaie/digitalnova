#!/usr/bin/env node
/**
 * One-off script (not a Playwright test) that establishes a REAL,
 * authenticated Clerk session against the local production-mode E2E server
 * (localhost:3600, started via `npm run build:e2e` then `npm run start:e2e`),
 * for the already-existing real admin account (contact@public-map.com).
 * Uses Clerk's own "sign-in token" Backend API (POST /v1/sign_in_tokens) —
 * Clerk's documented mechanism for password-less sign-in for automation —
 * never a fabricated or guessed credential. Mirrors e2e-preview/auth-setup.mjs,
 * minus the Vercel protection-bypass header (not applicable locally).
 *
 * The target user's ID is resolved live by email (see
 * helpers/clerk-admin.mjs), not hardcoded — a hardcoded id silently goes
 * stale the moment the Clerk instance changes (this broke when
 * .env.local moved from Clerk test keys to Production keys: the old
 * dev-instance id had no meaning on Production and every script/spec that
 * hardcoded it started failing with "resource_not_found").
 *
 * Clerk keys: loaded from .env.e2e.local (gitignored, see
 * .env.e2e.local.example) if present, NOT from .env.local — .env.local now
 * holds Clerk PRODUCTION keys, and Production instances categorically
 * refuse browser-side auth from any origin but the verified production
 * domain ("Production Keys are only allowed for domain ..."). That's
 * correct, required Clerk behavior, not something to work around — so E2E
 * needs its own Development-instance keys instead. This script hard-fails
 * if the resolved key is a Production key regardless of where it came
 * from, so a misconfigured .env.e2e.local (or its absence) can never
 * silently fall back to running E2E against Production.
 *
 * Prerequisite: the E2E server must be running with DATABASE_URL pointed at
 * the local Docker main test DB (127.0.0.1:5434/public_map_approval_test)
 * AND the same Clerk dev keys as this script (see e2e/README.md) — that
 * database already has a real membership for this account on the main app;
 * without it, /admin/layout.tsx would deny access before ever reaching the
 * Audit-specific check below.
 *
 * Output: playwright/.auth/local-admin.json (Playwright storageState).
 */
import { chromium } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { resolveClerkUserIdByEmail } from "./helpers/clerk-admin.mjs";

// .env.e2e.local first (Clerk dev keys win if present), .env.local as
// fallback for everything else — dotenv never overrides a var that's
// already set, so declaring .env.e2e.local first is what makes it take
// precedence over .env.local for CLERK_SECRET_KEY specifically.
loadDotenv({ path: ".env.e2e.local" });
loadDotenv({ path: ".env.local" });

const LOCAL_ORIGIN = "http://localhost:3600";
const ADMIN_EMAIL = "contact@public-map.com";

const clerkSecret = process.env.CLERK_SECRET_KEY;
if (!clerkSecret) throw new Error("CLERK_SECRET_KEY absent (.env.e2e.local ou .env.local)");
if (clerkSecret.startsWith("sk_live_")) {
  throw new Error(
    "CLERK_SECRET_KEY résolu est une clé Production (sk_live_...). " +
      "Les tests E2E locaux ne doivent jamais utiliser Clerk Production — " +
      "crée .env.e2e.local avec les clés de l'instance Clerk Development " +
      "(voir .env.e2e.local.example et e2e/README.md). Arrêt.",
  );
}

const adminUserId = await resolveClerkUserIdByEmail(ADMIN_EMAIL, clerkSecret);
console.log(`Utilisateur Clerk résolu pour ${ADMIN_EMAIL} (id masqué) — instance courante confirmée.`);

const tokenRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
  method: "POST",
  headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ user_id: adminUserId, expires_in_seconds: 1800 }),
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

// Path only, never the full URL — it still carries the (by now consumed,
// single-use) __clerk_ticket query param otherwise. Checked against the
// pathname specifically, not the raw URL string — a substring check
// against the full URL would spuriously "pass" while still stuck on
// /sign-in, since the initial navigation's own ?redirect_url=/admin
// contains the substring "/admin" too.
const path = new URL(page.url()).pathname;
console.log("Chemin après tentative de connexion:", path);
if (!path.startsWith("/admin")) {
  await page.screenshot({ path: "/tmp/local-auth-debug.png" });
  throw new Error("La connexion Clerk via sign-in token n'a pas abouti à /admin — voir /tmp/local-auth-debug.png");
}

await context.storageState({ path: "playwright/.auth/local-admin.json" });
console.log("Session enregistrée dans playwright/.auth/local-admin.json");

await browser.close();
