import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPdfPages, chunkPages } from "@/lib/pdf-pages";

// pdf-parse (the importer) appends "-- N of T --" after each page's text, so an imported paper's note already says where each page ends.
const paper = (pages: string[]) => pages.map((text, i) => `${text}\n-- ${i + 1} of ${pages.length} --`).join("\n");
const long = (word: string) => `${word} `.repeat(30).trim();

test("the text before a marker is that page, and the markers themselves are not part of any page", () => {
  const pages = splitPdfPages(paper(["First page text.", "Second page text.", "Third."]));
  assert.deepEqual(pages, [
    { page: 1, text: "First page text." },
    { page: 2, text: "Second page text." },
    { page: 3, text: "Third." },
  ]);
});

test("text after the last marker is the next page, as when a long document was cut off", () => {
  const text = `${paper(["One.", "Two."]).replace("-- 2 of 2 --", "-- 2 of 9 --").replace("-- 1 of 2 --", "-- 1 of 9 --")}\nThree is cut here\n\n[Truncated — the original document continues beyond this point.]`;
  const pages = splitPdfPages(text)!;
  assert.deepEqual(pages.map((p) => p.page), [1, 2, 3]);
  assert.match(pages[2].text, /Three is cut here/);
});

test("a note without markers, or whose markers do not make a page sequence, has no pages", () => {
  assert.equal(splitPdfPages("Just a note.\n\nWith two paragraphs."), null);
  assert.equal(splitPdfPages("a\n-- 3 of 10 --\nb\n-- 2 of 10 --\nc"), null, "numbers must increase");
  assert.equal(splitPdfPages("a\n-- 1 of 10 --\nb\n-- 2 of 11 --\nc"), null, "one total for the whole document");
  assert.equal(splitPdfPages("a\n-- 12 of 10 --\nb"), null, "a page past the total");
  assert.equal(splitPdfPages("a\n-- 0 of 10 --\nb"), null, "pages start at 1");
  assert.equal(splitPdfPages("x -- 1 of 2 --\nand more"), null, "a marker is a whole line");
  assert.equal(splitPdfPages("-- 1 of 2 -- x\nand more"), null, "a marker is a whole line");
});

test("a deleted marker does not throw the others away", () => {
  const pages = splitPdfPages("a\n-- 1 of 5 --\nb\n-- 3 of 5 --\nc\n-- 4 of 5 --")!;
  assert.deepEqual(pages.map((p) => p.page), [1, 3, 4]);
});

test("every chunk of a paper knows its page, and no chunk crosses a page", () => {
  const chunks = chunkPages(paper([long("alpha"), long("beta"), long("gamma")]));
  assert.deepEqual(chunks.map((c) => c.page), [1, 2, 3]);
  for (const c of chunks) assert.ok(!/-- \d+ of \d+ --/.test(c.text), "no marker inside a chunk");
  assert.match(chunks[1].text, /^beta/);
});

test("a long page makes several chunks, all on that page", () => {
  const big = Array.from({ length: 6 }, (_, i) => `${i} ${"word ".repeat(120)}`).join("\n\n");
  const chunks = chunkPages(paper([big, long("next")]));
  assert.ok(chunks.filter((c) => c.page === 1).length >= 2);
  assert.equal(chunks.filter((c) => c.page === 2).length, 1);
});

test("a page with almost no text (a figure, a page number) adds no chunk of its own", () => {
  const chunks = chunkPages(paper([long("alpha"), "7", long("gamma")]));
  assert.deepEqual(chunks.map((c) => c.page), [1, 3]);
});

test("without pages, chunking is exactly the old chunking with no page", () => {
  const chunks = chunkPages(`${long("one")}\n\n${long("two")}`);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((c) => c.page === null));
});

test("hostile input stays fast: 100,000 characters of markers and of near-markers", () => {
  for (const text of ["-- 1 of 2 --\n".repeat(7000), "-- ".repeat(33000), "\n".repeat(100000), `${"-- 1 of "}${"9".repeat(99000)}`]) {
    const start = performance.now();
    splitPdfPages(text);
    chunkPages(text);
    assert.ok(performance.now() - start < 2000);
  }
});

test("text after the last page's marker, when that was the final page, stays on that page", () => {
  const pages = splitPdfPages("one\n-- 1 of 2 --\ntwo\n-- 2 of 2 --\n[Truncated]")!;
  assert.deepEqual(pages.map((p) => p.page), [1, 2]);
  assert.match(pages[1].text, /two\n\n\[Truncated\]/);
});
