import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_MENTION_TITLE_LENGTH, mentionSnippet } from "@/lib/mentions";

const TITLE = "Gradient descent";

test("the shortest title that can be a mention is five characters", () => {
  assert.equal(MIN_MENTION_TITLE_LENGTH, 5);
});

test("a whole-word mention is found, in any case", () => {
  const snippet = mentionSnippet("I revised gradient descent today", TITLE);
  assert.ok(snippet);
  assert.ok(snippet.includes("gradient descent"));
});

test("the title as written in the text is what the snippet shows", () => {
  const snippet = mentionSnippet("Notes on GRADIENT   DESCENT here", TITLE);
  assert.ok(snippet?.includes("GRADIENT   DESCENT") || snippet?.includes("GRADIENT DESCENT"));
});

test("a mention at the very start and at the very end counts", () => {
  assert.ok(mentionSnippet("Gradient descent is next", TITLE));
  assert.ok(mentionSnippet("Next up: gradient descent", TITLE));
  assert.ok(mentionSnippet("gradient descent", TITLE));
});

test("a mention punctuation sits next to still counts", () => {
  assert.ok(mentionSnippet("(gradient descent), then more", TITLE));
  assert.ok(mentionSnippet("Why gradient descent? Because.", TITLE));
});

test("a word that merely contains the title does not count", () => {
  assert.equal(mentionSnippet("gradient descents", TITLE), null);
  assert.equal(mentionSnippet("subgradient descent", TITLE), null);
  assert.equal(mentionSnippet("Gradient descent2", TITLE), null);
  assert.equal(mentionSnippet("Gradient_descent", TITLE), null);
});

test("a word break inside the title may be a different run of spaces or a tab", () => {
  assert.ok(mentionSnippet("gradient\tdescent works", TITLE));
});

test("a title does not match across a line break", () => {
  assert.equal(mentionSnippet("gradient\ndescent", TITLE), null);
});

test("a title with regular-expression characters is matched literally", () => {
  assert.ok(mentionSnippet("I like C++ (basics) a lot", "C++ (basics)"));
  assert.equal(mentionSnippet("I like C (basics) a lot", "C++ (basics)"), null);
  assert.equal(mentionSnippet("Costs 1x2 total", "1.2 total"), null);
});

test("non-Latin letters are whole-word characters too", () => {
  assert.ok(mentionSnippet("bugün öğrenme oranı üzerine çalıştım", "Öğrenme oranı"));
  assert.ok(mentionSnippet("Çalışma planı hazır", "Çalışma planı"));
  assert.equal(mentionSnippet("öğrenme oranıyla", "Öğrenme oranı"), null);
});

test("Turkish dotted and dotless i are not folded, and nothing throws", () => {
  assert.doesNotThrow(() => mentionSnippet("ÖĞRENME ORANI", "Öğrenme oranı"));
  assert.doesNotThrow(() => mentionSnippet("İstanbul planı", "Istanbul planı"));
});

test("a mention inside a fenced code block does not count", () => {
  assert.equal(mentionSnippet("```\ngradient descent\n```", TITLE), null);
  assert.equal(mentionSnippet("~~~py\n# gradient descent\n~~~\n", TITLE), null);
});

test("an unterminated fence hides the rest of the note", () => {
  assert.equal(mentionSnippet("```\nstart\ngradient descent", TITLE), null);
});

test("a mention inside inline code does not count", () => {
  assert.equal(mentionSnippet("run `gradient descent` now", TITLE), null);
  assert.equal(mentionSnippet("run ``gradient descent`` now", TITLE), null);
});

test("a mention in a Markdown link's text or address does not count", () => {
  assert.equal(mentionSnippet("[gradient descent](https://x.example)", TITLE), null);
  assert.equal(mentionSnippet("[see this](https://x.example/gradient descent)", TITLE), null);
  assert.equal(mentionSnippet("![gradient descent](pic.png)", TITLE), null);
});

test("a mention inside a bare address does not count", () => {
  assert.equal(
    mentionSnippet("see https://example.com/gradient-descent for more", TITLE),
    null,
  );
  assert.equal(mentionSnippet("<https://example.com/gradient descent>", "gradient descent"), null);
});

test("a mention inside a wiki link, linked or longer, does not count", () => {
  assert.equal(mentionSnippet("see [[Gradient descent]] for more", TITLE), null);
  assert.equal(mentionSnippet("see [[Gradient descent intro]] for more", TITLE), null);
});

test("a mention outside those places still counts when the note also has some inside", () => {
  const text = "```\ngradient descent\n```\n\n`gradient descent` and [[Gradient descent]], but I also revised gradient descent today.\n";
  const snippet = mentionSnippet(text, TITLE);
  assert.ok(snippet);
  assert.ok(snippet.includes("I also revised gradient descent today"));
});

test("code between the words of the title does not join them", () => {
  assert.equal(mentionSnippet("gradient `x` descent", TITLE), null);
  assert.equal(mentionSnippet("gradient [[x]] descent", TITLE), null);
});

test("a title shorter than the minimum never counts", () => {
  assert.equal(mentionSnippet("the AI is here", "AI"), null);
  assert.equal(mentionSnippet("an ML note", "ML"), null);
  assert.equal(mentionSnippet("some text about math", "math"), null);
  assert.ok(mentionSnippet("some text about maths", "maths"));
});

test("a blank title never counts", () => {
  assert.equal(mentionSnippet("anything", ""), null);
  assert.equal(mentionSnippet("anything", "     "), null);
});

test("an empty note has no mention", () => {
  assert.equal(mentionSnippet("", TITLE), null);
});

test("the snippet is one line of about 90 characters with the title inside", () => {
  const filler = "word ".repeat(60);
  const text = `${filler}gradient descent ${filler}\nsecond line`;
  const snippet = mentionSnippet(text, TITLE);
  assert.ok(snippet);
  assert.ok(!snippet.includes("\n"));
  assert.ok(snippet.length <= 100, `length ${snippet.length}`);
  assert.ok(snippet.includes("gradient descent"));
  assert.ok(snippet.startsWith("…") && snippet.endsWith("…"));
});

test("a short line is shown whole and a long title is not cut", () => {
  assert.equal(mentionSnippet("I revised gradient descent today", TITLE), "I revised gradient descent today");
  const long = `${"a".repeat(30)} ${"b".repeat(95)}`;
  const snippet = mentionSnippet(`before ${long} after`, long);
  assert.ok(snippet?.includes(long));
});

test("the snippet has no Markdown markers from the surrounding line", () => {
  assert.equal(mentionSnippet("## Revising gradient descent", TITLE), "Revising gradient descent");
  assert.equal(mentionSnippet("- [ ] revise gradient descent", TITLE), "revise gradient descent");
  assert.equal(mentionSnippet("> gradient descent quote", TITLE), "gradient descent quote");
  const withCode = mentionSnippet("`x` then gradient descent ```", TITLE);
  assert.ok(withCode && !withCode.includes("`"));
});

test("Windows line endings do not reach the snippet", () => {
  const snippet = mentionSnippet("first\r\nI revised gradient descent today\r\nlast", TITLE);
  assert.equal(snippet, "I revised gradient descent today");
});
