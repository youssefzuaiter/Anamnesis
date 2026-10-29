/**
 * Where review sessions for an assessment go: spread evenly over the days
 * before it, into the free gaps of the calendar.
 *
 * Pure arithmetic like `lib/day-planner.ts`, which it borrows the free-gap
 * rule from. There is no model here: which day a session lands on is a sum,
 * and a 3B model is no better at that than a loop.
 */

import { dayBounds } from "@/lib/day";
import { GAP_MINUTES, freeIntervals, type Busy } from "@/lib/day-planner";
import { dateLabel } from "@/lib/note-templates";

/** Every session is tagged with this, so a person can find them all. */
export const EXAM_PREP_TAG = "exam-prep";

/** The choices on the card. A chosen number, not a derived one: the app has no basis for how long anyone should study. */
export const PREP_HOURS = [3, 6, 10] as const;
export const SESSION_MINUTES = [45, 60, 90] as const;
export const DEFAULT_PREP_HOURS = 6;
export const DEFAULT_SESSION_MINUTES = 60;

/** Sessions are placed no further back than this many days before the assessment. */
export const HORIZON_DAYS = 21;
/** A ceiling on one plan, so a mistaken request cannot make hundreds of tasks. */
export const MAX_SESSIONS = 40;
const MAX_PER_DAY = 2;
const TITLE_NAME_MAX = 150;

export type PrepSession = { start: Date; end: Date };

export type PrepPlan = {
  /** Earliest first. */
  sessions: PrepSession[];
  /** How many days were available: tomorrow up to the day before the assessment. */
  windowDays: number;
  /** Window days with no free gap as long as a session, as local midnights, earliest first. */
  noGapDays: Date[];
};

/** How many sessions the chosen review time still needs, given what is already planned. */
export function sessionsNeeded(
  hours: number,
  sessionMinutes: number,
  plannedMinutes: number,
): number {
  const left = hours * 60 - plannedMinutes;
  if (left <= 0) return 0;
  return Math.min(MAX_SESSIONS, Math.ceil(left / sessionMinutes));
}

type Slot = { cursor: Date; end: Date };

/**
 * Places `sessions` sessions of `sessionMinutes` before `dueDate`.
 *
 * Never today and never on the day itself: the window is tomorrow up to the
 * day before. First pass spreads one session per day, evenly back from the day
 * before the assessment, taking the nearest free day when the target has no
 * room. If there are more sessions than days, a second pass stacks at most two
 * a day. A session is never shortened to fit, so a plan can come back short.
 */
export function planExamPrep(input: {
  dueDate: Date;
  now: Date;
  sessions: number;
  sessionMinutes: number;
  busy: Busy[];
}): PrepPlan {
  const { dueDate, now, sessions, sessionMinutes, busy } = input;
  const examDay = dayBounds(dueDate).from;
  const firstDay = dayBounds(now).to;

  // days[0] is the day before the assessment; each next one is a day earlier.
  const days: Date[] = [];
  const walker = new Date(examDay);
  while (days.length < HORIZON_DAYS) {
    walker.setDate(walker.getDate() - 1);
    if (walker < firstDay) break;
    days.push(new Date(walker));
  }
  if (days.length === 0 || sessions <= 0) {
    return { sessions: [], windowDays: days.length, noGapDays: [] };
  }

  const length = sessionMinutes * 60_000;
  const slots: Slot[][] = days.map((day) =>
    freeIntervals(day, busy, now).map((gap) => ({
      cursor: new Date(gap.start),
      end: gap.end,
    })),
  );
  const noGapDays = days
    .filter((_, i) => !slots[i].some((slot) => slot.end.getTime() - slot.cursor.getTime() >= length))
    .reverse();

  /** The first gap on day `i` with room, or null. Moves the gap's cursor past the session and a breather. */
  function place(i: number): PrepSession | null {
    for (const slot of slots[i]) {
      if (slot.end.getTime() - slot.cursor.getTime() < length) continue;
      const start = new Date(slot.cursor);
      const end = new Date(start.getTime() + length);
      slot.cursor = new Date(end.getTime() + GAP_MINUTES * 60_000);
      return { start, end };
    }
    return null;
  }

  const placed: PrepSession[] = [];
  const perDay = days.map(() => 0);

  // Pass 1: one a day, evenly back from the day before.
  const spread = Math.min(sessions, days.length);
  for (let k = 0; k < spread; k++) {
    const target = spread === 1 ? 0 : Math.round((k * (days.length - 1)) / (spread - 1));
    const nearest = days
      .map((_, i) => i)
      .filter((i) => perDay[i] === 0)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    for (const i of nearest) {
      const session = place(i);
      if (!session) continue;
      placed.push(session);
      perDay[i] += 1;
      break;
    }
  }

  // Pass 2: whatever is left stacks, closest to the assessment first.
  let remaining = sessions - placed.length;
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    for (let i = 0; i < days.length && remaining > 0; i++) {
      if (perDay[i] >= MAX_PER_DAY) continue;
      const session = place(i);
      if (!session) continue;
      placed.push(session);
      perDay[i] += 1;
      remaining -= 1;
      progress = true;
    }
  }

  placed.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { sessions: placed, windowDays: days.length, noGapDays };
}

