/**
 * GPA arithmetic over a person's courses. Pure functions: no database, no model, no
 * React, so "what do I need to reach 3.50" is checkable rather than trusted.
 *
 * A course's grade is the official letter the person recorded. It is never worked out
 * from the marks, because many universities curve, so a percentage does not decide a
 * letter.
 */

import { maxPoints, normaliseLetter, type GradeScale } from "@/lib/gpa-scale";

export type GpaCourse = {
  id: string;
  code: string;
  title: string;
  term: string;
  credits: number | null;
  finalGrade: string | null;
};

export type OpenCourse = GpaCourse & { credits: number };

export type NotCountedReason = "credits-missing" | "letter-not-in-scale";

export type GpaSummary = {
  /** Credits and quality points of the courses that count. */
  credits: number;
  qualityPoints: number;
  /** Null until something counts. */
  cgpa: number | null;
  terms: { term: string; credits: number; gpa: number }[];
  /** Courses with credits and no letter yet. */
  open: OpenCourse[];
  openCredits: number;
  notCounted: { course: GpaCourse; reason: NotCountedReason }[];
};

/** The most credits one course can be worth. */
export const MAX_CREDITS = 30;

const EPSILON = 1e-9;

const hasCredits = (credits: number | null): credits is number =>
  credits !== null && credits > 0;

const isBlank = (letter: string | null): boolean => letter === null || letter.trim() === "";

function pointsFor(letter: string | null, scale: GradeScale): number | null {
  if (letter === null) return null;
  const normalised = normaliseLetter(letter);
  if (normalised === null) return null;
  return scale.find((entry) => entry.letter === normalised)?.points ?? null;
}

const SEASON_RANK: Record<string, number> = { spring: 1, summer: 2, fall: 3, autumn: 3 };

function termKey(term: string): number | null {
  const match = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(term);
  const rank = match ? SEASON_RANK[match[1].toLowerCase()] : undefined;
  return match && rank !== undefined ? Number(match[2]) * 10 + rank : null;
}

