import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesUsed, pagesSentence } from "@/lib/pages-used";

const cite = (sourceId: string, title: string, page: number | null, index = 1) => ({ index, sourceId, title, page });

test("the pages an answer used are grouped by paper, sorted, and each listed once", () => {
  const used = pagesUsed([cite("a", "Paper A", 7), cite("b", "Paper B", 2), cite("a", "Paper A", 3), cite("a", "Paper A", 7), cite("c", "A note", null)]);
  assert.deepEqual(used, [
    { sourceId: "a", title: "Paper A", pages: [3, 7] },
    { sourceId: "b", title: "Paper B", pages: [2] },
  ]);
});

test("citations with no page give nothing", () => {
  assert.deepEqual(pagesUsed([cite("a", "A note", null)]), []);
  assert.deepEqual(pagesUsed([]), []);
});

test("the sentence says page or pages and joins them plainly", () => {
  assert.equal(pagesSentence({ sourceId: "a", title: "T", pages: [4] }), "Used page 4 of T.");
  assert.equal(pagesSentence({ sourceId: "a", title: "T", pages: [3, 7] }), "Used pages 3 and 7 of T.");
  assert.equal(pagesSentence({ sourceId: "a", title: "T", pages: [3, 7, 12] }), "Used pages 3, 7 and 12 of T.");
});
