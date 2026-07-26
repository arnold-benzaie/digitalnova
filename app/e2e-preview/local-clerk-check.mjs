import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
await page.goto("http://localhost:3600/sign-in", { waitUntil: "load", timeout: 20000 });
await page.waitForTimeout(3000);
console.log("Erreurs console/page:", errors.length);
errors.forEach((e) => console.log(" -", e.slice(0, 200)));
const clerkLoaded = await page.evaluate(() => typeof window.Clerk !== "undefined");
console.log("window.Clerk défini:", clerkLoaded);
await browser.close();
