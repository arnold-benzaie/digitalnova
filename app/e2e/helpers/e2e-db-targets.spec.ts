// PHASE T-1.4-B-B — tests for the pure assertion in
// e2e/helpers/e2e-db-targets.ts.
//
// A @playwright/test spec (not node:test), same rationale as
// console-errors.spec.ts: it lives under `testDir: "./e2e"`, so it is
// auto-collected by Playwright and runs as a fast, browser-less unit test.
// No `page`, no browser, no DB, no network.
import { expect, test } from "@playwright/test";

import { assertE2EDatabaseTargets } from "./e2e-db-targets";

const GOOD_MAIN = "public_map_approval_test";
const GOOD_AUDIT = "public_map_audit_test";

const FORBIDDEN_IN_ERRORS = [
  "postgres://",
  "postgresql://",
  "DATABASE_URL",
  "AUDIT_DATABASE_URL",
  "password",
  "credentials",
  "@127.0.0.1",
  "@localhost",
  ":5434",
  ":5433",
];

function messageOf(targets: Parameters<typeof assertE2EDatabaseTargets>[0]): string {
  try {
    assertE2EDatabaseTargets(targets);
  } catch (err) {
    return (err as Error).message;
  }
  return "";
}

test("passes when both live targets are the local Docker test databases", () => {
  expect(() => assertE2EDatabaseTargets({ mainDatabase: GOOD_MAIN, auditDatabase: GOOD_AUDIT })).not.toThrow();
});

test("fails closed on a wrong main database name, naming expected vs observed", () => {
  const message = messageOf({ mainDatabase: "public_map", auditDatabase: GOOD_AUDIT });
  expect(message).toMatch(/main database target check failed/);
  expect(message).toContain('expected "public_map_approval_test"');
  expect(message).toContain('observed "public_map"');
});

test("fails closed on a wrong audit database name, naming expected vs observed", () => {
  const message = messageOf({ mainDatabase: GOOD_MAIN, auditDatabase: "postgres" });
  expect(message).toMatch(/audit database target check failed/);
  expect(message).toContain('expected "public_map_audit_test"');
  expect(message).toContain('observed "postgres"');
});

test("fails closed on null / undefined / empty main database", () => {
  for (const bad of [null, undefined, ""] as const) {
    const message = messageOf({ mainDatabase: bad, auditDatabase: GOOD_AUDIT });
    expect(message, `main=${JSON.stringify(bad)}`).toMatch(/main database target check failed/);
  }
});

test("fails closed on null / undefined / empty audit database", () => {
  for (const bad of [null, undefined, ""] as const) {
    const message = messageOf({ mainDatabase: GOOD_MAIN, auditDatabase: bad });
    expect(message, `audit=${JSON.stringify(bad)}`).toMatch(/audit database target check failed/);
  }
});

test("checks the main database before the audit database", () => {
  const message = messageOf({ mainDatabase: "wrong_main", auditDatabase: "wrong_audit" });
  expect(message).toMatch(/main database target check failed/);
  expect(message).not.toMatch(/audit database target check failed/);
});

test("error text never leaks a connection string, env var name, host, port, or credential", () => {
  const cases: Array<Parameters<typeof assertE2EDatabaseTargets>[0]> = [
    { mainDatabase: "nope", auditDatabase: GOOD_AUDIT },
    { mainDatabase: GOOD_MAIN, auditDatabase: "nope" },
    { mainDatabase: null, auditDatabase: GOOD_AUDIT },
    { mainDatabase: GOOD_MAIN, auditDatabase: undefined },
    { mainDatabase: "", auditDatabase: "" },
  ];
  for (const c of cases) {
    const message = messageOf(c);
    expect(message, `case ${JSON.stringify(c)} must throw`).not.toBe("");
    for (const forbidden of FORBIDDEN_IN_ERRORS) {
      expect(message.includes(forbidden), `case ${JSON.stringify(c)} must not leak ${forbidden}`).toBe(false);
    }
  }
});
