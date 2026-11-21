import { test } from "node:test";
import assert from "node:assert/strict";
import { CRAM_SESSION, cramCounts, cramReason, rankCram, type CramCard } from "@/lib/cram";

const NOW = new Date(2026, 10, 18, 12);
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const card = (id: string, over: Partial<CramCard> = {}): CramCard => ({ id, easeFactor: 2.5, lastReviewed: ago(2), dueAt: ago(0), ...over });
const line = (cardId: string, grade: string | null, d: number) => ({ cardId, grade, reviewedAt: ago(d) });
const ids = (r: { id: string }[]) => r.map((e) => e.id);

test("weak cards first (most failures first), then failed once, then never reviewed, then the rest hardest first", () => {
  const cards = [
    card("rest-easy", { easeFactor: 2.8 }), card("rest-hard", { easeFactor: 1.4 }), card("new-b", { lastReviewed: null, dueAt: ago(1) }), card("new-a", { lastReviewed: null, dueAt: ago(5) }),
    card("failed-once"), card("weak-two"), card("weak-three"),
  ];
  const lines = [line("failed-once", "again", 3), line("weak-two", "again", 5), line("weak-two", "again", 4), line("weak-three", "again", 9), line("weak-three", "again", 8), line("weak-three", "again", 1)];
  const ranked = rankCram(cards, lines, NOW);
  assert.deepEqual(ids(ranked), ["weak-three", "weak-two", "failed-once", "new-a", "new-b", "rest-hard", "rest-easy"]);
  assert.deepEqual(ranked.map((e) => e.tier), ["weak", "weak", "failed", "new", "new", "rest", "rest"]);
  assert.deepEqual(ranked.slice(0, 3).map((e) => e.fails), [3, 2, 1]);
});

test("a card mended by two good answers is not weak but still counts as failed lately", () => {
  const ranked = rankCram([card("c")], [line("c", "again", 9), line("c", "again", 8), line("c", "good", 3), line("c", "easy", 1)], NOW);
  assert.deepEqual(ranked.map((e) => [e.tier, e.fails]), [["failed", 2]]);
});

test("failures older than 30 days, ungraded lines and lines of other cards count for nothing", () => {
  const ranked = rankCram([card("c"), card("d")], [line("c", "again", 40), line("c", "again", 41), line("c", null, 1), line("other", "again", 1), line("d", "hard", 1)], NOW);
  assert.deepEqual(ranked.map((e) => [e.id, e.tier, e.fails]), [["c", "rest", 0], ["d", "rest", 0]]);
});

test("every card appears exactly once whatever the log, and the order is the same every time", () => {
  const cards = Array.from({ length: 30 }, (_, i) => card(`c${String(i).padStart(2, "0")}`, { easeFactor: 1.3 + (i % 5) * 0.2, lastReviewed: i % 4 === 0 ? null : ago(1) }));
  const lines = cards.flatMap((c, i) => (i % 3 === 0 ? [line(c.id, "again", 2), line(c.id, "again", 1)] : []));
  const a = rankCram(cards, lines, NOW);
  const b = rankCram([...cards].reverse(), [...lines].reverse(), NOW);
  assert.deepEqual(ids(a), ids(b));
  assert.equal(new Set(ids(a)).size, 30);
  assert.deepEqual(rankCram([], lines, NOW), []);
});

test("why a card is in its place, in words", () => {
  const [weak, once, fresh, rest] = [
    { id: "a", tier: "weak" as const, fails: 3 }, { id: "b", tier: "failed" as const, fails: 1 }, { id: "c", tier: "new" as const, fails: 0 }, { id: "d", tier: "rest" as const, fails: 0 },
  ];
  assert.equal(cramReason(weak), "Weak: failed 3 times this month");
  assert.equal(cramReason(once), "Failed once this month");
  assert.equal(cramReason({ id: "e", tier: "failed", fails: 2 }), "Failed 2 times this month");
  assert.equal(cramReason(fresh), "Never reviewed");
  assert.equal(cramReason(rest), null);
  assert.deepEqual(cramCounts([weak, once, fresh, rest, rest]), { weak: 1, failed: 1, fresh: 1, rest: 2 });
  assert.equal(CRAM_SESSION, 50);
});

test("a 20,000-card course with a big log ranks in well under a second", () => {
  const cards = Array.from({ length: 20_000 }, (_, i) => card(`id${i}`, { easeFactor: 1.3 + (i % 17) * 0.1 }));
  const lines = cards.flatMap((c, i) => (i % 2 === 0 ? [line(c.id, "again", 3), line(c.id, "good", 1)] : []));
  const t = Date.now();
  assert.equal(rankCram(cards, lines, NOW).length, 20_000);
  assert.ok(Date.now() - t < 1000);
});

test("among cards failed lately, more failures come first, ahead of how hard they are", () => {
  const cards = [card("once-hard", { easeFactor: 1.3 }), card("twice-mended", { easeFactor: 2.6 })];
  const lines = [line("once-hard", "again", 4), line("twice-mended", "again", 9), line("twice-mended", "again", 8), line("twice-mended", "good", 3), line("twice-mended", "good", 1)];
  assert.deepEqual(ids(rankCram(cards, lines, NOW)), ["twice-mended", "once-hard"]);
});
