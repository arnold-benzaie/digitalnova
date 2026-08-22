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
 * that leg. Server-to-server, it then forwards to the real, protected
 * app deployment using Vercel's own documented "Protection Bypass for
 * Automation" header (x-vercel-protection-bypass) — a secret that lives
 * ONLY in this project's server-side Preview environment variable
 * (CHAT_PROXY_BYPASS_SECRET), never in any file, never sent to the
 * browser, never logged.
 *
 * Deliberately a dumb, transparent relay — no validation, no rate-limit,
 * no business logic duplicated here. Every protection (Zod validation,
 * rate limiting, visitorId cookie handling, conversation ownership,
 * CORS allowlist on the real route) stays exactly as implemented in
 * app/api/chat/route.ts; this only changes how the browser reaches it.
 */
export const config = { runtime: "edge" };

const UPSTREAM_URL = "https://app-git-preview-ai-assistant-widget-arnold-benzaies-projects.vercel.app/api/chat";

export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const bypassSecret = process.env.CHAT_PROXY_BYPASS_SECRET;
  const incomingCookie = request.headers.get("cookie");
  // Preserves per-visitor rate limiting: without this, every visitor would
  // share this function's own edge IP as their "client IP" upstream.
  const forwardedFor = request.headers.get("x-forwarded-for");
  const body = await request.text();

  const upstreamHeaders = { "Content-Type": "application/json" };
  if (incomingCookie) upstreamHeaders["Cookie"] = incomingCookie;
  if (forwardedFor) upstreamHeaders["x-forwarded-for"] = forwardedFor;
  if (bypassSecret) upstreamHeaders["x-vercel-protection-bypass"] = bypassSecret;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: upstreamHeaders,
      body,
    });
  } catch {
    // Never relay the raw error (could embed internals) — generic only.
    return new Response(JSON.stringify({ error: "proxy_unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", upstreamResponse.headers.get("content-type") || "application/json");

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

  const responseBody = await upstreamResponse.text();
  return new Response(responseBody, { status: upstreamResponse.status, headers: responseHeaders });
}
