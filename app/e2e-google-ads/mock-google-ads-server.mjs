#!/usr/bin/env node
// Minimal, dependency-free HTTP server that stands in for
// googleads.googleapis.com during the Google Ads E2E suite. Playwright can
// only intercept requests initiated FROM THE BROWSER — the Google Ads API
// calls happen server-side (lib/google-ads/client.ts), so this process is
// what GOOGLE_ADS_API_BASE_URL_OVERRIDE points the Next.js dev server at
// instead of the real Google endpoint (see that file's own docstring).
//
// State is set via a small control API (POST /__control__/state) that the
// spec files call directly before each scenario — never via real Google
// credentials, never with real customer data.
//
// Run standalone: PORT=4010 node e2e-google-ads/mock-google-ads-server.mjs
import { createServer } from "node:http";

/** @type {{ accessibleCustomers: string[], search: Record<string, unknown[]>, errors: Record<string, {status: number, message: string, googleErrorStatus?: string}> }} */
let state = { accessibleCustomers: [], search: {}, errors: {} };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

/** Same classification logic as the real accounts/reports queries use to
 * key lib/google-ads/*'s own fakeApi maps in the node:test integration
 * suite — kept consistent so scenario fixtures read the same way in both
 * places. */
function classifyQuery(query) {
  if (query.includes("customer_client")) return "customer_client";
  if (query.includes("FROM campaign")) return "campaigns";
  return "summary";
}

export function startMockGoogleAdsServer(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);

      if (req.method === "GET" && url.pathname === "/__control__/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/__control__/state") {
        const body = await readBody(req);
        state = { accessibleCustomers: body?.accessibleCustomers ?? [], search: body?.search ?? {}, errors: body?.errors ?? {} };
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/v25/customers:listAccessibleCustomers") {
        return sendJson(res, 200, { resourceNames: state.accessibleCustomers.map((id) => `customers/${id}`) });
      }

      const searchMatch = url.pathname.match(/^\/v25\/customers\/(\d+)\/googleAds:search$/);
      if (req.method === "POST" && searchMatch) {
        const customerId = searchMatch[1];
        const body = await readBody(req);
        const kind = classifyQuery(String(body?.query ?? ""));
        const key = `${customerId}::${kind}`;

        const error = state.errors[key];
        if (error) {
          return sendJson(res, error.status, { error: { code: error.status, message: error.message, status: error.googleErrorStatus ?? "INTERNAL" } });
        }
        return sendJson(res, 200, { results: state.search[key] ?? [] });
      }

      sendJson(res, 404, { error: { code: 404, message: "Not found in mock Google Ads server.", status: "NOT_FOUND" } });
    } catch (err) {
      sendJson(res, 500, { error: { code: 500, message: err instanceof Error ? err.message : "mock server error", status: "INTERNAL" } });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 4010);
  await startMockGoogleAdsServer(port);
  console.log(`Mock Google Ads server listening on http://localhost:${port}`);
}
