// Weak spots (ROADMAP item 42): the cards a person keeps failing, picked from the review log that already exists (one line per grade, item 39).
// Pure. Nothing here schedules anything: SM-2 still decides when a card is due; this only names the ones that keep coming back wrong.

export const WEAK_MIN_FAILS = 2;
export const WEAK_WINDOW_DAYS = 30;
/** How many good or easy answers in a row, the latest ones, count as having mended a card. */
const MENDED_RUN = 2;

export type ReviewLine = { cardId: string | null; grade: string | null; reviewedAt: Date };
export type WeakCard = { cardId: string; fails: number; lastFailed: Date };

export function windowStart(now: Date): Date {
  return new Date(now.getTime() - WEAK_WINDOW_DAYS * 86_400_000);
}

/**
 * The weak cards among these review lines, worst first. A card is weak when it was graded "again" at least twice within the last 30 days and
 * has not been mended since: its latest two graded answers are not both "good" or "easy" (so one lucky answer does not clear it, and "hard"
 * does not either). Lines with no card or no grade (cards that existed before the log kept grades) count for nothing. Order: most failures,
 * then the most recent failure, then the card id, so the same log always gives the same list.
 */
export function rankWeak(lines: ReviewLine[], now: Date): WeakCard[] {
  const since = windowStart(now).getTime();
  const byCard = new Map<string, { grade: string; at: number }[]>();
  for (const line of lines) {
    if (line.cardId === null || line.grade === null) continue;
    const at = line.reviewedAt.getTime();
    if (at < since || at > now.getTime()) continue;
    const list = byCard.get(line.cardId);
    if (list) list.push({ grade: line.grade, at });
    else byCard.set(line.cardId, [{ grade: line.grade, at }]);
  }

  const weak: WeakCard[] = [];
  for (const [cardId, list] of byCard) {
    const fails = list.filter((entry) => entry.grade === "again");
    if (fails.length < WEAK_MIN_FAILS) continue;
    list.sort((a, b) => b.at - a.at);
    const latest = list.slice(0, MENDED_RUN);
    const mended = latest.length === MENDED_RUN && latest.every((entry) => entry.grade === "good" || entry.grade === "easy");
    if (mended) continue;
    weak.push({ cardId, fails: fails.length, lastFailed: new Date(fails.reduce((latest, entry) => Math.max(latest, entry.at), 0)) });
  }
  return weak.sort((a, b) => b.fails - a.fails || b.lastFailed.getTime() - a.lastFailed.getTime() || (a.cardId < b.cardId ? -1 : 1));
}
