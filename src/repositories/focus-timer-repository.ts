import "server-only";
import { prisma } from "@/lib/prisma";
import type { TimerState } from "@/lib/focus-timer";

/*
 * The one focus timer an account can have (ROADMAP item 40). Every read and write is scoped by `userId`. A change is a compare-and-set on the
 * row's `updatedAt`, so two things that notice the same moment (a tab, the server's own timeout, the minute tick) cannot both act on it: the
 * second finds the row changed and does nothing. The study time a change saves is written in the same transaction, so a session is saved
 * exactly when the row says it was.
 */

export type TimerRow = TimerState & { id: string; updatedAt: Date };

type Stored = Awaited<ReturnType<typeof prisma.activeTimer.findFirst>>;

function toRow(row: NonNullable<Stored>): TimerRow {
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    taskId: row.taskId,
    phase: row.phase as TimerState["phase"],
    focusMinutes: row.focusMinutes,
    phaseSeconds: row.phaseSeconds,
    endsAt: row.endsAt,
    pausedRemaining: row.pausedRemaining,
    finishedAt: row.finishedAt,
    completedFocus: row.completedFocus,
    savedSeconds: row.savedSeconds,
    notifyPhone: row.notifyPhone,
  };
}

const data = (state: TimerState) => ({
  taskId: state.taskId,
  phase: state.phase,
  focusMinutes: state.focusMinutes,
  phaseSeconds: state.phaseSeconds,
  endsAt: state.endsAt,
  pausedRemaining: state.pausedRemaining,
  finishedAt: state.finishedAt,
  completedFocus: state.completedFocus,
  savedSeconds: state.savedSeconds,
  notifyPhone: state.notifyPhone,
});

export async function getTimer(userId: string): Promise<TimerRow | null> {
  const row = await prisma.activeTimer.findUnique({ where: { userId } });
  return row ? toRow(row) : null;
}

/** Account ids whose timer has reached its end, for the minute tick that finishes timers nobody is watching. */
export async function listDueUsers(now: Date): Promise<string[]> {
  const rows = await prisma.activeTimer.findMany({ where: { endsAt: { lte: now } }, select: { userId: true }, take: 500 });
  return rows.map((row) => row.userId);
}

/**
 * Moves the account's timer from `from` (null: there is none) to `to` (null: delete it), and writes `study` in the same transaction.
 * False when someone else changed it first (or made it): the caller reads again.
 */
export async function change(
  userId: string,
  from: TimerRow | null,
  to: TimerState | null,
  study: { seconds: number; courseId: string | null } | null,
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      let ok: boolean;
      if (from === null) {
        if (to === null) return true;
        await tx.activeTimer.create({ data: { userId, ...data(to) } });
        ok = true;
      } else if (to === null) {
        ok = (await tx.activeTimer.deleteMany({ where: { id: from.id, userId, updatedAt: from.updatedAt } })).count > 0;
      } else {
        ok = (await tx.activeTimer.updateMany({ where: { id: from.id, userId, updatedAt: from.updatedAt }, data: data(to) })).count > 0;
      }
      if (ok && study) await tx.studySession.create({ data: { userId, seconds: study.seconds, courseId: study.courseId } });
      return ok;
    });
  } catch (error) {
    // Two requests starting a timer at once: the unique key lets one in, and the other reads again.
    if ((error as { code?: string })?.code === "P2002") return false;
    throw error;
  }
}

/** The title and course of a live task of the caller's, or null: the browser names a task, never a course. */
export async function findTask(userId: string, taskId: string): Promise<{ title: string; courseId: string | null; courseCode: string | null } | null> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId, deletedAt: null },
    select: { title: true, courseId: true, course: { select: { code: true, deletedAt: true } } },
  });
  if (!task) return null;
  return { title: task.title, courseId: task.courseId, courseCode: task.course && task.course.deletedAt === null ? task.course.code : null };
}

/**
 * The course a task's time belongs to, even for a task that has since been deleted. A course in the trash is kept (the time comes back with it
 * if the course is restored); a task or course gone for good leaves none.
 */
export async function courseOfTask(userId: string, taskId: string): Promise<string | null> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId }, select: { courseId: true } });
  return task?.courseId ?? null;
}
