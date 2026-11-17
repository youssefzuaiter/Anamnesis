import { test } from "node:test";
import assert from "node:assert/strict";
import { rankWeak, WEAK_MIN_FAILS, WEAK_WINDOW_DAYS, windowStart } from "@/lib/weak-spots";

const NOW = new Date("2026-11-17T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const r = (cardId: string, grade: string | null, daysAgo: number) => ({ cardId, grade, reviewedAt: day(daysAgo) });

test("a card failed twice in the window is weak, once is not", () => {
  const ranked = rankWeak([r("a", "again", 5), r("a", "again", 2), r("b", "again", 1)], NOW);
  assert.deepEqual(ranked, [{ cardId: "a", fails: 2, lastFailed: day(2) }]);
});

test("a card mended by two good answers since its last failure is no longer weak", () => {
  const mended = [r("a", "again", 9), r("a", "again", 8), r("a", "good", 3), r("a", "easy", 1)];
  assert.deepEqual(rankWeak(mended, NOW), []);
  const half = [r("a", "again", 9), r("a", "again", 8), r("a", "good", 3), r("a", "hard", 1)];
  assert.equal(rankWeak(half, NOW).length, 1, "hard is not mending");
  const oneGood = [r("a", "again", 9), r("a", "again", 8), r("a", "good", 1)];
  assert.equal(rankWeak(oneGood, NOW).length, 1, "one good answer is not enough");
});

test("a card that failed again after being mended is weak again", () => {
  const rows = [r("a", "again", 9), r("a", "again", 8), r("a", "good", 7), r("a", "good", 6), r("a", "again", 1)];
  assert.equal(rankWeak(rows, NOW)[0].fails, 3);
});

test("reviews outside the window or with no grade count for nothing", () => {
  const rows = [r("a", "again", WEAK_WINDOW_DAYS + 1), r("a", "again", 3), r("a", null, 2), r("a", "again", WEAK_WINDOW_DAYS)];
  assert.equal(rankWeak(rows, NOW).length, 1, "one failure inside, one on the edge, one outside");
  assert.equal(rankWeak(rows, NOW)[0].fails, 2);
  assert.deepEqual(rankWeak([r("a", "again", 40), r("a", "again", 41)], NOW), []);
});

test("rows with no card are skipped, and the order is most failures then most recent failure then id", () => {
  const rows = [
    { cardId: null, grade: "again", reviewedAt: day(1) },
    { cardId: null, grade: "again", reviewedAt: day(2) },
    r("x", "again", 4), r("x", "again", 3),
    r("y", "again", 6), r("y", "again", 5), r("y", "again", 2),
    r("z", "again", 3), r("z", "again", 3),
  ];
  assert.deepEqual(rankWeak(rows, NOW).map((w) => w.cardId), ["y", "x", "z"]);
});

test("the rule's numbers are the ones the page says", () => {
  assert.equal(WEAK_MIN_FAILS, 2);
  assert.equal(WEAK_WINDOW_DAYS, 30);
  assert.equal(windowStart(NOW).getTime(), day(30).getTime());
});

test("a large log stays fast", () => {
  const rows = Array.from({ length: 100_000 }, (_, i) => r(`c${i % 5000}`, i % 3 === 0 ? "again" : "good", i % 30));
  const t = performance.now();
  rankWeak(rows, NOW);
  assert.ok(performance.now() - t < 1500);
});

test("a line with no grade is not an answer: it neither fails a card nor counts against mending it", () => {
  const rows = [r("a", "again", 9), r("a", "again", 8), r("a", "good", 3), r("a", "good", 2), r("a", null, 1)];
  assert.deepEqual(rankWeak(rows, NOW), [], "the two good answers still mend it");
});
