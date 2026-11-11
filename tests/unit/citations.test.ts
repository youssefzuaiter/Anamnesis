import { test } from "node:test";
import assert from "node:assert/strict";
import { citedKeys, findCitations } from "@/lib/citations";

const known = (key: string) => ["vaswani2017", "devlin2019", "a", "b", "who"].includes(key);
const items = (text: string) => findCitations(text, known).map((c) => ({ text: text.slice(c.start, c.end), items: c.items, narrative: c.narrative }));

test("bracketed citations, with locators, prefixes, several works and year only", () => {
  assert.deepEqual(items("As shown [@vaswani2017]."), [
    { text: "[@vaswani2017]", narrative: false, items: [{ key: "vaswani2017", prefix: "", locator: "", suppressAuthor: false }] },
  ]);
  assert.deepEqual(items("[@vaswani2017, p. 3]")[0].items[0].locator, "p. 3");
  assert.deepEqual(items("[see @a, chap. 2; also @b]")[0].items, [
    { key: "a", prefix: "see", locator: "chap. 2", suppressAuthor: false },
    { key: "b", prefix: "also", locator: "", suppressAuthor: false },
  ]);
  assert.deepEqual(items("Vaswani says [-@vaswani2017]")[0].items[0].suppressAuthor, true);
  assert.deepEqual(items("[@unknownKey]")[0].items[0].key, "unknownKey", "a bracket cites even a key that is not known yet");
});

test("a bare @key is a narrative citation only when it is known, and its trailing punctuation is not the key", () => {
  assert.deepEqual(items("@vaswani2017 introduced it."), [
    { text: "@vaswani2017", narrative: true, items: [{ key: "vaswani2017", prefix: "", locator: "", suppressAuthor: false }] },
  ]);
  assert.deepEqual(items("As in @devlin2019."), [{ text: "@devlin2019", narrative: true, items: [{ key: "devlin2019", prefix: "", locator: "", suppressAuthor: false }] }]);
  assert.deepEqual(items("Ping @someone about it."), []);
  assert.deepEqual(items("mail me at a@b.com or who@example.org"), [], "an @ inside a word is not a citation");
});

test("brackets that are not citations are left alone", () => {
  for (const text of ["[a link](http://x)", "[[Wiki title]]", "[x] task", "[see the notes]", "[@]", "[@ a]", "[email@x.com]", "[@a; plain words]", "[@a b]", `[@a, ${"x".repeat(1_000)}]`]) {
    assert.deepEqual(items(text).filter((c) => !c.narrative), [], text);
  }
});

test("the keys a note cites, outside code, in order of first appearance", () => {
  const note = "Intro [@b; @a].\n\n```\n[@incode]\n```\n\nInline `[@inline]` and @who again [@a].";
  assert.deepEqual(citedKeys(note), ["b", "a", "who"]);
});

test("long hostile text is read quickly", () => {
  for (const text of ["[@".repeat(100_000), "@".repeat(300_000), "[" + "@a; ".repeat(50_000), "[@a, " + "x".repeat(300_000)]) {
    const started = performance.now();
    findCitations(text, known);
    citedKeys(text);
    assert.ok(performance.now() - started < 300, `${text.slice(0, 10)}: ${performance.now() - started} ms`);
  }
});
