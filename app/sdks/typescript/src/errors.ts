import type { components } from "./generated/schema.js";

/**
 * Mirrors lib/api-v1/errors.ts's ApiErrorCode exactly — generated from the
 * OpenAPI spec's Error.properties.code enum (lib/api-v1/openapi.yaml), not
 * hand-copied. If the spec adds a code, this type widens automatically the
 * next time `npm run generate` runs; no separate list to keep in sync.
 */
export type PublicMapErrorCode = components["schemas"]["Error"]["error"]["code"];

/**
 * Thrown for every non-2xx /api/v1 response. `code` is the stable,
 * switchable value (`if (err.code === "RATE_LIMITED")`); `message` is for
 * humans and may change between API versions; `requestId` is what to quote
 * back to PUBLIC-MAP if you need help with a specific failed request.
 */
export class PublicMapApiError extends Error {
  /** Known codes autocomplete; `string & {}` keeps the type open so a
   * future API version's new code doesn't become a type error to handle —
   * see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-1.html#literal-type-widening
   * for why `string & {}` (not plain `string`) preserves the literal
   * suggestions in editors. */
  readonly code: PublicMapErrorCode | (string & {});
  readonly status: number;
  readonly requestId: string;
  /** Present when `code` is RATE_LIMITED or QUOTA_EXCEEDED — seconds to wait before retrying. */
  readonly retryAfterSeconds?: number;

  constructor(input: { code: PublicMapErrorCode | (string & {}); message: string; status: number; requestId: string; retryAfterSeconds?: number }) {
    super(input.message);
    this.name = "PublicMapApiError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

/** Thrown when the client can't even parse a response as the expected
 * {"error": {...}} envelope — a genuinely unexpected condition (network
 * proxy returning HTML, etc.), never a normal API error path. */
export class PublicMapUnexpectedResponseError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Unexpected response (status ${status}) — could not parse an error envelope.`);
    this.name = "PublicMapUnexpectedResponseError";
    this.status = status;
    this.body = body;
  }
}
