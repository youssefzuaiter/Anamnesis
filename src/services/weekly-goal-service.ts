import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { addDays, startOfDay, startOfWeek } from "@/lib/study-stats";
import {
  GOAL_HISTORY_WEEKS, GOAL_MEASURES, goalLabel, goalSchema, pastWeeks, progressOf, targetSchema, weekLabel, weeklyGoalCounts,
  type GoalMeasure, type Progress,
} from "@/lib/weekly-goals";
import * as repo from "@/repositories/weekly-goal-repository";
import * as statsRepository from "@/repositories/stats-repository";
import * as focusRepository from "@/repositories/focus-repository";

/*
 * Weekly goals (ROADMAP item 44): a standing target per measure, counted against the week we are in from what the app already records. Nothing about
 * a week is stored. The service checks every input with one schema, keeps one goal per measure, and reads activity only when there is a goal to
 * check (timestamps only, every query scoped by userId).
 */

const NOT_FOUND = "That goal does not exist.";
const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === "P2002";

export type GoalView = {
  id: string;
  measure: GoalMeasure;
  target: number;
  label: string;
  progress: Progress;
  past: { marks: boolean[]; reached: number; total: number };
};

export type WeeklyGoalsOverview = {
  goals: GoalView[];
  /** "Mon 16 – Sun 22 Nov". */
  week: string;
  /** Whether timer sessions are being remembered; study goals stay at zero without it. */
  recorderOn: boolean;
  /** The measures with no goal yet, in the order the form offers them. */
  available: GoalMeasure[];
};

function asMeasure(value: string): GoalMeasure | null {
  return (GOAL_MEASURES as readonly string[]).includes(value) ? (value as GoalMeasure) : null;
}

export async function getWeeklyGoals(userId: string, now: Date = new Date()): Promise<WeeklyGoalsOverview> {
  if (typeof userId !== "string" || userId === "") throw new Error("Weekly goals need an account.");
  const [rows, switches] = await Promise.all([repo.listGoals(userId), focusRepository.getSettings(userId)]);
  // A stored measure that is not one of the five (an older release, a hand edit) is not shown.
  const stored = rows.flatMap((row) => {
    const measure = asMeasure(row.measure);
    return measure ? [{ id: row.id, measure, target: row.target }] : [];
  });
  const week = weekLabel(startOfWeek(now));
  const used = new Set(stored.map((goal) => goal.measure));
  const available = GOAL_MEASURES.filter((measure) => !used.has(measure));
  if (stored.length === 0) return { goals: [], week, recorderOn: switches.timer, available };

  const since = addDays(startOfWeek(now), -7 * GOAL_HISTORY_WEEKS);
  const until = addDays(startOfDay(now), 1);
  const [tasks, cards, sessions, notes] = await Promise.all([
    statsRepository.listTaskCompletions(userId, since, until),
    statsRepository.listCardReviews(userId, since, until),
    statsRepository.listStudySessions(userId, since, until),
    statsRepository.listNoteCreations(userId, since, until),
  ]);
  const weeks = weeklyGoalCounts(
    {
      tasks: tasks.flatMap((row) => (row.completedAt ? [row.completedAt] : [])),
      cards: cards.map((row) => row.reviewedAt),
      sessions: sessions.map((row) => ({ at: row.recordedAt, seconds: row.seconds })),
      notes: notes.map((row) => row.createdAt),
    },
    now,
  );
  const current = weeks[weeks.length - 1];
  return {
    goals: stored.map((goal) => ({
      id: goal.id,
      measure: goal.measure,
      target: goal.target,
      label: goalLabel(goal.measure, goal.target),
      progress: progressOf(current[goal.measure], goal.target),
      past: pastWeeks(weeks, goal.measure, goal.target),
    })),
    week,
    recorderOn: switches.timer,
    available,
  };
}

/** Adds a goal. There is one per measure: asking for a second says so instead of changing the first. */
export async function createGoal(userId: string, input: unknown): Promise<{ id: string; measure: GoalMeasure; target: number }> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Choose what to count and a target.");
  try {
    const row = await repo.createGoal(userId, parsed.data);
    return { id: row.id, measure: parsed.data.measure, target: row.target };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("VALIDATION_ERROR", "You already have a weekly goal for that. Change its target instead.");
    throw error;
  }
}

export async function setGoalTarget(userId: string, id: string, target: unknown): Promise<void> {
  const parsed = targetSchema.safeParse(target);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "A target is a whole number from 1 to 999.");
  const found = z.uuid().safeParse(id).success && (await repo.setTarget(userId, id, parsed.data));
  if (!found) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND);
}

export async function removeGoal(userId: string, id: string): Promise<void> {
  const removed = z.uuid().safeParse(id).success && (await repo.deleteGoal(userId, id));
  if (!removed) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND);
}
