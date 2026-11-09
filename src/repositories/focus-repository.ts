import "server-only";
import { prisma } from "@/lib/prisma";
import type { FocusTelemetryModel as FocusTelemetry } from "@/generated/prisma/models";

/** The three switches, each its own consent and each off until the person turns it on. */
export type FocusSwitches = { tracking: boolean; includeCourse: boolean; timer: boolean };

export async function getSettings(userId: string): Promise<FocusSwitches> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { focusTrackingEnabled: true, focusIncludeCourse: true, timerSessionsEnabled: true },
  });
  return {
    tracking: profile?.focusTrackingEnabled ?? false,
    includeCourse: profile?.focusIncludeCourse ?? false,
    timer: profile?.timerSessionsEnabled ?? false,
  };
}

export async function isTrackingEnabled(userId: string): Promise<boolean> {
  return (await getSettings(userId)).tracking;
}

export async function setFlags(
  userId: string,
  patch: {
    focusTrackingEnabled?: boolean;
    focusIncludeCourse?: boolean;
    timerSessionsEnabled?: boolean;
  },
): Promise<void> {
  // upsert because a profile row may not exist for accounts created before the
  // profile was introduced.
  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: patch,
  });
}

/**
 * Turns the course switch on, but only if tracking is on, in one statement so that tracking being
 * switched off at the same moment cannot leave the course on. False means it was not turned on.
 */
export async function turnOnCourse(userId: string): Promise<boolean> {
  const { count } = await prisma.userProfile.updateMany({
    where: { userId, focusTrackingEnabled: true },
    data: { focusIncludeCourse: true },
  });
  return count > 0;
}

export async function recordSession(
  userId: string,
  session: {
    sessionDuration: number;
    typingSpeedWpm: number;
    cognitiveLoad: string;
    courseId: string | null;
  },
): Promise<FocusTelemetry> {
  return prisma.focusTelemetry.create({ data: { ...session, userId } });
}

export async function recordTimerSession(
  userId: string,
  session: { seconds: number; courseId: string | null },
): Promise<void> {
  await prisma.studySession.create({ data: { ...session, userId } });
}

/** Whether a course belongs to this account. Deleted or trashed does not matter: it is a question of whose it is. */
export async function ownsCourse(userId: string, courseId: string): Promise<boolean> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true },
  });
  return course !== null;
}

/**
 * The course of a task the timer ran on, and its code for the confirmation line. Null when the task is
 * not this account's or is in the trash; the code is null when the course is in the trash.
 */
export async function findTimedTask(
  userId: string,
  taskId: string,
): Promise<{ courseId: string | null; courseCode: string | null } | null> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId, deletedAt: null },
    select: { courseId: true, course: { select: { code: true, deletedAt: true } } },
  });
  if (!task) return null;
  return {
    courseId: task.courseId,
    courseCode: task.course && task.course.deletedAt === null ? task.course.code : null,
  };
}

export async function listSessions(
  userId: string,
  take = 30,
): Promise<FocusTelemetry[]> {
  return prisma.focusTelemetry.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take,
  });
}

/** Both kinds, in one transaction, so a failure part-way cannot leave half a history behind. */
export async function deleteAllSessions(userId: string): Promise<number> {
  const [written, timed] = await prisma.$transaction([
    prisma.focusTelemetry.deleteMany({ where: { userId } }),
    prisma.studySession.deleteMany({ where: { userId } }),
  ]);
  return written.count + timed.count;
}
