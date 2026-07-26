/* eslint-disable react-hooks/rules-of-hooks -- Playwright's fixture API uses a
   parameter literally named `use`, which false-positives against the
   "custom hook" naming heuristic; this file has no React hooks. */
import { test as base, type Page, type ConsoleMessage } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PREVIEW_ORIGIN } from "../playwright.preview.config";

const bypassSecret = readFileSync("/tmp/.vercel-bypass-secret", "utf8").trim();

/**
 * Adds the Vercel bypass header ONLY to requests targeting our own Preview
 * origin — never a blanket context-level header (see playwright.preview.config.ts).
 * Works for any origin, so it's reusable for the public prospect-portal
 * context too (a different Preview URL path, same origin).
 */
export const test = base.extend<{ trackedErrors: string[] }>({
  context: async ({ context }, use) => {
    await context.route(`${PREVIEW_ORIGIN}/**`, (route) => {
      const headers = { ...route.request().headers(), "x-vercel-protection-bypass": bypassSecret };
      route.continue({ headers });
    });
    await use(context);
  },
  trackedErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
    await use(errors);
  },
});

export { expect } from "@playwright/test";
export { PREVIEW_ORIGIN };
export type { Page };
