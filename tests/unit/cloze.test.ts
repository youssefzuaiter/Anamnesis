import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CLOZE_CARDS,
  MAX_CLOZE_TEXT,
  answerFor,
  clozeFromSelection,
  clozeNumbers,
  nextClozeNumber,
  parseCloze,
  renderCloze,
  spreadSiblings,
  validateCloze,
} from "@/lib/cloze";

const TEXT = "{{c1::A}} and {{c2::B}} and {{c1::C::hint}}";

test("a deletion is read with its number, answer and hint", () => {
  assert.deepEqual(parseCloze("The {{c1::heart}} pumps {{c2::blood::fluid}}."), [
    { kind: "text", text: "The " },
    { kind: "cloze", n: 1, answer: "heart", hint: null },
    { kind: "text", text: " pumps " },
    { kind: "cloze", n: 2, answer: "blood", hint: "fluid" },
    { kind: "text", text: "." },
  ]);
});

test("numbers outside 1 to 99, with a leading zero, or without the double colon stay text", () => {
  for (const input of ["{{c0::a}}", "{{c100::a}}", "{{c01::a}}", "{{c1:a}}", "{{c::a}}", "{{cx::a}}"]) {
    const parts = parseCloze(input);
    assert.ok(parts.every((part) => part.kind === "text"), input);
    assert.equal(
      parts.map((part) => (part.kind === "text" ? part.text : "")).join(""),
      input,
    );
  }
});

test("an opener that is never closed, or followed by another opener first, stays text", () => {
  assert.deepEqual(parseCloze("{{c1::a {{c2::b}}"), [
    { kind: "text", text: "{{c1::a " },
    { kind: "cloze", n: 2, answer: "b", hint: null },
  ]);
  assert.deepEqual(parseCloze("{{c1::abc"), [{ kind: "text", text: "{{c1::abc" }]);
});

test("the first double colon splits answer from hint, later ones belong to the hint", () => {
  assert.deepEqual(parseCloze("{{c1::a::b::c}}"), [{ kind: "cloze", n: 1, answer: "a", hint: "b::c" }]);
  assert.deepEqual(parseCloze("{{c1::a::}}"), [{ kind: "cloze", n: 1, answer: "a", hint: null }]);
});

test("clozeNumbers lists each number once, ascending", () => {
  assert.deepEqual(clozeNumbers("{{c3::a}}{{c1::b}}{{c3::c}}"), [1, 3]);
  assert.deepEqual(clozeNumbers("no blanks"), []);
});

test("nextClozeNumber is one more than the highest in use, and nothing once 99 is used", () => {
  assert.equal(nextClozeNumber(""), 1);
  assert.equal(nextClozeNumber("no blanks"), 1);
  assert.equal(nextClozeNumber("{{c1::a}} {{c3::b}}"), 4);
  assert.equal(nextClozeNumber("{{c98::a}}"), 99);
  assert.equal(nextClozeNumber("{{c99::a}}"), null);
});

test("renderCloze hides one group and shows the others", () => {
  const one = renderCloze(TEXT, 1);
  assert.deepEqual(one.front, [
    { text: "…", role: "blank" },
    { text: " and B and ", role: "plain" },
    { text: "hint", role: "blank" },
  ]);
  assert.deepEqual(one.back, [
    { text: "A", role: "answer" },
    { text: " and B and ", role: "plain" },
    { text: "C", role: "answer" },
  ]);

  const two = renderCloze(TEXT, 2);
  assert.deepEqual(two.front, [
    { text: "A and ", role: "plain" },
    { text: "…", role: "blank" },
    { text: " and C", role: "plain" },
  ]);
});

test("renderCloze with a number that has no deletion shows everything plain", () => {
  const rendered = renderCloze(TEXT, 9);
  assert.deepEqual(rendered.front, [{ text: "A and B and C", role: "plain" }]);
  assert.deepEqual(rendered.back, rendered.front);
});

test("answerFor joins a group's answers with a comma", () => {
  assert.equal(answerFor(TEXT, 1), "A, C");
  assert.equal(answerFor(TEXT, 2), "B");
  assert.equal(answerFor(TEXT, 9), "");
});

test("validateCloze accepts a good text, trims it, and reports its numbers", () => {
  const result = validateCloze("  The {{c2::heart}} pumps {{c1::blood}}.  ");
  assert.deepEqual(result, { ok: true, text: "The {{c2::heart}} pumps {{c1::blood}}.", numbers: [1, 2] });
});

test("validateCloze refuses text that cannot make a card", () => {
  const refused = (text: string, expected: string) => {
    const result = validateCloze(text);
    assert.equal(result.ok, false, text.slice(0, 40));
    if (!result.ok) assert.ok(result.message.includes(expected), `${result.message} should include ${expected}`);
  };

  refused("", "first");
  refused("   \n ", "first");
  refused("{{c1::a}}" + "x".repeat(MAX_CLOZE_TEXT - 8), String(MAX_CLOZE_TEXT));
  refused("No blanks here", "Hide at least one");
  refused(
    Array.from({ length: MAX_CLOZE_CARDS + 1 }, (_, i) => `{{c${i + 1}::a}}`).join(" "),
    `at most ${MAX_CLOZE_CARDS}`,
  );
  refused("{{c1:: }}", "empty");
  refused("{{c1::a}} and {{c2::b", "{{c1::answer}}");
  refused("{{c1::a}} }}", "{{c1::answer}}");

  const exactly = "{{c1::a}}" + "x".repeat(MAX_CLOZE_TEXT - 9);
  assert.equal(exactly.length, MAX_CLOZE_TEXT);
  assert.equal(validateCloze(exactly).ok, true);
});

