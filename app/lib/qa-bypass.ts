import { headers } from "next/headers";

/**
 * Single gate for QA_BYPASS_AUDIT_AUTH — the temporary env-flagged fake-
 * session mechanism used by lib/session.ts, lib/dev-org.ts,
 * lib/gbp-audit/session.ts and proxy.ts. Every one of those defers to this
 * module instead of checking `process.env.QA_BYPASS_AUDIT_AUTH` directly,
 * so there is exactly one place that decides whether the bypass may fire.
 *
 * qaBypassAllowed() is a pure function (no next/headers, no process.env
 * reads of its own) precisely so it can be unit-tested directly — see
 * lib/qa-bypass.test.mjs — without needing to fake a Next.js request or
 * mock next/headers. isQaBypassActive() is the thin async wrapper that
 * supplies the real values from a live request; proxy.ts calls
 * qaBypassAllowed() directly instead, since Edge Middleware has its own
 * `req.headers` and cannot use next/headers' headers().
 *
 * Deliberately THROWS (never silently returns false) when the flag is "1"
 * but the surrounding environment isn't genuinely local dev — this must
 * fail immediately and loudly, not fall through as if the bypass simply
 * didn't apply. QA_BYPASS_AUDIT_AUTH=1 reaching a Preview or Production
 * deployment is a real incident, not a no-op.
 */
export type QaBypassEnv = {
  /** process.env.QA_BYPASS_AUDIT_AUTH */
  qaBypassFlag: string | undefined;
  /** process.env.NODE_ENV — "development" only under `next dev`; `next build && next start` is always "production", matching Vercel Preview/Production. */
  nodeEnv: string | undefined;
  /** process.env.VERCEL — "1" on every Vercel deployment, preview AND production alike. Not set for `next dev`. */
  vercel: string | undefined;
  /** The Host header of the actual incoming request. */
  host: string | null | undefined;
};

/**
 * A bare `.split(":")[0]` mishandles IPv6 — "[::1]:3600".split(":")[0] is
 * just "[", and a bracket-less "::1" has more than one colon with no port
 * attached at all. Bracketed literals ("[::1]" or "[::1]:port") are parsed
 * by the brackets; anything else with more than one colon is treated as a
 * whole bare IPv6 address (no port possible without brackets per the Host
 * header spec); everything else is "host" or "host:port".
 */
function extractHostname(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    return (closeIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, closeIdx)).toLowerCase();
  }
  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount > 1) return trimmed.toLowerCase();
  return trimmed.split(":")[0].toLowerCase();
}

export function qaBypassAllowed(env: QaBypassEnv): boolean {
  if (env.qaBypassFlag !== "1") return false;

  if (env.nodeEnv !== "development") {
    throw new Error(
      "QA_BYPASS_AUDIT_AUTH=1 mais NODE_ENV n'est pas \"development\" — bypass refusé. " +
        "Ce mécanisme ne doit jamais être actif en dehors de `next dev` en local.",
    );
  }

  if (env.vercel) {
    throw new Error(
      "QA_BYPASS_AUDIT_AUTH=1 mais l'application tourne sur Vercel (Preview ou Production) — bypass refusé.",
    );
  }

  const hostname = extractHostname(env.host ?? "");
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!isLocalHost) {
    throw new Error(
      `QA_BYPASS_AUDIT_AUTH=1 mais l'hôte de la requête ("${hostname || "vide"}") n'est pas localhost — bypass refusé.`,
    );
  }

  return true;
}

export async function isQaBypassActive(): Promise<boolean> {
  const hdrs = await headers();
  return qaBypassAllowed({
    qaBypassFlag: process.env.QA_BYPASS_AUDIT_AUTH,
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    host: hdrs.get("host"),
  });
}
