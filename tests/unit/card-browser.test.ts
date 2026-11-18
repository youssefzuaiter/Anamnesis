import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BROWSE_PAGE_SIZE, MAX_QUERY, browseHref, dueLabel, kindLabel, parseBrowseParams, planCardEdit } from "@/lib/card-browser";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

test("the address names a search, a deck, a kind, a filter and a page, each only as one plain value", () => {
  const deck = randomUUID();
  assert.deepEqual(parseBrowseParams({}), { q: "", deck: null, kind: null, show: null, page: 1 });
  assert.deepEqual(parseBrowseParams({ q: "  learning   rate ", deck, kind: "cloze", show: "weak", page: "3" }), { q: "learning rate", deck, kind: "cloze", show: "weak", page: 3 });
  assert.equal(parseBrowseParams({ deck: "none" }).deck, "none");
  for (const bad of [["a", "b"], undefined, ""]) assert.equal(parseBrowseParams({ q: bad as never }).q, "", JSON.stringify(bad));
  assert.equal(parseBrowseParams({ deck: "not-a-course" }).deck, null);
  assert.equal(parseBrowseParams({ deck: [deck, deck] as never }).deck, null, "a repeated parameter is none");
  assert.equal(parseBrowseParams({ kind: "CLOZE" }).kind, null);
  assert.equal(parseBrowseParams({ show: "everything" }).show, null);
  for (const bad of ["0", "-1", "1.5", "abc", "99999999", "", " 2"]) assert.equal(parseBrowseParams({ page: bad }).page, 1, bad);
});

test("a search is one line of at most 200 characters", () => {
  assert.equal(MAX_QUERY, 200);
  assert.equal(parseBrowseParams({ q: "a\nb\tc" }).q, "a b c");
  assert.equal(parseBrowseParams({ q: "x".repeat(500) }).q.length, 200);
  assert.equal(parseBrowseParams({ q: `${" ".repeat(150)}${"y".repeat(100)}` }).q.length, 100);
});

test("a link keeps only what differs from the default, and round-trips through the parser", () => {
  assert.equal(browseHref({}), "/cards/all");
  assert.equal(browseHref({ q: "a b&c" }), "/cards/all?q=a+b%26c");
  const deck = randomUUID();
  const href = browseHref({ q: "rate", deck, kind: "basic", show: "due", page: 2 });
  const params = Object.fromEntries(new URL(href, "http://x").searchParams);
  assert.deepEqual(parseBrowseParams(params), { q: "rate", deck, kind: "basic", show: "due", page: 2 });
  assert.equal(browseHref({ page: 1 }), "/cards/all", "page one is the default");
  assert.equal(BROWSE_PAGE_SIZE, 50);
});

test("when a card is due, in words, by calendar day", () => {
  const now = at(2026, 11, 18, 14);
  assert.equal(dueLabel(at(2026, 11, 18, 9), now), "Due now");
  assert.equal(dueLabel(at(2026, 11, 10), now), "Due now");
  assert.equal(dueLabel(at(2026, 11, 18, 20), now), "Due later today");
  assert.equal(dueLabel(at(2026, 11, 19, 0), now), "Due tomorrow");
  assert.equal(dueLabel(at(2026, 11, 21, 8), now), "Due in 3 days");
  assert.equal(dueLabel(at(2026, 12, 18), now), "Due in 30 days");
});

test("a card is basic or fill in the blank, with which blank it is", () => {
  assert.equal(kindLabel(null, 1), "Basic");
  assert.equal(kindLabel(1, 2), "Fill in the blank (1 of 2)");
  assert.equal(kindLabel(2, 2), "Fill in the blank (2 of 2)");
});

const basic = { id: "a", clozeIndex: null };
test("editing a basic card needs a question and an answer within the limits, trimmed", () => {
  assert.deepEqual(planCardEdit(basic, [basic], { question: "  Q?  ", answer: " A " }), { ok: true, updates: [{ id: "a", question: "Q?", answer: "A" }] });
  for (const input of [{ question: "", answer: "A" }, { question: "Q", answer: "  " }, { question: "x".repeat(1001), answer: "A" }, { question: "Q", answer: "y".repeat(2001) }, {}]) {
    const r = planCardEdit(basic, [basic], input);
    assert.equal(r.ok, false, JSON.stringify(input).slice(0, 40));
  }
  assert.equal(planCardEdit(basic, [basic], { question: "x".repeat(1000), answer: "y".repeat(2000) }).ok, true, "the limits are exact");
});

const text = "The step is the {{c1::learning rate}}, set against the {{c2::gradient}}.";
const siblings = [{ id: "s1", clozeIndex: 1 }, { id: "s2", clozeIndex: 2 }];
test("editing a fill-in-the-blank card rewrites every card of the text, each with its own answer", () => {
  const r = planCardEdit(siblings[0], siblings, { text: "The step is the {{c1::step size}}, set against the {{c2::slope}}." });
  assert.deepEqual(r, { ok: true, updates: [{ id: "s1", question: "The step is the {{c1::step size}}, set against the {{c2::slope}}.", answer: "step size" }, { id: "s2", question: "The step is the {{c1::step size}}, set against the {{c2::slope}}.", answer: "slope" }] });
  assert.equal(planCardEdit(siblings[1], siblings, { text }).ok, true, "from either card");
});

test("the blanks must stay the same: adding or removing one is refused and says which", () => {
  const added = planCardEdit(siblings[0], siblings, { text: `${text} Also {{c3::momentum}}.` });
  assert.equal(added.ok, false);
  assert.match((added as { message: string }).message, /add a blank/i);
  const removed = planCardEdit(siblings[0], siblings, { text: "The step is the {{c1::learning rate}}." });
  assert.equal(removed.ok, false);
  assert.match((removed as { message: string }).message, /remove blank 2/i);
  const renumbered = planCardEdit(siblings[0], siblings, { text: "The {{c2::a}} and {{c3::b}}." });
  assert.equal(renumbered.ok, false);
});

test("a fill-in-the-blank text that is not a valid one is refused with the same messages as when it is made", () => {
  for (const bad of ["No blanks at all", "{{c1::open", "{{c1::}} empty", "", "x".repeat(2001)]) assert.equal(planCardEdit(siblings[0], siblings, { text: bad }).ok, false, bad.slice(0, 20));
});

test("a basic card cannot be given a text and a fill-in-the-blank card cannot be given a question", () => {
  assert.equal(planCardEdit(basic, [basic], { text }).ok, false);
  assert.equal(planCardEdit(siblings[0], siblings, { question: "Q", answer: "A" }).ok, false);
});
