import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { checkCronAuth } from "./cron-auth.ts";

function withCronSecret(value, fn) {
  const original = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  }
}

test("checkCronAuth: unset CRON_SECRET fails closed (401), never lets the request through", () => {
  withCronSecret(undefined, () => {
    const result = checkCronAuth(new Request("https://app.example.test/api/cron/x"));
    assert.equal(result?.status, 401);
  });
});

test("checkCronAuth: empty-string CRON_SECRET fails closed (401) — the exact production bug", () => {
  withCronSecret("", () => {
    const result = checkCronAuth(new Request("https://app.example.test/api/cron/x"));
    assert.equal(result?.status, 401);
  });
});

test("checkCronAuth: missing Authorization header fails closed (401) even with a real secret configured", () => {
  const secret = randomBytes(32).toString("base64url");
  withCronSecret(secret, () => {
    const result = checkCronAuth(new Request("https://app.example.test/api/cron/x"));
    assert.equal(result?.status, 401);
  });
});

test("checkCronAuth: wrong Authorization value fails closed (401)", () => {
  const secret = randomBytes(32).toString("base64url");
  withCronSecret(secret, () => {
    const result = checkCronAuth(
      new Request("https://app.example.test/api/cron/x", { headers: { Authorization: "Bearer wrong-value" } }),
    );
    assert.equal(result?.status, 401);
  });
});

test("checkCronAuth: correct Authorization value is authorized (returns null)", () => {
  const secret = randomBytes(32).toString("base64url");
  withCronSecret(secret, () => {
    const result = checkCronAuth(
      new Request("https://app.example.test/api/cron/x", { headers: { Authorization: `Bearer ${secret}` } }),
    );
    assert.equal(result, null);
  });
});

test("checkCronAuth: a different secret's Bearer token isn't accidentally accepted", () => {
  const secret = randomBytes(32).toString("base64url");
  const otherSecret = randomBytes(32).toString("base64url");
  withCronSecret(secret, () => {
    const result = checkCronAuth(
      new Request("https://app.example.test/api/cron/x", { headers: { Authorization: `Bearer ${otherSecret}` } }),
    );
    assert.equal(result?.status, 401);
  });
});
