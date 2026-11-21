// Cram mode (ROADMAP item 48): one course's cards in the order a person should meet them before an exam, whether or not they are due.
// Pure, and it only orders: grading a card is an ordinary review and SM-2 still decides when it is next due.
import { rankWeak, windowStart, type ReviewLine } from "@/lib/weak-spots";

/** A cram session is at most this many cards; opening Cram again rebuilds the order from the latest answers. */
export const CRAM_SESSION = 50;

export type CramCard = { id: string; easeFactor: number; lastReviewed: Date | null; dueAt: Date };
export type CramTier = "weak" | "failed" | "new" | "rest";
export type CramEntry = { id: string; tier: CramTier; fails: number };

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Weak cards (the weak-spots rule, item 42) by most failures; then cards failed in the last 30 days but not weak; then cards never reviewed,
 * longest waiting first; then the rest, lowest ease (hardest) first. Ties end on the id, so the same data always gives the same order.
 */
export function rankCram(cards: CramCard[], lines: ReviewLine[], now: Date): CramEntry[] {
  const since = windowStart(now).getTime();
  const fails = new Map<string, number>();
  for (const l of lines) {
    if (l.cardId === null || l.grade !== "again") continue;
    const at = l.reviewedAt.getTime();
    if (at < since || at > now.getTime()) continue;
    fails.set(l.cardId, (fails.get(l.cardId) ?? 0) + 1);
  }
  const weakOrder = new Map(rankWeak(lines, now).map((w, i) => [w.cardId, i]));

  const weak: (CramCard & { rank: number })[] = [];
  const failed: CramCard[] = [];
  const fresh: CramCard[] = [];
  const rest: CramCard[] = [];
  for (const c of cards) {
    const rank = weakOrder.get(c.id);
    if (rank !== undefined) weak.push({ ...c, rank });
    else if ((fails.get(c.id) ?? 0) > 0) failed.push(c);
    else if (c.lastReviewed === null) fresh.push(c);
    else rest.push(c);
  }
  const f = (c: CramCard) => fails.get(c.id) ?? 0;
  weak.sort((a, b) => a.rank - b.rank || byId(a, b));
  failed.sort((a, b) => f(b) - f(a) || a.easeFactor - b.easeFactor || byId(a, b));
  fresh.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || byId(a, b));
  rest.sort((a, b) => a.easeFactor - b.easeFactor || a.dueAt.getTime() - b.dueAt.getTime() || byId(a, b));

  return [
    ...weak.map((c) => ({ id: c.id, tier: "weak" as const, fails: f(c) })),
    ...failed.map((c) => ({ id: c.id, tier: "failed" as const, fails: f(c) })),
    ...fresh.map((c) => ({ id: c.id, tier: "new" as const, fails: 0 })),
    ...rest.map((c) => ({ id: c.id, tier: "rest" as const, fails: 0 })),
  ];
}

export function cramReason(entry: CramEntry): string | null {
  if (entry.tier === "weak") return `Weak: failed ${entry.fails} times this month`;
  if (entry.tier === "failed") return entry.fails === 1 ? "Failed once this month" : `Failed ${entry.fails} times this month`;
  if (entry.tier === "new") return "Never reviewed";
  return null;
}

export function cramCounts(entries: CramEntry[]): { weak: number; failed: number; fresh: number; rest: number } {
  const counts = { weak: 0, failed: 0, fresh: 0, rest: 0 };
  for (const e of entries) counts[e.tier === "new" ? "fresh" : e.tier] += 1;
  return counts;
}
