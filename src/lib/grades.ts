/**
 * Course mark arithmetic. Pure functions over assessment rows — no database,
 * no model — so "what do I need on the final" is checkable rather than trusted.
 */

export type Assessed = {
  weight: number;
  score: number | null;
  maxScore: number;
};

export type GradeSummary = {
  /** Percentage points already banked, out of 100 for the whole course. */
  earned: number;
  /** Share of the course that has been marked so far. */
  gradedWeight: number;
  /** Share still to come. */
  remainingWeight: number;
  /** Mark so far, counting only what has been graded. Null before anything is. */
  currentAverage: number | null;
  /** Final mark if everything remaining were perfect. */
  bestPossible: number;
  /** Total weight declared, which need not be 100. */
  declaredWeight: number;
};

function ratio(item: Assessed): number {
  if (item.score === null) return 0;
  if (item.maxScore <= 0) return 0;
  // A score above the maximum is bonus marks, which are real; a negative one
  // is not, so only the floor is clamped.
  return Math.max(0, item.score / item.maxScore);
}

export function summarise(items: Assessed[]): GradeSummary {
  const declaredWeight = items.reduce((sum, item) => sum + item.weight, 0);

  const graded = items.filter((item) => item.score !== null);
  const gradedWeight = graded.reduce((sum, item) => sum + item.weight, 0);
  const earned = graded.reduce((sum, item) => sum + item.weight * ratio(item), 0);

  const remainingWeight = Math.max(0, declaredWeight - gradedWeight);

  return {
    earned,
    gradedWeight,
    remainingWeight,
    currentAverage: gradedWeight > 0 ? (earned / gradedWeight) * 100 : null,
    bestPossible: earned + remainingWeight,
    declaredWeight,
  };
}

export type Needed =
  | { kind: "achieved"; target: number }
  | { kind: "impossible"; target: number; short: number }
  | { kind: "needed"; target: number; percent: number };

/**
 * The average needed across everything still ungraded to finish on `target`.
 *
 * Three outcomes worth distinguishing, because "you need 104%" and "you already
 * have it" are both answers a single number would blur.
 */
export function neededForTarget(
  summary: GradeSummary,
  target: number,
): Needed {
  if (summary.earned >= target) return { kind: "achieved", target };

  if (summary.remainingWeight <= 0 || summary.bestPossible < target) {
    return { kind: "impossible", target, short: target - summary.bestPossible };
  }

  const percent = ((target - summary.earned) / summary.remainingWeight) * 100;
  return { kind: "needed", target, percent };
}

export type UpcomingAssessment = {
  title: string;
  dueDate: Date | null;
  score: number | null;
};

/**
 * The soonest assessment still worth preparing for. An assessment already
 * scored is not something to study for even if its due date happens to sit
 * in the future, and one with no due date at all has nothing to count down
 * to — both are excluded rather than sorted to the back.
 */
export function nextUngraded<T extends UpcomingAssessment>(
  items: T[],
  now: Date,
): (T & { dueDate: Date }) | null {
  const upcoming = items.filter(
    (item): item is T & { dueDate: Date } =>
      item.score === null && item.dueDate !== null && item.dueDate >= now,
  );
  if (upcoming.length === 0) return null;

  return upcoming.reduce((soonest, item) =>
    item.dueDate < soonest.dueDate ? item : soonest,
  );
}

/** "today"/"tomorrow"/"in N days" — counted in whole calendar days, not exact
 *  hours, the same whole-day convention task buckets use: a final at 23:59
 *  today should read "today", not "in 1 day" just because it's currently
 *  2pm. */
export function daysUntilLabel(dueDate: Date, now: Date): string {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round(
    (startOfDay(dueDate).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
