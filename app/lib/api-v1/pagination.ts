import "server-only";
import { ApiError } from "@/lib/api-v1/errors";

/**
 * Cursor-based pagination for /api/v1 list routes — deliberately NOT the
 * page/pageSize+offset pattern used internally by the admin UI
 * (lib/integrations/queries.ts's listDeliveriesForOrg and others): an
 * external caller polling a list over time (the expected usage — n8n/
 * Zapier/Make watching for new audits) would see items shift between
 * pages under offset pagination whenever a row is inserted ahead of it.
 * A cursor anchored on the last row seen doesn't have that problem.
 *
 * Every list query orders rows `DESC(createdAt), DESC(id)` — the id
 * tiebreaker keeps ordering (and therefore pagination) stable even when
 * two rows share the exact same createdAt timestamp. The cursor is an
 * opaque, base64url-encoded `{createdAt, id}` of the last row on the
 * current page; decoding it never trusts its shape without validating
 * it first (a hand-crafted or corrupted cursor must fail cleanly with
 * VALIDATION_ERROR, never crash into a 500 or silently misbehave).
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type Cursor = { createdAt: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("VALIDATION_ERROR", 'The "cursor" parameter is invalid.');
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Cursor).createdAt !== "string" ||
    typeof (parsed as Cursor).id !== "string" ||
    Number.isNaN(Date.parse((parsed as Cursor).createdAt))
  ) {
    throw new ApiError("VALIDATION_ERROR", 'The "cursor" parameter is invalid.');
  }
  return parsed as Cursor;
}

export type PaginationParams = { limit: number; cursor: Cursor | null };

export function parsePaginationParams(searchParams: URLSearchParams): PaginationParams {
  const limitParam = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      throw new ApiError("VALIDATION_ERROR", `"limit" must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    limit = n;
  }

  const cursorParam = searchParams.get("cursor");
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;

  return { limit, cursor };
}

export type PageMeta<T> = { page: T[]; nextCursor: string | null };

/**
 * Callers fetch `limit + 1` rows ordered DESC(createdAt), DESC(id); this
 * trims to `limit` and, if that extra row was present, encodes a cursor
 * from the last row actually returned — never from the discarded extra
 * one, so the next page starts exactly where this one ended.
 */
export function buildPageMeta<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): PageMeta<T> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { page, nextCursor };
}
