/**
 * Same-origin endpoint for the /reservation "strategy call" form.
 *
 * Why this exists: reservation/reservation.js has POSTed to /api/reservation
 * since July 2026, but no function was ever deployed at that path, so every
 * submission ended in a 404 and the generic "could not be sent" message.
 * This handler implements the contract the page already expects:
 *   200 { ok: true }                                         request forwarded
 *   400 { ok: false, code: "validation_failed" }             bad or bot input
 *   503 { ok: false, code: "reservation_backend_not_configured" }
 *   502 { ok: false, code: "reservation_upstream_failed" }
 *
 * No storage here: a valid request is only relayed, server-to-server, to the
 * intake URL configured in RESERVATION_UPSTREAM_URL (server-only; https, no
 * embedded credentials, redirects refused), e.g. an n8n or CRM webhook chosen
 * by the business. Without a usable URL the handler answers "not configured",
 * which makes the page say plainly that nothing was sent or stored and offer
 * the e-mail contact instead — the behaviour promised on the page.
 * RESERVATION_UPSTREAM_TOKEN, when set, is sent as a Bearer token. Personal
 * data is never logged: only status codes and variable NAMES.
 *
 * Not handled here: rate limiting. The honeypot and minimum fill time only
 * stop naive bots; before an intake URL is configured, add a platform rate
 * limit (e.g. a Vercel WAF rule on /api/reservation) or a challenge.
 */
export const config = { runtime: "edge" };

const MAX_BODY_BYTES = 16 * 1024;
const MIN_FILL_MS = 2000;
const MAX_ADVANCE_MS = 366 * 24 * 3600 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const COUNTRIES = ["MU", "FR", "CA", "BE", "CH", "GB", "OTHER"];
const SERVICES = ["google-business", "seo-local", "website", "google-ads", "automation", "audit", "other"];
const BUDGETS = ["to-define", "under-1000", "1000-3000", "3000-7000", "over-7000"];
const TIME_SLOTS = ["morning", "afternoon"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Single-line fields: no control characters at all (blocks CR/LF header injection downstream).
const SINGLE_LINE_CONTROL = /[\u0000-\u001f\u007f]/;
// The message may contain line breaks and tabs, but no other control characters.
const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const invalid = () => json(400, { ok: false, code: "validation_failed" });

function text(value, { min = 0, max, required = true, multiline = false }) {
  if (typeof value !== "string") return null;
  if ((multiline ? MULTI_LINE_CONTROL : SINGLE_LINE_CONTROL).test(value)) return null;
  const trimmed = value.trim();
  if ((required && trimmed.length < Math.max(min, 1)) || trimmed.length > max) return null;
  if (!required && trimmed.length > 0 && trimmed.length < min) return null;
  return trimmed;
}

function validDate(value, now) {
  const m = typeof value === "string" && DATE.exec(value);
  if (!m) return false;
  const time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(time);
  // Reject impossible calendar dates such as 2026-02-31 (Date.UTC would roll them over).
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return false;
  // The page sets min = the visitor's local date; allow 36 h of time-zone slack, and at most a year ahead.
  return time >= now - 36 * 3600 * 1000 && time <= now + MAX_ADVANCE_MS;
}

/** Returns the clean payload to forward, or null when anything is off. */
export function validateReservation(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  // Honeypot filled (any non-empty value), or the form sent faster than a person can fill it: treat as a bot.
  if (input.website !== undefined && input.website !== "") return null;
  if (!Number.isFinite(input.startedAt) || input.startedAt <= 0 || now - input.startedAt < MIN_FILL_MS) return null;

  const fullName = text(input.fullName, { min: 2, max: 100 });
  const email = text(input.email, { max: 160 });
  const phone = text(input.phone ?? "", { max: 40, required: false });
  const company = text(input.company, { max: 120 });
  const message = text(input.message, { min: 20, max: 2000, multiline: true });
  if ([fullName, email, phone, company, message].includes(null) || !EMAIL.test(email)) return null;
  if (!COUNTRIES.includes(input.country) || !SERVICES.includes(input.service)) return null;
  if (!BUDGETS.includes(input.budget) || !TIME_SLOTS.includes(input.timeSlot)) return null;
  if (input.consent !== true || !validDate(input.preferredDate, now)) return null;

  return {
    fullName, email, phone, company, message,
    country: input.country, service: input.service, budget: input.budget,
    preferredDate: input.preferredDate, timeSlot: input.timeSlot,
    consent: true,
    language: input.language === "en" ? "en" : "fr",
  };
}

/** The configured intake URL, or null when it is missing or unsafe to use. */
export function upstreamUrl(value = process.env.RESERVATION_UPSTREAM_URL) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Reads at most MAX_BODY_BYTES; returns null as soon as the body is larger. */
async function readBody(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
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
  if (request.method !== "POST") return json(405, { ok: false, code: "method_not_allowed" });
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return invalid();

  const raw = await readBody(request);
  if (raw === null) return invalid();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const reservation = validateReservation(input);
  if (!reservation) return invalid();

  const upstream = upstreamUrl();
  if (!upstream) {
    console.error("reservation: RESERVATION_UPSTREAM_URL is missing or not a plain https URL; request not forwarded");
    return json(503, { ok: false, code: "reservation_backend_not_configured" });
  }

  const headers = { "Content-Type": "application/json" };
  if (process.env.RESERVATION_UPSTREAM_TOKEN) headers.Authorization = `Bearer ${process.env.RESERVATION_UPSTREAM_TOKEN}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(upstream, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...reservation, source: "public-map.com/reservation", receivedAt: new Date().toISOString() }),
      // A redirect could carry the data (and the token) to another host: refuse it.
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`reservation: upstream answered ${response.status}`);
      return json(502, { ok: false, code: "reservation_upstream_failed" });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error(`reservation: upstream unreachable (${error?.name || "error"})`);
    return json(502, { ok: false, code: "reservation_upstream_failed" });
  } finally {
    clearTimeout(timer);
  }
}
