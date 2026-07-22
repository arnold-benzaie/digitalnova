// Security-critical guard — see lib/qa-bypass.ts. qaBypassAllowed() is a
// pure function on purpose, so every branch here runs against real values,
// no mocking of next/headers or a Next.js request needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { qaBypassAllowed } from "./qa-bypass.ts";

const LOCAL_DEV = { qaBypassFlag: "1", nodeEnv: "development", vercel: undefined, host: "localhost:3600" };

test("returns false when the flag isn't \"1\", regardless of everything else", () => {
  assert.equal(qaBypassAllowed({ ...LOCAL_DEV, qaBypassFlag: undefined }), false);
  assert.equal(qaBypassAllowed({ ...LOCAL_DEV, qaBypassFlag: "0" }), false);
  assert.equal(qaBypassAllowed({ ...LOCAL_DEV, qaBypassFlag: "true" }), false);
  // Even when nodeEnv/vercel/host look dangerous — flag absent means nothing else is evaluated.
  assert.equal(qaBypassAllowed({ qaBypassFlag: undefined, nodeEnv: "production", vercel: "1", host: "public-map-audit.vercel.app" }), false);
});

test("allows the exact genuine-local-dev shape: flag=1, NODE_ENV=development, no VERCEL, localhost host", () => {
  assert.equal(qaBypassAllowed(LOCAL_DEV), true);
});

test("allows 127.0.0.1 and ::1 as localhost, with a port suffix", () => {
  assert.equal(qaBypassAllowed({ ...LOCAL_DEV, host: "127.0.0.1:3600" }), true);
  assert.equal(qaBypassAllowed({ ...LOCAL_DEV, host: "[::1]:3600" }), true);
  assert.equal(qaBypassAllowed({ ...LOCAL_DEV, host: "::1" }), true);
});

test("throws when NODE_ENV is not \"development\" (e.g. next build && next start)", () => {
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, nodeEnv: "production" }), /NODE_ENV/);
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, nodeEnv: undefined }), /NODE_ENV/);
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, nodeEnv: "test" }), /NODE_ENV/);
});

test("throws when running on Vercel, even if NODE_ENV somehow says development", () => {
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, vercel: "1" }), /Vercel/);
});

test("throws for a Vercel preview deployment shape (NODE_ENV=production, VERCEL=1, *.vercel.app host)", () => {
  assert.throws(
    () => qaBypassAllowed({ qaBypassFlag: "1", nodeEnv: "production", vercel: "1", host: "public-map-audit-git-preview-team.vercel.app" }),
    /NODE_ENV/, // the NODE_ENV check runs first and already blocks this
  );
});

test("throws when the host isn't localhost, even with correct NODE_ENV and no VERCEL", () => {
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, host: "example.com" }), /localhost/);
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, host: "192.168.1.50:3600" }), /localhost/);
});

test("throws when the host is missing entirely (fails closed, doesn't assume local)", () => {
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, host: null }), /localhost/);
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, host: undefined }), /localhost/);
  assert.throws(() => qaBypassAllowed({ ...LOCAL_DEV, host: "" }), /localhost/);
});

test("host match is case-insensitive", () => {
  assert.equal(qaBypassAllowed({ ...LOCAL_DEV, host: "LOCALHOST:3600" }), true);
});
