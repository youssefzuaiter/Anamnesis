// Pure study-time maths. No model, no database, no React.
//
// Two kinds of recorded time exist and they are never added together: *writing* (how long a note was
// being typed, from the opt-in focus tracker) and *timer* (how long the study timer ran on a task).
// They measure different things, so the page shows them side by side. Everything here describes what
// was recorded; none of it judges the person.

export type StudyRange = "7" | "28" | "all";

export const DEFAULT_RANGE: StudyRange = "28";

const DAY_MS = 86_400_000;

/** Only the three exact strings; a query string is user input, so arrays, numbers and look-alikes are not trusted. */
export function parseRange(raw: unknown): StudyRange {
  return raw === "7" || raw === "28" || raw === "all" ? raw : DEFAULT_RANGE;
}

/**
 * Where a window starts: exactly N×24 hours before `now`. Rolling rather than "N calendar days", so
 * there is no timezone or clock-change question to get wrong. Null means no lower bound.
 */
export function rangeStart(range: StudyRange, now: Date): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - Number(range) * DAY_MS);
}

export function rangeHeading(range: StudyRange): string {
  return range === "all" ? "all recorded" : `last ${range} days`;
}

/** Whole minutes, then hours and minutes: `0 m`, `40 m`, `2 h`, `4 h 10 m`. Anything unusable is `0 m`. */
export function formatDuration(seconds: number): string {
  const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : 0;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

export function sessionsLabel(count: number): string {
  return `${count} session${count === 1 ? "" : "s"}`;
}

export type Measure = { seconds: number; sessions: number };

/** One row of a database `groupBy`: what was recorded for one course (or none). */
export type Grouped = { courseId: string | null; seconds: number; sessions: number };

/**
 * Sums rows by course. A course that is not in `liveCourseIds` (in the trash, or deleted) is folded into
 * `null`, so a total never loses time: it moves to "No course", and moves back if the course is restored.
 */
export function foldByCourse(
  rows: Grouped[],
  liveCourseIds: ReadonlySet<string>,
): Map<string | null, Measure> {
  const folded = new Map<string | null, Measure>();
  for (const row of rows) {
    const key = row.courseId !== null && liveCourseIds.has(row.courseId) ? row.courseId : null;
    const current = folded.get(key) ?? { seconds: 0, sessions: 0 };
    folded.set(key, {
      seconds: current.seconds + row.seconds,
      sessions: current.sessions + row.sessions,
    });
  }
  return folded;
}

export type CourseLine = {
  courseId: string | null;
  code: string | null;
  title: string | null;
  writing: Measure;
  timer: Measure;
};

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * The lines of the By course list: only courses that have recorded time, by course code (numbers inside
 * a code compared as numbers) and never ranked by time, with "No course" last. `scaleSeconds` is the
 * largest single value, the one scale both measures' bars share.
 */
export function buildCourseLines(
  courses: { id: string; code: string; title: string }[],
  writing: Grouped[],
  timer: Grouped[],
): { lines: CourseLine[]; scaleSeconds: number } {
  const live = new Set(courses.map((course) => course.id));
  const writingBy = foldByCourse(writing, live);
  const timerBy = foldByCourse(timer, live);

  const lineFor = (course: { id: string; code: string; title: string } | null): CourseLine => {
    const key = course?.id ?? null;
    return {
      courseId: key,
      code: course?.code ?? null,
      title: course?.title ?? null,
      writing: writingBy.get(key) ?? { seconds: 0, sessions: 0 },
      timer: timerBy.get(key) ?? { seconds: 0, sessions: 0 },
    };
  };

  const ordered = [...courses].sort((a, b) => byName(a.code, b.code) || byName(a.title, b.title));
  const lines = [...ordered, null]
    .map(lineFor)
    .filter((line) => line.writing.sessions + line.timer.sessions > 0 || line.writing.seconds + line.timer.seconds > 0);

  const scaleSeconds = Math.max(0, ...lines.flatMap((line) => [line.writing.seconds, line.timer.seconds]));
  return { lines, scaleSeconds };
}

/**
 * How wide a bar is, as a percentage of its track. Real time is never invisible (at least 2) and a
 * value past the scale stops at the track's end; anything unusable is 0, never NaN.
 */
export function barPercent(seconds: number, scaleSeconds: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(scaleSeconds) || seconds <= 0 || scaleSeconds <= 0) {
    return 0;
  }
  const share = Math.round((seconds / scaleSeconds) * 1000) / 10;
  return Math.min(100, Math.max(2, share));
}

/** A measure is shown while its switch is on, and afterwards for as long as there is history to show. */
export function measuresShown(input: {
  writingOn: boolean;
  timerOn: boolean;
  writingSessions: number;
  timerSessions: number;
}): { writing: boolean; timer: boolean } {
  return {
    writing: input.writingOn || input.writingSessions > 0,
    timer: input.timerOn || input.timerSessions > 0,
  };
}

export type RecentEntry = {
  kind: "writing" | "timer";
  id: string;
  at: Date;
  seconds: number;
  courseId: string | null;
  wpm: number | null;
  load: string | null;
};

/** The newest `take` sessions of both kinds, newest first. Does not reorder or consume its inputs. */
export function mergeRecent(writing: RecentEntry[], timer: RecentEntry[], take: number): RecentEntry[] {
  if (!(take > 0)) return [];
  return [...writing, ...timer]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, take);
}

/**
 * The seconds a timer has run that have not been saved yet: what ran (`total − remaining`) minus
 * what an earlier save already took. Saving this and then
 * remembering it as `savedSeconds` is what stops a finish followed by a reset from counting twice.
 */
export function unsavedTimerSeconds(input: {
  totalSeconds: number;
  remainingSeconds: number;
  savedSeconds: number;
}): number {
  const { totalSeconds, remainingSeconds, savedSeconds } = input;
  if (![totalSeconds, remainingSeconds, savedSeconds].every(Number.isFinite) || totalSeconds <= 0) {
    return 0;
  }
  // A remaining time above the total cannot make a negative run: the last `max` turns it into zero.
  const ran = Math.floor(totalSeconds - Math.max(remainingSeconds, 0));
  return Math.max(0, ran - Math.floor(Math.max(savedSeconds, 0)));
}
