import "server-only";
import { prisma } from "@/lib/prisma";
import { tasksPerCourse, tasksPerGoal } from "@/lib/weekly-review";

/**
 * The weekly review (ROADMAP item 31): plain queries over the caller's own rows, and nothing is written. No model
 * is involved; the page says what happened, in numbers and titles.
 */

export type WeeklyReview = {
  from: Date;
  to: Date;
  completed: { id: string; title: string; completedAt: Date }[];
  slipped: { id: string; title: string; dueDate: Date }[];
  notesWritten: { id: string; title: string; updatedAt: Date }[];
  eventsAttended: number;
  cardsReviewed: number;
  upcoming: { id: string; title: string; dueDate: Date }[];
  goalsMoved: { id: string; title: string; progress: number; doneTasks: number }[];
  coursesMoved: { id: string; code: string; title: string; doneTasks: number }[];
  assessmentsDue: { id: string; title: string; dueDate: Date; courseId: string; courseCode: string }[];
};

/** Midnight seven days ago, so the window is whole days rather than a rolling
 *  168 hours that cuts a day in half. */
export function reviewWindow(now: Date = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export async function buildWeeklyReview(
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyReview> {
  const { from, to } = reviewWindow(now);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const [completed, slipped, notesWritten, eventsAttended, cardsReviewed, upcoming, finishedThisWeek, assessments] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          userId,
          deletedAt: null,
          status: "done",
          completedAt: { gte: from, lte: to },
        },
        select: { id: true, title: true, completedAt: true },
        orderBy: { completedAt: "desc" },
      }),
      // Still open, and its due date has already passed — the week's misses.
      prisma.task.findMany({
        where: {
          userId,
          deletedAt: null,
          status: { not: "done" },
          dueDate: { lt: startOfToday, gte: from },
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
      }),
      prisma.note.findMany({
        where: { userId, deletedAt: null, updatedAt: { gte: from, lte: to } },
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
      prisma.event.count({
        where: { userId, startTime: { gte: from, lte: to } },
      }),
      prisma.flashcard.count({
        where: { userId, lastReviewed: { gte: from, lte: to } },
      }),
      prisma.task.findMany({
        where: {
          userId,
          deletedAt: null,
          status: { not: "done" },
          dueDate: { gte: startOfToday, lte: nextWeek },
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
      }),
      // Finished this week, with the goal a project gives it when the project is still live.
      prisma.task.findMany({
        where: {
          userId,
          deletedAt: null,
          status: "done",
          completedAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          goalId: true,
          courseId: true,
          project: { select: { goalId: true, deletedAt: true } },
        },
      }),
      // Unscored assessments due in the next week, on live courses. A scored one is not "due".
      prisma.assessment.findMany({
        where: {
          userId,
          score: null,
          dueDate: { gte: startOfToday, lte: nextWeek },
          course: { deletedAt: null },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          courseId: true,
          course: { select: { code: true } },
        },
        orderBy: { dueDate: "asc" },
      }),
    ]);

  const goalCounts = tasksPerGoal(
    finishedThisWeek.map((task) => ({
      id: task.id,
      goalId: task.goalId,
      projectGoalId: task.project && !task.project.deletedAt ? task.project.goalId : null,
    })),
  );
  const courseCounts = tasksPerCourse(finishedThisWeek);
  const [goals, courses] = await Promise.all([
    prisma.goal.findMany({
      where: { userId, deletedAt: null, id: { in: [...goalCounts.keys()] } },
      select: { id: true, title: true, progress: true },
    }),
    prisma.course.findMany({
      where: { userId, deletedAt: null, id: { in: [...courseCounts.keys()] } },
      select: { id: true, code: true, title: true },
    }),
  ]);

  return {
    from,
    to,
    completed: completed.flatMap((task) =>
      task.completedAt ? [{ ...task, completedAt: task.completedAt }] : [],
    ),
    slipped: slipped.flatMap((task) =>
      task.dueDate ? [{ ...task, dueDate: task.dueDate }] : [],
    ),
    notesWritten,
    eventsAttended,
    cardsReviewed,
    upcoming: upcoming.flatMap((task) =>
      task.dueDate ? [{ ...task, dueDate: task.dueDate }] : [],
    ),
    goalsMoved: goals
      .map((goal) => ({ id: goal.id, title: goal.title, progress: goal.progress, doneTasks: goalCounts.get(goal.id) ?? 0 }))
      .sort((a, b) => b.doneTasks - a.doneTasks),
    coursesMoved: courses
      .map((course) => ({ id: course.id, code: course.code, title: course.title, doneTasks: courseCounts.get(course.id) ?? 0 }))
      .sort((a, b) => b.doneTasks - a.doneTasks),
    assessmentsDue: assessments.map((assessment) => ({
      id: assessment.id,
      title: assessment.title,
      dueDate: assessment.dueDate as Date,
      courseId: assessment.courseId,
      courseCode: assessment.course.code,
    })),
  };
}
