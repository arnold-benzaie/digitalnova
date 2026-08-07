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

export function isTransientDbConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const cause = (err as { cause?: unknown }).cause;
  const directCode = codeOf(err);
  const causeCode = codeOf(cause);
  if (directCode && TRANSIENT_NODE_CODES.has(directCode)) return true;
  if (causeCode && TRANSIENT_NODE_CODES.has(causeCode)) return true;
  if (causeCode && TRANSIENT_PG_CODES.has(causeCode)) return true;
  if (directCode && TRANSIENT_PG_CODES.has(directCode)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /EMAXCONNSESSION|max clients reached/i.test(message);
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
