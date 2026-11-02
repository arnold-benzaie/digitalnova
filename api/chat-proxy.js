/**
 * Same-origin proxy for the PUBLIC-MAP AI Assistant widget (Phase 1B fix).
 *
 * Root cause this exists for: the app project's Preview deployments sit
 * behind Vercel Deployment Protection, which intercepts the browser's own
 * CORS *preflight* (OPTIONS — never carries cookies by spec) with a 307/302
 * redirect to Vercel's SSO wall. A redirected preflight response is
 * forbidden by the Fetch/CORS spec, so the browser blocks the whole
 * cross-origin request before it ever reaches the app's code — confirmed
 * directly (server: Vercel, no app-level headers, zero app Runtime Logs
 * for the attempt). No CORS/cookie/frontend fix can work around this from
 * the browser side; it has to stop being a cross-origin call.
 *
 * This function runs on the STATIC SITE's own project (same origin as the
 * page), so the browser's fetch("/api/chat-proxy") is same-origin — no
 * CORS, no preflight, Deployment Protection never enters the picture on
 * that leg. Server-to-server, it then forwards to the real app deployment.
 *
 * Upstream target (CHAT_UPSTREAM_URL, server-only — never NEXT_PUBLIC_*,
 * never sent to the browser): the app's own ORIGIN only (e.g.
 * "https://app-git-preview-ai-assistant-widget-....vercel.app" in Preview,
 * the real Production app domain in Production) — this handler appends
 * "/api/chat" itself. Deliberately environment-scoped via Vercel's own
 * per-environment variable values, never a literal URL in source: a
 * hardcoded Preview alias here previously meant Production traffic would
 * have silently kept hitting the Preview deployment (wrong database
 * schema, wrong DeepSeek key, and a Preview alias not guaranteed to stay
 * available once this branch merges) — found in the pre-merge audit,
 * never actually shipped. No fallback to any built-in URL if the variable
 * is missing: refusing loudly (a clean 500, logged server-side by
 * variable NAME only, never printing a value) is the only safe behavior —
 * guessing would silently reintroduce the exact bug this fixes.
 *
 * x-vercel-protection-bypass (CHAT_PROXY_BYPASS_SECRET) stays exactly as
 * before: added to the upstream request ONLY when the variable is
 * actually set. Preview sets it today because Preview deployments sit
 * behind Vercel's SSO wall; Production doesn't need it (Production
 * deployments aren't behind that wall) and must never be configured to
 * require it — this line simply never fires there.
 *
 * No business logic is duplicated here: Zod validation, conversation
 * ownership and the app's own rate limits stay in app/api/chat/route.ts.
 * The proxy only adds the guards a public entry point needs before any
 * upstream call, in this order:
 *   405 method_not_allowed    anything but POST (OPTIONS included: the
 *                             widget is same-origin, so no preflight)
 *   429 rate_limited          more than 30 POSTs per 5 minutes from one IP,
 *                             or 300 per minute overall (+ Retry-After)
 *   403 origin_not_allowed    an Origin header that is neither this site
 *                             nor one of its own domains; requests without
 *                             Origin (non-browser clients) are let through
 *   500 proxy_misconfigured   CHAT_UPSTREAM_URL missing
 *   415 unsupported_media_type  Content-Type is not application/json
 *   413 payload_too_large     body over 32 KB, declared or actually read
 *   400 invalid_json          body is not JSON
 *   408 request_timeout       the body itself took longer than 18 s
 *   504 proxy_timeout         the app did not answer within the same 18 s
 * The app's own visitor limit keys on a visitorId the client supplies, so
 * the per-IP limit here is the one an anonymous script cannot reset.
 * Limits: those counters live in the memory of each function instance —
 * a local, per-instance guard that resets on cold start, NOT a global one.
 * A Vercel WAF rate-limit rule on /api/chat-proxy remains the global option.
 *
 * Only the pm_chat_visitor_id cookie is forwarded to the app (never the
 * site's other cookies, e.g. Google Analytics), and every response carries
 * Cache-Control: no-store.
 */
export const config = { runtime: "edge" };

// The whole request — reading the visitor's body, then the app's headers
// and body — must complete within this delay.
export const UPSTREAM_TIMEOUT_MS = 18000;
export const MAX_BODY_BYTES = 32 * 1024;
export const VISITOR_COOKIE = "pm_chat_visitor_id";

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX_PER_IP = 30;
const GLOBAL_WINDOW_MS = 60 * 1000;
const RATE_MAX_GLOBAL = 300;
const MAX_TRACKED_IPS = 5000;
const hitsByIp = new Map(); // ip -> timestamps (ms) of recent POSTs, oldest first
let globalHits = [];

// The site's own domains; any deployment of the digitalnova project is
// also accepted, and so is the origin the request was actually sent to.
const ALLOWED_ORIGINS = new Set(["https://public-map.com", "https://www.public-map.com", "https://digitalnova-kohl.vercel.app"]);
const PROJECT_DEPLOYMENT_ORIGIN = /^https:\/\/digitalnova(-[a-z0-9-]+)?-arnold-benzaies-projects\.vercel\.app$/;

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

const timeoutResponse = () => json(504, { error: "proxy_timeout" });

/** Visitor IP as set by the platform; "unknown" when absent (local runs). */
export function clientIp(request) {
  const raw = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "").split(",")[0].trim();
  return /^[0-9a-fA-F:.]{2,64}$/.test(raw) ? raw : "unknown";
}

