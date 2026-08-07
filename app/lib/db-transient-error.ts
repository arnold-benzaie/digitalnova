/**
 * Detects a transient Postgres *connection*-layer failure (pool/session
 * exhaustion, network drop) as opposed to a real business-logic error, so
 * callers can surface "server is busy, retry" instead of a raw/technical
 * message or a false "success". Root cause: this app's own pg.Pool can hold
 * connections open past their idle timeout when a serverless instance
 * freezes between invocations (the timer never gets to fire), which can
 * exhaust Supabase's pooler connection cap under concurrent load — see the
 * EMAXCONNSESSION investigation. Not specific to billing; safe to reuse
 * from any server action that performs an important mutation.
 */
const TRANSIENT_PG_CODES = new Set([
  "XX000", // internal_error — Supabase Supavisor reports EMAXCONNSESSION under this code
  "53300", // too_many_connections
  "57P03", // cannot_connect_now
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
]);

const TRANSIENT_NODE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"]);

function codeOf(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const withCode = err as { code?: unknown };
  return typeof withCode.code === "string" ? withCode.code : undefined;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

/** Postgres wraps the real driver error as `.cause` (see the actual
 * production shape: the outer Error's message is just "Failed query:
 * ...", the "(EMAXCONNSESSION) max clients reached..." text lives on
 * `.cause.message`) — check both, not just the outer message. */
function combinedMessage(err: unknown): string {
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return `${messageOf(err)} ${cause ? messageOf(cause) : ""}`;
}

export function isTransientDbConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const cause = (err as { cause?: unknown }).cause;
  const directCode = codeOf(err);
  const causeCode = codeOf(cause);
  if (directCode && TRANSIENT_NODE_CODES.has(directCode)) return true;
  if (causeCode && TRANSIENT_NODE_CODES.has(causeCode)) return true;
  if (causeCode && TRANSIENT_PG_CODES.has(causeCode)) return true;
  if (directCode && TRANSIENT_PG_CODES.has(directCode)) return true;
  return /EMAXCONNSESSION|max clients reached/i.test(combinedMessage(err));
}

const SERVER_BUSY_MESSAGE = {
  fr: "Le serveur est momentanément occupé. Veuillez réessayer dans quelques secondes.",
  en: "The server is temporarily busy. Please try again in a few seconds.",
} as const;

/**
 * Re-throws `err` as-is when it isn't a transient connection failure (real
 * business-logic errors — validation, not-found, wrong status — must keep
 * their original, specific message). Only a genuine transient connection
 * error gets replaced with the generic localized "server busy" message.
 */
export function rethrowFriendlyIfTransient(err: unknown, locale: "fr" | "en"): never {
  if (isTransientDbConnectionError(err)) {
    throw new Error(SERVER_BUSY_MESSAGE[locale]);
  }
  throw err;
}

export type DbErrorCategory = "connection_exhausted" | "connection_error" | "timeout" | "unknown";

/**
 * Stable (code, category) pair for persistence/alerting — distinct from
 * isTransientDbConnectionError's boolean, since health-check history and
 * alert routing need to tell EMAXCONNSESSION apart from a generic
 * connection drop, not just know "retry is safe".
 */
export function classifyDbError(err: unknown): { code: string | null; category: DbErrorCategory } {
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  const code = codeOf(err) ?? codeOf(cause) ?? null;
  const message = combinedMessage(err);

  if (/EMAXCONNSESSION|max clients reached/i.test(message) || code === "53300") {
    return { code: code ?? "EMAXCONNSESSION", category: "connection_exhausted" };
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return { code, category: "timeout" };
  }
  if (code && (TRANSIENT_NODE_CODES.has(code) || TRANSIENT_PG_CODES.has(code))) {
    return { code, category: "connection_error" };
  }
  return { code, category: "unknown" };
}
