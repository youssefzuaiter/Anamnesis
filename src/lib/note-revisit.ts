/**
 * The one older note the dashboard offers back (ROADMAP item 32). Pure: it takes the candidate notes and today's
 * date, and never reads a clock itself, so the rules are unit-tested. Only `updatedAt` is used, as the roadmap asks.
 */

export const REVISIT_AFTER_DAYS = 30;

export type RevisitCandidate = { id: string; title: string; updatedAt: Date };
export type Revisit =
  | { note: RevisitCandidate; reason: "onThisDay"; yearsAgo: number }
  | { note: RevisitCandidate; reason: "untouched"; daysAgo: number };

const DAY_MS = 86_400_000;

/** Whole local days between a moment and today's date, counted from local midnight. */
function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/**
 * A note from this same month and day in an earlier year, if there is one (the newest of them); otherwise a note
 * not changed for thirty days, chosen so that it stays the same for the whole day and moves on the next one.
 * 29 February matches only 29 February, so it is never "on this day" for 28 February.
 */
export function pickRevisit(candidates: RevisitCandidate[], now: Date): Revisit | null {
  const anniversaries = candidates
    .filter((note) => note.updatedAt.getFullYear() < now.getFullYear()
      && note.updatedAt.getMonth() === now.getMonth()
      && note.updatedAt.getDate() === now.getDate())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  if (anniversaries.length > 0) {
    const note = anniversaries[0];
    return { note, reason: "onThisDay", yearsAgo: now.getFullYear() - note.updatedAt.getFullYear() };
  }

  const cutoff = now.getTime() - REVISIT_AFTER_DAYS * DAY_MS;
  const untouched = candidates
    .filter((note) => note.updatedAt.getTime() <= cutoff)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (untouched.length === 0) return null;
  const note = untouched[((localDayNumber(now) % untouched.length) + untouched.length) % untouched.length];
  return { note, reason: "untouched", daysAgo: Math.floor((now.getTime() - note.updatedAt.getTime()) / DAY_MS) };
}