/** Oldest first: "Season YYYY" by year then Spring, Summer, Fall; any other label after, A to Z. */
export function compareTerms(a: string, b: string): number {
  const keyA = termKey(a);
  const keyB = termKey(b);
  if (keyA !== null && keyB !== null) {
    return keyA - keyB || (a < b ? -1 : a > b ? 1 : 0);
  }
  if (keyA !== null) return -1;
  if (keyB !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sorts every course into one of three places. With credits missing or 0 it is not
 * counted. With credits and no letter it is open. With a letter in the scale it counts;
 * with any other letter (a pass/fail grade, say) it is left out, never counted as zero.
 */
export function summariseGpa(courses: GpaCourse[], scale: GradeScale): GpaSummary {
  let credits = 0;
  let qualityPoints = 0;
  const byTerm = new Map<string, { credits: number; qualityPoints: number }>();
  const open: OpenCourse[] = [];
  const notCounted: GpaSummary["notCounted"] = [];

  for (const course of courses) {
    if (!hasCredits(course.credits)) {
      notCounted.push({ course, reason: "credits-missing" });
      continue;
    }
    if (isBlank(course.finalGrade)) {
      open.push({ ...course, credits: course.credits });
      continue;
    }
    const points = pointsFor(course.finalGrade, scale);
    if (points === null) {
      notCounted.push({ course, reason: "letter-not-in-scale" });
      continue;
    }
    credits += course.credits;
    qualityPoints += course.credits * points;
    const term = byTerm.get(course.term) ?? { credits: 0, qualityPoints: 0 };
    term.credits += course.credits;
    term.qualityPoints += course.credits * points;
    byTerm.set(course.term, term);
  }

  return {
    credits,
    qualityPoints,
    cgpa: credits > 0 ? qualityPoints / credits : null,
    terms: [...byTerm.entries()]
      .sort(([a], [b]) => compareTerms(a, b))
      .map(([term, sums]) => ({
        term,
        credits: sums.credits,
        gpa: sums.qualityPoints / sums.credits,
      })),
    open,
    openCredits: open.reduce((sum, course) => sum + course.credits, 0),
    notCounted,
  };
}

/**
 * The cumulative GPA if the open courses finish on the expected letters. An open
 * course with no valid expected letter is left out rather than guessed.
 */
export function projectCgpa(
  summary: GpaSummary,
  expected: Record<string, string>,
  scale: GradeScale,
): { cgpa: number | null; expectedAverage: number | null; credits: number } {
  let openCredits = 0;
  let openPoints = 0;
  for (const course of summary.open) {
    const points = pointsFor(expected[course.id] ?? null, scale);
    if (points === null) continue;
    openCredits += course.credits;
    openPoints += course.credits * points;
  }
  const total = summary.credits + openCredits;
  return {
    cgpa: total > 0 ? (summary.qualityPoints + openPoints) / total : null,
    expectedAverage: openCredits > 0 ? openPoints / openCredits : null,
    credits: total,
  };
}

export type NeededAverage =
  | { kind: "achieved"; worst: number }
  | { kind: "impossible"; best: number; short: number }
  | { kind: "needed"; points: number; lower: string | null; upper: string; exact: boolean }
  | { kind: "no-credits" };

/**
 * The average, in points, the open credits must reach to finish on `target`. Three
 * answers worth telling apart, as in `neededForTarget` in lib/grades.ts: already safe
 * even on the lowest grade, out of reach even on the highest, or a number between.
 */
export function neededAverage(
  summary: GpaSummary,
  target: number,
  scale: GradeScale,
): NeededAverage {
  const total = summary.credits + summary.openCredits;
  if (total <= 0) return { kind: "no-credits" };

  const worst = summary.qualityPoints / total;
  const best = (summary.qualityPoints + summary.openCredits * maxPoints(scale)) / total;
  if (worst >= target - EPSILON) return { kind: "achieved", worst };
  if (best < target - EPSILON) return { kind: "impossible", best, short: target - best };

  // Neither safe nor out of reach, so there are open credits to carry the difference.
  const points = (target * total - summary.qualityPoints) / summary.openCredits;
  const ascending = [...scale].sort((a, b) => a.points - b.points);
  const upper = ascending.find((entry) => entry.points >= points - EPSILON) ?? ascending[ascending.length - 1];
  const lower = [...ascending].reverse().find((entry) => entry.points < points - EPSILON) ?? null;
  return {
    kind: "needed",
    points,
    lower: lower?.letter ?? null,
    upper: upper.letter,
    exact: Math.abs(upper.points - points) < EPSILON,
  };
}

/** The letter an open course starts on in the what-if: the one closest to the GPA so far, ties going up. */
export function defaultExpectedLetter(scale: GradeScale, cgpa: number | null): string {
  const aim = cgpa ?? maxPoints(scale) * 0.75;
  const descending = [...scale].sort((a, b) => b.points - a.points);
  let best = descending[0];
  for (const entry of descending) {
    if (Math.abs(entry.points - aim) < Math.abs(best.points - aim) - EPSILON) best = entry;
  }
  return best.letter;
}

export type CourseEffect =
  | { kind: "counted"; qualityPoints: number; before: number | null; after: number }
  | { kind: "no-letter" }
  | { kind: "no-credits" }
  | { kind: "not-in-scale"; letter: string };

/** What giving one course these credits and this letter does to the GPA, `base` being every other counted course. */
export function courseEffect(
  base: { credits: number; qualityPoints: number },
  credits: number | null,
  letter: string | null,
  scale: GradeScale,
): CourseEffect {
  if (!hasCredits(credits)) return { kind: "no-credits" };
  if (letter === null || isBlank(letter)) return { kind: "no-letter" };

  const points = pointsFor(letter, scale);
  if (points === null) {
    return { kind: "not-in-scale", letter: normaliseLetter(letter) ?? letter.trim().toUpperCase() };
  }
  const qualityPoints = credits * points;
  return {
    kind: "counted",
    qualityPoints,
    before: base.credits > 0 ? base.qualityPoints / base.credits : null,
    after: (base.qualityPoints + qualityPoints) / (base.credits + credits),
  };
}

export type Badge = { text: string; tone: "neutral" | "accent" | "warn" | "ok" };

/** The chips on a course card: its credits, and where the course stands. */
export function courseBadges(course: GpaCourse, scale: GradeScale): Badge[] {
  if (!hasCredits(course.credits)) return [{ text: "Credits not set", tone: "warn" }];

  const credits: Badge = {
    text: `${course.credits} ${course.credits === 1 ? "credit" : "credits"}`,
    tone: "neutral",
  };
  if (isBlank(course.finalGrade)) return [credits, { text: "In progress", tone: "accent" }];

  const points = pointsFor(course.finalGrade, scale);
  const letter = normaliseLetter(course.finalGrade ?? "") ?? (course.finalGrade ?? "").trim().toUpperCase();
  return points === null
    ? [credits, { text: `${letter} is not in your scale`, tone: "warn" }]
    : [credits, { text: `${letter} · ${points.toFixed(1)}`, tone: "ok" }];
}

/** A GPA to two places, or a dash when there is none. */
export function formatGpa(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}