test("clozeFromSelection hides the selection inside its own sentence", () => {
  assert.equal(
    clozeFromSelection("Mitochondria make ATP in the cell. They are small.", "ATP"),
    "Mitochondria make {{c1::ATP}} in the cell.",
  );
  assert.equal(
    clozeFromSelection("One. Two has ATP here! Three.", "ATP"),
    "Two has {{c1::ATP}} here!",
  );
});

test("clozeFromSelection collapses whitespace and wraps the first of several occurrences", () => {
  assert.equal(
    clozeFromSelection("Mitochondria   make\n ATP   in the cell.", "ATP  in"),
    "Mitochondria make {{c1::ATP in}} the cell.",
  );
  assert.equal(clozeFromSelection("ATP and ATP.", "ATP"), "{{c1::ATP}} and ATP.");
});

test("clozeFromSelection neutralises braces already in the text, and the result still validates", () => {
  const result = clozeFromSelection("Use {{c1::x}} for blanks.", "blanks");
  assert.equal(result, "Use { {c1::x} } for {{c1::blanks}}.");
  assert.equal(validateCloze(result ?? "").ok, true);

  const triple = clozeFromSelection("a {{{ b }}} c", "c") ?? "";
  assert.ok(triple.includes("{{c1::c}}"));
  assert.equal(triple.replace("{{c1::c}}", "").includes("{{"), false);
  assert.equal(triple.replace("{{c1::c}}", "").includes("}}"), false);
});

test("clozeFromSelection keeps a long sentence short, cut on word boundaries", () => {
  const context = Array.from({ length: 150 }, (_, i) => `w${i}`).join(" ");
  assert.ok(context.length > 400);
  const result = clozeFromSelection(context, "w75") ?? "";
  assert.ok(result.includes("{{c1::w75}}"));
  assert.ok(result.length < 300, `length ${result.length}`);
  for (const token of result.split(" ")) {
    assert.match(token, /^(\{\{c1::)?w\d+(\}\})?$/);
  }
});

test("clozeFromSelection gives nothing when there is nothing to hide", () => {
  assert.equal(clozeFromSelection("Some sentence here.", ""), null);
  assert.equal(clozeFromSelection("Some sentence here.", "  \n "), null);
  assert.equal(clozeFromSelection("Some sentence here.", "absent"), null);
  const huge = "a".repeat(MAX_CLOZE_TEXT + 100);
  assert.equal(clozeFromSelection(huge, huge), null);
});

test("spreadSiblings keeps the first card of a cloze text and every basic card, in order", () => {
  const card = (id: string, noteId: string | null, question: string, clozeIndex: number | null) => ({
    id,
    noteId,
    question,
    clozeIndex,
  });
  const { session, held } = spreadSiblings([
    card("A", "n1", "What is A?", null),
    card("c1", "n1", "Q", 1),
    card("c2", "n1", "Q", 2),
    card("c3", "n2", "Q", 1),
    card("B", "n1", "What is B?", null),
    card("c4", null, "Q", 1),
  ]);
  assert.deepEqual(
    session.map((c) => c.id),
    ["A", "c1", "c3", "B", "c4"],
  );
  assert.equal(held, 1);
});

test("spreadSiblings holds back only cards of the same text, not other texts in the same note", () => {
  const card = (id: string, question: string, clozeIndex: number) => ({ id, noteId: "n1", question, clozeIndex });
  const { session, held } = spreadSiblings([
    card("a1", "The {{c1::heart}} pumps {{c2::blood}}", 1),
    card("a2", "The {{c1::heart}} pumps {{c2::blood}}", 2),
    card("b1", "The {{c1::lung}} takes in {{c2::air}}", 1),
    card("b2", "The {{c1::lung}} takes in {{c2::air}}", 2),
  ]);
  assert.deepEqual(
    session.map((c) => c.id),
    ["a1", "b1"],
  );
  assert.equal(held, 2);
});

test("hostile input of 100,000 characters parses in well under a second", () => {
  const inputs = [
    "{{c1::".repeat(16667),
    "{{c1::".repeat(16000) + "}}",
    "{{c1::{{c2::".repeat(8000) + "}}}}",
    "{{c1::a::" + "b".repeat(100000) + "}}",
  ];
  for (const input of inputs) {
    const start = performance.now();
    const parts = parseCloze(input);
    validateCloze(input);
    renderCloze(input, 1);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `${elapsed.toFixed(0)} ms for ${input.slice(0, 12)}…`);
    assert.ok(parts.length > 0);
  }

  const huge = parseCloze(inputs[3]);
  assert.equal(huge.length, 1);
  assert.equal(huge[0].kind === "cloze" ? huge[0].hint?.length : -1, 100000);
});

// At 100,000 characters a parser that searched again for the closer at every opener still
// finishes in about 20 ms, because `indexOf` is native, so the test above could not tell it
// from a linear one. It is quadratic all the same: 300 ms at 400,000 characters and 4.8 s
// at this size, against 12 ms for the real parser.
test("a parser that searched again at every opener would take seconds at 1.6 million characters", () => {
  const input = "{{c1::".repeat(266_000) + "}}";
  assert.ok(input.length > 1_500_000);
  const start = performance.now();
  const parts = parseCloze(input);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `${elapsed.toFixed(0)} ms`);
  assert.equal(parts.length, 2); // everything is text except the last, empty, deletion
});
