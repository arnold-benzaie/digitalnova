import { chromium } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });

const ORIGIN = "http://localhost:3600";
const ADMIN_USER_ID = "user_3GVa84nBjinLnBEr6veCyFzEUsE";
const clerkSecret = process.env.CLERK_SECRET_KEY;

const tokenRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
  method: "POST",
  headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ user_id: ADMIN_USER_ID, expires_in_seconds: 1800 }),
});
const tokenData = await tokenRes.json();
if (!tokenRes.ok) throw new Error(JSON.stringify(tokenData));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(`${ORIGIN}/sign-in?__clerk_ticket=${tokenData.token}`, { waitUntil: "load", timeout: 20000 });
await page.waitForURL(/\/admin/, { timeout: 20000 }).catch(() => {});
console.log("URL finale:", page.url());
await page.screenshot({ path: "/tmp/local-auth-debug.png" });
await browser.close();