/** Records one POST for `ip` and says whether it must be refused. */
export function checkRateLimit(ip, now = Date.now()) {
  globalHits = globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  const hits = (hitsByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_PER_IP) {
    hitsByIp.set(ip, hits);
    return { limited: true, retryAfterSec: Math.ceil((hits[0] + RATE_WINDOW_MS - now) / 1000) };
  }
  if (globalHits.length >= RATE_MAX_GLOBAL) {
    return { limited: true, retryAfterSec: Math.ceil((globalHits[0] + GLOBAL_WINDOW_MS - now) / 1000) };
  }
  hits.push(now);
  globalHits.push(now);
  hitsByIp.delete(ip); // re-insert so Map order stays "least recently seen first"
  hitsByIp.set(ip, hits);
  while (hitsByIp.size > MAX_TRACKED_IPS) hitsByIp.delete(hitsByIp.keys().next().value);
  return { limited: false, retryAfterSec: 0 };
}

/** Test helper: forget all counters. */
export function __resetRateLimits() {
  hitsByIp.clear();
  globalHits = [];
}

/** No Origin header (non-browser client) is accepted; a present one must be the site's own. */
export function originAllowed(request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  let own = null;
  try {
    own = new URL(request.url).origin;
  } catch {}
  return origin === own || ALLOWED_ORIGINS.has(origin) || PROJECT_DEPLOYMENT_ORIGIN.test(origin);
}

/** "pm_chat_visitor_id=<value>" from the incoming Cookie header, or null. */
export function visitorCookie(header) {
  for (const part of (header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === VISITOR_COOKIE) return `${VISITOR_COOKIE}=${part.slice(eq + 1).trim()}`;
  }
  return null;
}

/**
 * Reads at most MAX_BODY_BYTES, giving up when `signal` aborts.
 * Returns the text, "too_large" or "timeout".
 */
async function readBody(request, signal) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return "too_large";
  if (!request.body) return "";
  const reader = request.body.getReader();
  const aborted = new Promise((resolve) => {
    if (signal.aborted) resolve("timeout");
    else signal.addEventListener("abort", () => resolve("timeout"), { once: true });
  });
  const chunks = [];
  let size = 0;
  for (;;) {
    const step = await Promise.race([reader.read(), aborted]);
    if (step === "timeout") {
      reader.cancel().catch(() => {});
      return "timeout";
    }
    if (step.done) break;
    size += step.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export default async function handler(request) {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Counted before anything else, refused requests included.
  const rate = checkRateLimit(clientIp(request));
  if (rate.limited) return json(429, { error: "rate_limited" }, { "Retry-After": String(rate.retryAfterSec) });

  if (!originAllowed(request)) return json(403, { error: "origin_not_allowed" });

  const upstreamOrigin = process.env.CHAT_UPSTREAM_URL;
  if (!upstreamOrigin) {
    // Never a silent fallback to a hardcoded origin (that's exactly the
    // bug this variable replaces) — log the variable NAME only, never a
    // value (there isn't one here, but the same discipline applies below
    // where a value does exist), and tell the browser nothing beyond a
    // generic error.
    console.error("[chat-proxy] CHAT_UPSTREAM_URL is not configured — refusing to guess an upstream origin.");
    return json(500, { error: "proxy_misconfigured" });
  }

  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return json(415, { error: "unsupported_media_type" });
  }

  // One deadline for the whole request: a body that trickles in slowly
  // counts against the same 18 s as the app's answer.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  const body = await readBody(request, controller.signal);
  if (body === "timeout") return json(408, { error: "request_timeout" });
  if (body === "too_large") {
    clearTimeout(timer);
    return json(413, { error: "payload_too_large" });
  }
  try {
    JSON.parse(body);
  } catch {
    clearTimeout(timer);
    return json(400, { error: "invalid_json" });
  }

  const bypassSecret = process.env.CHAT_PROXY_BYPASS_SECRET;
  const cookie = visitorCookie(request.headers.get("cookie"));
  // Preserves per-visitor rate limiting: without this, every visitor would
  // share this function's own edge IP as their "client IP" upstream.
  const forwardedFor = request.headers.get("x-forwarded-for");

  const upstreamHeaders = { "Content-Type": "application/json" };
  if (cookie) upstreamHeaders["Cookie"] = cookie;
  if (forwardedFor) upstreamHeaders["x-forwarded-for"] = forwardedFor;
  if (bypassSecret) upstreamHeaders["x-vercel-protection-bypass"] = bypassSecret;

  const upstreamUrl = `${upstreamOrigin.replace(/\/+$/, "")}/api/chat`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body,
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) return timeoutResponse();
    // Never relay the raw error (could embed internals) — generic only.
    return json(502, { error: "proxy_unavailable" });
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", upstreamResponse.headers.get("content-type") || "application/json");
  responseHeaders.set("Cache-Control", "no-store");

  // getSetCookie() (WHATWG Headers) avoids the classic comma-join bug for
  // multi-value Set-Cookie; falls back to a single-value get() if the
  // runtime doesn't support it. Only one cookie (visitorId) is ever set by
  // the upstream route today, so both paths behave identically in practice.
  const setCookies = typeof upstreamResponse.headers.getSetCookie === "function" ? upstreamResponse.headers.getSetCookie() : [];
  if (setCookies.length > 0) {
    for (const cookie of setCookies) responseHeaders.append("Set-Cookie", cookie);
  } else {
    const singleSetCookie = upstreamResponse.headers.get("set-cookie");
    if (singleSetCookie) responseHeaders.set("Set-Cookie", singleSetCookie);
  }

  let responseBody;
  try {
    responseBody = await upstreamResponse.text();
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) return timeoutResponse();
    return json(502, { error: "proxy_unavailable" });
  }
  clearTimeout(timer);
  return new Response(responseBody, { status: upstreamResponse.status, headers: responseHeaders });
}
