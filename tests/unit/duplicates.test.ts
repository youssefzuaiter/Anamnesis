import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COPY_MIN_CONTAINMENT,
  COPY_MIN_SIMILARITY,
  DUPLICATE_MIN_SIMILARITY,
  blocks,
  classifyPair,
  compareText,
  containment,
  jaccard,
  orderedPair,
  pairKey,
  planMerge,
  rewriteLinks,
  shingles,
  words,
  wordsKey,
} from "@/lib/duplicates";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";

const BASE = "Gradient descent minimises a loss function by repeatedly stepping in the direction of the negative gradient. The learning rate sets the step size.";

test("words ignore case, spacing, markup and punctuation, in any script", () => {
  assert.deepEqual(words("**Hello**,  WORLD!\n\n- Çok güzel 42"), ["hello", "world", "çok", "güzel", "42"]);
  assert.equal(wordsKey("A  b\n\nc"), wordsKey("a b c"));
  assert.deepEqual(words(""), []);
  assert.deepEqual(words("¿¡?!"), []);
});

test("a copy with other spacing and markup is the same text; an added sentence is contained but not the same", () => {
  const copy = compareText(BASE, `**${BASE.replace(". ", ".**\n\n")}`);
  assert.equal(copy.same, true);
  assert.equal(copy.containment, 1);
  assert.equal(copy.jaccard, 1);
  const edited = compareText(BASE, `${BASE} Momentum smooths the path.`);
  assert.equal(edited.same, false);
  assert.equal(edited.containment, 1, "the shorter note is wholly inside the longer");
  assert.ok(edited.jaccard < 1 && edited.jaccard > 0.7);
  const other = compareText(BASE, "Photosynthesis converts light energy into chemical energy stored in glucose.");
  assert.equal(other.containment, 0);
});

test("empty and one-word notes compare without dividing by zero", () => {
  assert.equal(compareText("", "").same, false, "two empty notes are not a duplicate");
  assert.equal(compareText("", "something here").containment, 0);
  assert.equal(compareText("hello", "hello").same, true);
  assert.equal(containment(shingles([]), shingles(["a", "b", "c"])), 0);
  assert.equal(jaccard(new Set(), new Set()), 0);
});

test("the pair is classified by the measured thresholds, at each boundary", () => {
  const copy = { same: false, containment: 1, jaccard: 0.9 };
  const reworded = { same: false, containment: 0.05, jaccard: 0.02 };
  assert.equal(classifyPair(null, { same: true, containment: 1, jaccard: 1 }), "same-text", "identical text needs no vector");
  assert.equal(classifyPair(null, copy), null, "no vector and not identical: not offered");
  assert.equal(classifyPair(COPY_MIN_SIMILARITY, copy), "same-text");
  assert.equal(classifyPair(COPY_MIN_SIMILARITY - 0.001, copy), "same-ideas", "close in words but a shade less alike in meaning");
  assert.equal(classifyPair(0.95, { ...reworded, containment: COPY_MIN_CONTAINMENT - 0.01 }), "same-ideas");
  assert.equal(classifyPair(0.95, { ...reworded, containment: COPY_MIN_CONTAINMENT }), "same-text");
  assert.equal(classifyPair(DUPLICATE_MIN_SIMILARITY, reworded), "same-ideas");
  assert.equal(classifyPair(DUPLICATE_MIN_SIMILARITY - 0.001, reworded), null);
  assert.equal(DUPLICATE_MIN_SIMILARITY, 0.88);
  assert.equal(COPY_MIN_SIMILARITY, 0.9);
});

test("a pair has one key whichever way round, and an ordered form", () => {
  assert.equal(pairKey("b", "a"), pairKey("a", "b"));
  assert.deepEqual(orderedPair("b", "a"), ["a", "b"]);
  assert.deepEqual(orderedPair("a", "b"), ["a", "b"]);
});

