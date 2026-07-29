import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Playwright HTML reports — vendored trace-viewer bundles,
    // never a source of truth (see .gitignore).
    "e2e/report/**",
    "e2e-preview/report/**",
    // Standalone, independently-published packages with their own tsconfig
    // and (for sdks/typescript) their own lint setup — not part of this
    // Next.js app's build, and eslint-config-next's React/Next-specific
    // rules don't apply to them.
    "sdks/**",
    "collections/**",
    // Standalone Zapier Platform app (its own package.json, real
    // CommonJS require()/module.exports — Zapier's actual runtime
    // convention, not a style choice this app's ESM/TS rules should
    // apply to). See zapier/README.md.
    "zapier/**",
  ]),
]);

export default eslintConfig;
