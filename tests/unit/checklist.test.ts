import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHECKLIST_ITEMS, MAX_ITEM_TITLE, checklistProgress, cleanItemTitle, moveItem, nextPosition, type Positioned } from "@/lib/checklist";

// Built from code points so no invisible character sits in this source file.
const NUL = String.fromCharCode(0);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x85);
const LONE = String.fromCharCode(0xd800);

const slow = (label: string, fn: () => void, ms = 50) => {
  const start = performance.now();
  fn();
  const took = performance.now() - start;
  assert.ok(took < ms, `${label} took ${took.toFixed(0)} ms, budget ${ms} ms`);
};

// --- titles -------------------------------------------------------------------------------------

test("the limits are the plan's", () => {
  assert.equal(MAX_CHECKLIST_ITEMS, 50);
  assert.equal(MAX_ITEM_TITLE, 200);
});

test("a plain title is kept, trimmed, with runs of spaces made one", () => {
  assert.equal(cleanItemTitle("Read chapter 4"), "Read chapter 4");
  assert.equal(cleanItemTitle("  Read   chapter  4  "), "Read chapter 4");
  assert.equal(cleanItemTitle(""), "");
  assert.equal(cleanItemTitle("   "), "");
});

test("line breaks, tabs and every other control character become a space", () => {
  assert.equal(cleanItemTitle("a\r\nb"), "a b");
  assert.equal(cleanItemTitle("a\nb\rc"), "a b c");
  assert.equal(cleanItemTitle("a\tb"), "a b");
  for (const separator of [LS, PS, NEL, NUL, "\u0007", "\u001b", "\u007f"]) {
    assert.equal(cleanItemTitle(`a${separator}b`), "a b", JSON.stringify(separator));
  }
  assert.equal(cleanItemTitle(`${NUL}${NUL}${NUL}`), "");
});

test("markup is text: it is kept as it was typed, for the page to show as text", () => {
  assert.equal(cleanItemTitle("<b>bold</b> & <img src=x onerror=alert(1)>"), "<b>bold</b> & <img src=x onerror=alert(1)>");
});

test("a long title is cut at 200 characters, and never in the middle of an emoji", () => {
  assert.equal(cleanItemTitle("x".repeat(300)).length, 200);
  const cut = cleanItemTitle("😀".repeat(150)); // two UTF-16 units each
  assert.ok(cut.length <= 200);
  assert.equal(Array.from(cut).every((ch) => ch === "😀"), true, "no half of an emoji");
  assert.equal(Array.from(cut).length, 100);
  assert.equal(cleanItemTitle(`${"x".repeat(199)}😀`).length, 199, "the pair that would straddle the limit is dropped whole");
});

test("a lone surrogate is replaced, a whole pair is kept", () => {
  assert.equal(cleanItemTitle(`a${LONE}b`), "a\ufffdb");
  assert.equal(cleanItemTitle("a😀b"), "a😀b");
});

test("hostile 100,000-character titles are cleaned in milliseconds", () => {
  slow("spaces", () => cleanItemTitle(" ".repeat(100_000)));
  slow("a and space", () => cleanItemTitle("a ".repeat(50_000)));
  slow("controls", () => cleanItemTitle("\u0007".repeat(100_000)));
  slow("separators", () => cleanItemTitle(`${LS}${NEL}`.repeat(50_000)));
  slow("emoji", () => cleanItemTitle("😀".repeat(50_000)));
  slow("long word", () => cleanItemTitle("a".repeat(100_000)));
});

// --- progress -----------------------------------------------------------------------------------

test("progress counts what is done, and is complete only when there is something and all of it is done", () => {
  assert.deepEqual(checklistProgress([]), { done: 0, total: 0, complete: false });
  assert.deepEqual(checklistProgress([{ done: false }, { done: true }, { done: false }]), { done: 1, total: 3, complete: false });
  assert.deepEqual(checklistProgress([{ done: true }, { done: true }]), { done: 2, total: 2, complete: true });
  assert.deepEqual(checklistProgress([{ done: true }]), { done: 1, total: 1, complete: true });
  assert.deepEqual(checklistProgress([{ done: false }]), { done: 0, total: 1, complete: false });
});

// --- order --------------------------------------------------------------------------------------

const list = (...pairs: [string, number][]): Positioned[] => pairs.map(([id, position]) => ({ id, position }));

test("the next position is one past the largest, and zero for an empty list", () => {
  assert.equal(nextPosition([]), 0);
  assert.equal(nextPosition([{ position: 0 }, { position: 1 }]), 2);
  assert.equal(nextPosition([{ position: 7 }, { position: 2 }]), 8, "a gap does not matter, nor the order given");
});

/** What a list reads as after the rows `moveItem` returned are written. */
function apply(items: Positioned[], changes: Positioned[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i.position]));
  for (const change of changes) byId.set(change.id, change.position);
  return [...byId.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}

test("moving an item up or down swaps it with its neighbour and leaves positions 0..n-1", () => {
  const items = list(["a", 0], ["b", 1], ["c", 2]);
  const down = moveItem(items, "a", "down");
  assert.ok(down);
  assert.deepEqual(apply(items, down), ["b", "a", "c"]);
  const up = moveItem(items, "c", "up");
  assert.ok(up);
  assert.deepEqual(apply(items, up), ["a", "c", "b"]);
  assert.deepEqual(down.map((r) => r.position).sort(), [0, 1], "only the two that changed are written");
});

test("the first item cannot go up, the last cannot go down, and an unknown id moves nothing", () => {
  const items = list(["a", 0], ["b", 1]);
  assert.equal(moveItem(items, "a", "up"), null);
  assert.equal(moveItem(items, "b", "down"), null);
  assert.equal(moveItem(items, "zzz", "up"), null);
  assert.equal(moveItem([], "a", "down"), null);
});

test("positions with gaps are renumbered by a move", () => {
  const items = list(["a", 0], ["b", 5], ["c", 9]);
  const changes = moveItem(items, "b", "down");
  assert.ok(changes);
  assert.deepEqual(apply(items, changes), ["a", "c", "b"]);
  assert.deepEqual(changes.map((c) => c.position).sort((x, y) => x - y), [1, 2], "b and c are renumbered to 1 and 2; a already is 0");
});

test("items that share a position are put in a stable order by id, then moved", () => {
  const items = list(["c", 1], ["a", 1], ["b", 1]);
  const changes = moveItem(items, "a", "down");
  assert.ok(changes);
  assert.deepEqual(apply(items, changes), ["b", "a", "c"]);
});

test("a long list moves in a few milliseconds", () => {
  const items = Array.from({ length: 5000 }, (_, i) => ({ id: `id${String(i).padStart(5, "0")}`, position: i * 3 }));
  slow("move", () => assert.ok(moveItem(items, "id02500", "up")), 50);
});
