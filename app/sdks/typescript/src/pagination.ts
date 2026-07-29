/** Shape every /api/v1 list endpoint returns — see components.schemas.Pagination
 * in lib/api-v1/openapi.yaml and lib/api-v1/pagination.ts. */
export type Page<T> = {
  data: T[];
  pagination: { limit: number; nextCursor: string | null };
};

/**
 * Walks every page of a cursor-paginated list automatically, yielding one
 * item at a time — e.g. `for await (const audit of paginate((cursor) =>
 * client.audits.list({ cursor }))) { ... }`. The cursor is always passed
 * back exactly as received (opaque, per lib/api-v1/pagination.ts) — this
 * helper never inspects or constructs it.
 */
export async function* paginate<T>(fetchPage: (cursor?: string) => Promise<Page<T>>): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.data) yield item;
    if (!page.pagination.nextCursor) return;
    cursor = page.pagination.nextCursor;
  }
}
