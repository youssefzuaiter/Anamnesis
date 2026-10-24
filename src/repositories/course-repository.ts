import "server-only";
import { prisma } from "@/lib/prisma";
import type {
  CourseModel as Course,
  AssessmentModel as Assessment,
} from "@/generated/prisma/models";

export type CourseInput = { code: string; title: string; term: string };

export type CourseSummary = Course & {
  counts: { notes: number; tasks: number; openTasks: number; events: number };
  assessments: Assessment[];
};

export async function listCourses(userId: string): Promise<CourseSummary[]> {
  const courses = await prisma.course.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ term: "desc" }, { code: "asc" }],
    include: {
      assessments: { orderBy: { createdAt: "asc" } },
      _count: {
        select: {
          notes: { where: { deletedAt: null } },
          events: true,
        },
      },
      tasks: { where: { deletedAt: null }, select: { status: true } },
    },
  });

  return courses.map(({ _count, tasks, ...course }) => ({
    ...course,
    counts: {
      notes: _count.notes,
      events: _count.events,
      tasks: tasks.length,
      openTasks: tasks.filter((task) => task.status !== "done").length,
    },
  }));
}

export async function getCourse(
  userId: string,
  courseId: string,
): Promise<CourseSummary | null> {
  const [course] = await listCourses(userId).then((all) =>
    all.filter((item) => item.id === courseId),
  );
  return course ?? null;
}

export type UpcomingAssessment = {
  id: string;
  title: string;
  dueDate: Date;
  course: { id: string; code: string; title: string };
};

/** The soonest assessment still to sit across every live course: the same
 *  rule as `nextUngraded` in lib/grades.ts (unscored, dated, not yet past),
 *  applied in the query so the dashboard does not load every course. */
export async function nextUpcomingAssessment(
  userId: string,
  now: Date,
): Promise<UpcomingAssessment | null> {
  const row = await prisma.assessment.findFirst({
    where: {
      userId,
      score: null,
      dueDate: { gte: now },
      course: { userId, deletedAt: null },
    },
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      title: true,
      dueDate: true,
      course: { select: { id: true, code: true, title: true } },
    },
  });
  return row?.dueDate ? { ...row, dueDate: row.dueDate } : null;
}

export async function listCourseOptions(
  userId: string,
): Promise<{ id: string; code: string; title: string }[]> {
  return prisma.course.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ term: "desc" }, { code: "asc" }],
    select: { id: true, code: true, title: true },
  });
}

export async function createCourse(
  userId: string,
  input: CourseInput,
): Promise<Course> {
  return prisma.course.create({ data: { ...input, userId } });
}

export async function updateCourse(
  userId: string,
  courseId: string,
  input: CourseInput,
): Promise<Course | null> {
  const { count } = await prisma.course.updateMany({
    where: { id: courseId, userId, deletedAt: null },
    data: input,
  });
  if (count === 0) return null;
  return prisma.course.findFirst({ where: { id: courseId, userId } });
}

export async function softDeleteCourse(
  userId: string,
  courseId: string,
): Promise<boolean> {
  const { count } = await prisma.course.updateMany({
    where: { id: courseId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0;
}

export type AssessmentInput = {
  title: string;
  weight: number;
  score: number | null;
  maxScore: number;
  dueDate: Date | null;
};

export async function createAssessment(
  userId: string,
  courseId: string,
  input: AssessmentInput,
): Promise<Assessment> {
  return prisma.assessment.create({ data: { ...input, courseId, userId } });
}

/** Returns the updated row (rather than a bare boolean) so a caller that
 *  needs to re-index the parent course knows its `courseId` without a
 *  second read. */
export async function updateAssessment(
  userId: string,
  assessmentId: string,
  input: Partial<AssessmentInput>,
): Promise<Assessment | null> {
  const { count } = await prisma.assessment.updateMany({
    where: { id: assessmentId, userId },
    data: input,
  });
  if (count === 0) return null;
  return prisma.assessment.findFirst({ where: { id: assessmentId, userId } });
}

/** Returns the row that was deleted, for the same reason `updateAssessment`
 *  does — the caller needs its `courseId` to re-index the course. */
export async function deleteAssessment(
  userId: string,
  assessmentId: string,
): Promise<Assessment | null> {
  const row = await prisma.assessment.findFirst({
    where: { id: assessmentId, userId },
  });
  if (!row) return null;
  await prisma.assessment.delete({ where: { id: row.id } });
  return row;
}

/** Everything attached to a course, for its hub page. */
export async function listCourseContents(userId: string, courseId: string) {
  const [notes, tasks, events] = await Promise.all([
    prisma.note.findMany({
      where: { userId, courseId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
      take: 20,
    }),
    prisma.task.findMany({
      where: { userId, courseId, deletedAt: null },
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
      select: { id: true, title: true, status: true, dueDate: true },
      take: 30,
    }),
    prisma.event.findMany({
      where: { userId, courseId, startTime: { gte: new Date() } },
      orderBy: { startTime: "asc" },
      select: { id: true, title: true, startTime: true, location: true },
      take: 10,
    }),
  ]);
  return { notes, tasks, events };
}

/**
 * Attaches imported timetable events to a course by matching its code in the
 * event title — the shape a university feed uses ("CMP2003 Data Structures").
 * A deterministic string match, run on request rather than silently during
 * sync, so it is always the user's choice which events get claimed.
 */
export async function linkEventsByCode(
  userId: string,
  courseId: string,
  code: string,
): Promise<number> {
  const trimmed = code.trim();
  if (trimmed.length < 2) return 0;

  const { count } = await prisma.event.updateMany({
    where: {
      userId,
      courseId: null,
      title: { contains: trimmed, mode: "insensitive" },
    },
    data: { courseId },
  });
  return count;
}

export async function getCourseRow(
  userId: string,
  courseId: string,
): Promise<Course | null> {
  return prisma.course.findFirst({
    where: { id: courseId, userId, deletedAt: null },
  });
}