/** `Review: Midterm (2 of 6)`. The assessment's name is cut so the title stays well under the 200-character limit. */
export function sessionTitle(assessment: string, index: number, total: number): string {
  return `Review: ${assessment.slice(0, TITLE_NAME_MAX)} (${index} of ${total})`;
}

/** Plain text for a session's description: what it is for, the notes to read and the cards waiting. */
export function sessionDescription(input: {
  assessment: string;
  courseCode: string;
  dueDate: Date;
  notes: string[];
  noteCount: number;
  dueCards: number;
}): string {
  const { assessment, courseCode, dueDate, notes, noteCount, dueCards } = input;
  const more = noteCount - notes.length;
  return [
    `Review session for ${assessment} (${courseCode}), ${dateLabel(dueDate)}.`,
    notes.length === 0
      ? "No notes in this course yet."
      : `Notes to go through: ${notes.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`,
    dueCards > 0
      ? `Start with the flashcards due for this course: ${dueCards}.`
      : "No flashcards are due right now.",
  ].join("\n");
}

/** Why a proposal may be empty: no day to plan into, everything already planned, or no gap long enough. */
export type PrepProblem = "none" | "no-window" | "fully-planned" | "nothing-fits";

/** What to say when the shortest session is not already the choice. */
function trySomething(sessionMinutes: number): string {
  return sessionMinutes > 45
    ? "Try 45-minute sessions, or free up some time and propose again."
    : "Free up some time and propose again.";
}

function listLabels(labels: string[]): string {
  return labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The words that go with a proposal. `message` explains one with nothing in it;
 * `shortfall` says how many fit when only some did, and names the days that had
 * no gap (up to three, then a count).
 */
export function prepNotices(input: {
  problem: PrepProblem;
  title: string;
  dueLabel: string;
  sessionMinutes: number;
  plannedCount: number;
  plannedHours: number;
  placed: number;
  requested: number;
  windowDays: number;
  noGapLabels: string[];
}): { message: string | null; shortfall: string | null } {
  const { problem, title, dueLabel, sessionMinutes, noGapLabels } = input;

  if (problem === "fully-planned") {
    return {
      message: `That is already planned: ${input.plannedCount} sessions (${input.plannedHours} h) are on your calendar for ${title}.`,
      shortfall: null,
    };
  }
  if (problem === "no-window") {
    return { message: `There is no whole day between tomorrow and ${dueLabel} to plan into.`, shortfall: null };
  }
  if (problem === "nothing-fits") {
    return {
      message: `No session of ${sessionMinutes} min fits before ${dueLabel}. ${trySomething(sessionMinutes)}`,
      shortfall: null,
    };
  }
  if (input.placed >= input.requested) return { message: null, shortfall: null };

  const gaps =
    noGapLabels.length === 0
      ? ""
      : noGapLabels.length <= 3
        ? `There is no free gap of ${sessionMinutes} min on ${listLabels(noGapLabels)}. `
        : `There is no free gap of ${sessionMinutes} min on ${noGapLabels.length} of the ${input.windowDays} days. `;
  return {
    message: null,
    shortfall: `Only ${input.placed} of ${input.requested} sessions fit before ${dueLabel}. ${gaps}${trySomething(sessionMinutes)}`,
  };
}