test("blocks split at blank lines, but a fenced block with blank lines inside is one", () => {
  const text = "first\nline\n\nsecond\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n\nlast";
  assert.deepEqual(blocks(text), ["first\nline", "second", "```js\nconst a = 1;\n\nconst b = 2;\n```", "last"]);
  assert.deepEqual(blocks("   \n\n"), []);
  assert.deepEqual(blocks("a\r\n\r\nb"), ["a", "b"]);
});

test("merging a copy adds nothing; a paragraph only the other has is added under a heading, in order, and nothing is removed", () => {
  const keep = "Intro paragraph.\n\nShared paragraph here.";
  const same = planMerge(keep, "Other", "intro  PARAGRAPH.\n\n**Shared** paragraph here.");
  assert.ok(same.ok);
  if (same.ok) {
    assert.equal(same.content, keep);
    assert.deepEqual(same.added, []);
  }
  const more = planMerge(keep, "Other note", "Shared paragraph here.\n\nOnly in the other.\n\n```py\nprint(1)\n\nprint(2)\n```");
  assert.ok(more.ok);
  if (more.ok) {
    assert.deepEqual(more.added, ["Only in the other.", "```py\nprint(1)\n\nprint(2)\n```"]);
    assert.equal(more.content, `${keep}\n\n## Merged from Other note\n\nOnly in the other.\n\n\`\`\`py\nprint(1)\n\nprint(2)\n\`\`\`\n`);
    assert.ok(more.content.startsWith(keep), "the kept text is untouched, at the start");
  }
});

test("a block is 'already there' only as whole words in order, so a longer sentence is not hidden by a shorter one", () => {
  const plan = planMerge("The cat sat.", "Other", "The cat sat on the mat.");
  assert.ok(plan.ok);
  if (plan.ok) assert.deepEqual(plan.added, ["The cat sat on the mat."]);
  const part = planMerge("concatenate strings", "Other", "cat");
  assert.ok(part.ok);
  if (part.ok) assert.deepEqual(part.added, ["cat"], "'cat' inside 'concatenate' is not the word cat");
});

test("a title with line breaks cannot break the heading, and an empty kept note takes the other's text", () => {
  const plan = planMerge("", "Two\nlines\r\n", "Body text.");
  assert.ok(plan.ok);
  if (plan.ok) assert.equal(plan.content, "## Merged from Two lines\n\nBody text.\n");
});

test("a merge that would not fit in one note is refused, not cut", () => {
  const keep = "word ".repeat(MAX_NOTE_LENGTH / 5 - 10);
  const plan = planMerge(keep, "Other", "a different paragraph that is not in the first note at all".repeat(10));
  assert.deepEqual(plan, { ok: false, reason: "too-long" });
});

test("links are rewritten where they are links, and only the exact title", () => {
  const text = "See [[Old title]] and [[ old  TITLE ]], not [[Old title extra]] or `[[Old title]]`.\n\n```md\n[[Old title]]\n```\n\n[[Old title]]";
  const result = rewriteLinks(text, "Old title", "New title");
  assert.equal(result.changed, 3);
  assert.equal(result.content, "See [[New title]] and [[New title]], not [[Old title extra]] or `[[Old title]]`.\n\n```md\n[[Old title]]\n```\n\n[[New title]]");
  assert.deepEqual(rewriteLinks("[[A]]", "a", "A"), { content: "[[A]]", changed: 0 }, "titles that are one title change nothing");
  assert.deepEqual(rewriteLinks("[[A]]", "  ", "B"), { content: "[[A]]", changed: 0 });
  assert.equal(rewriteLinks("[[A]]\r\n[[A]]", "A", "B").content, "[[B]]\r\n[[B]]", "line endings survive");
});

test("hostile text costs little: 100,000 words, a million brackets, a million backticks", () => {
  const started = performance.now();
  const big = "alpha beta gamma delta ".repeat(25_000);
  compareText(big, `${big} epsilon`);
  planMerge(big, "x", `${big}\n\nnew words`);
  rewriteLinks(`${"[[".repeat(500_000)}x`, "x", "y");
  rewriteLinks("`".repeat(1_000_000), "x", "y");
  blocks("\n".repeat(1_000_000));
  assert.ok(performance.now() - started < 4000, "linear, not quadratic");
});
