import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "./pagination.js";

test("paginate: walks every page in order until nextCursor is null", async () => {
  const pages = [
    { data: [1, 2], pagination: { limit: 2, nextCursor: "cursor-a" } },
    { data: [3, 4], pagination: { limit: 2, nextCursor: "cursor-b" } },
    { data: [5], pagination: { limit: 2, nextCursor: null } },
  ];
  let callIndex = 0;
  const seenCursors: Array<string | undefined> = [];

  const items: number[] = [];
  for await (const item of paginate<number>((cursor) => {
    seenCursors.push(cursor);
    return Promise.resolve(pages[callIndex++]!);
  })) {
    items.push(item);
  }

  assert.deepEqual(items, [1, 2, 3, 4, 5]);
  assert.deepEqual(seenCursors, [undefined, "cursor-a", "cursor-b"]);
});

test("paginate: stops immediately on a single empty page", async () => {
  const items: number[] = [];
  for await (const item of paginate<number>(() => Promise.resolve({ data: [], pagination: { limit: 20, nextCursor: null } }))) {
    items.push(item);
  }
  assert.deepEqual(items, []);
});
