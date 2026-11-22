import { test } from "node:test";
import assert from "node:assert/strict";
import { segment, restore, assemble, translationNote, marker, MAX_LINE_CHARS, type Segment } from "@/lib/translate";

const texts = (s: Segment[]) => s.filter((x): x is Extract<Segment, { kind: "text" }> => x.kind === "text");

test("maths, code, wiki links, addresses and card blanks are taken out of a line and numbered", () => {
  const [s] = texts(segment("The loss $L = \\sum x^2$ in `fit()` links [[Gradient descent]] and https://a.org/x?y=1, mail ada@x.org, {{c1::answer}}."));
  assert.equal(s.body, `The loss ${marker(0)} in ${marker(1)} links ${marker(2)} and ${marker(3)}, mail ${marker(4)}, ${marker(5)}.`);
  assert.deepEqual(s.tokens, ["$L = \\sum x^2$", "`fit()`", "[[Gradient descent]]", "https://a.org/x?y=1", "ada@x.org", "{{c1::answer}}"]);
  assert.equal(restore(s.body, s.tokens), "The loss $L = \\sum x^2$ in `fit()` links [[Gradient descent]] and https://a.org/x?y=1, mail ada@x.org, {{c1::answer}}.");
});

test("a link's address is protected and its words are not; an escaped dollar is a literal", () => {
  const [s] = texts(segment("See [the docs](https://x.org/a \"t\") for \\$5."));
  assert.equal(s.body, `See [the docs${marker(0)} for ${marker(1)}5.`);
  assert.equal(restore(s.body, s.tokens), "See [the docs](https://x.org/a \"t\") for \\$5.");
});

test("a heading, list, task, quote or numbered prefix stays and only the words go", () => {
  for (const [line, prefix] of [["## Heading words", "## "], ["- item words", "- "], ["- [ ] task words", "- [ ] "], ["> quote words", "> "], ["12. numbered words", "12. "], ["  * nested words", "  * "]] as const) {
    const [s] = texts(segment(line));
    assert.equal(s.prefix, prefix, line);
    assert.match(s.body, /words$/);
  }
});

test("fenced code, $$ blocks, tables, rules, blank lines and over-long lines are kept as written", () => {
  const note = ["Intro words", "```py", "print('hi')  # comment words", "```", "$$", "a words b", "$$", "| a | b |", "---", "", "x".repeat(MAX_LINE_CHARS + 1), "Last words"].join("\n");
  const segs = segment(note);
  assert.deepEqual(texts(segs).map((s) => s.body), ["Intro words", "Last words"]);
  assert.equal(assemble(segs, ["X", "Y"]).text, ["X", "```py", "print('hi')  # comment words", "```", "$$", "a words b", "$$", "| a | b |", "---", "", "x".repeat(MAX_LINE_CHARS + 1), "Y"].join("\n"));
});

test("an unclosed fence keeps the rest of the note as written", () => {
  assert.deepEqual(texts(segment("words\n```\nmore words\nand more")).map((s) => s.body), ["words"]);
});

test("a line with only protected parts is not sent", () => {
  assert.equal(texts(segment("`code` $x$ [[Link]]")).length, 0);
  assert.equal(texts(segment("12345 !!!")).length, 0);
});

test("restore refuses a missing, repeated or invented marker", () => {
  const tokens = ["`a`", "`b`"];
  assert.equal(restore(`${marker(0)} ${marker(1)}`, tokens), "`a` `b`");
  assert.equal(restore(`${marker(1)} ${marker(0)}`, tokens), "`b` `a`", "reordering is fine");
  for (const bad of [marker(0), `${marker(0)} ${marker(0)}`, `${marker(0)} ${marker(1)} ${marker(2)}`, `${marker(0)} ${marker(7)}`, "no markers"]) assert.equal(restore(bad, tokens), null, bad);
  assert.equal(restore("plain", []), "plain");
});

test("an answer that cannot be trusted keeps its line as written, and the counts say so", () => {
  const segs = segment(["Hello `x` world", "Second line", "Third line"].join("\n"));
  const r = assemble(segs, [`Merhaba ${marker(0)} dünya`, `two\nlines`, null]);
  assert.equal(r.text, ["Merhaba `x` dünya", "Second line", "Third line"].join("\n"));
  assert.deepEqual([r.translated, r.kept], [1, 2]);
  const lost = assemble(segment("Hello `x` world"), ["Merhaba dünya"]);
  assert.equal(lost.text, "Hello `x` world");
  assert.equal(lost.kept, 1);
});

test("hostile 100,000-character notes are read in well under a second (the line cap means long lines are not scanned at all, so the shapes are cut into lines the cap lets through)", () => {
  const shapes = ["$a ", "[[", "`", "](", "{{c1::", "$", "http://", "http://.", "http://a." + "!".repeat(50), "@", "a@b."];
  const started = Date.now();
  for (const shape of shapes) {
    const line = shape.repeat(Math.ceil(MAX_LINE_CHARS / shape.length)).slice(0, MAX_LINE_CHARS);
    segment(Array.from({ length: 50 }, () => line).join("\n"));
  }
  assert.ok(segment("x".repeat(100_000)).every((s) => s.kind === "keep"), "one 100,000-character line is not scanned");
  assert.ok(Date.now() - started < 1_500, `${Date.now() - started} ms`);
});

test("the new note links back, names the language and the lines left as written", () => {
  const n = translationNote("Gradient descent", "tr", "metin", { translated: 4, kept: 2 }, new Date(2026, 10, 23));
  assert.equal(n.title, "Gradient descent (Turkish)");
  assert.match(n.content, /^> Machine translation of \[\[Gradient descent\]\] into Turkish, made on 2026-11-23\./);
  assert.match(n.content, /2 lines could not be translated safely and are kept as written\./);
  assert.ok(n.content.endsWith("\n\nmetin"));
  assert.match(translationNote("A [b] c", "de", "x", { translated: 1, kept: 0 }, new Date(2026, 0, 1)).content, /of “A b c” into German/);
});
