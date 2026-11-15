import "server-only";
import { prisma } from "@/lib/prisma";

/*
 * What a JSON restore needs from the database (ROADMAP item 35): what the account already holds, to tell "already
 * here" from "new", and the bulk inserts for the rows nothing else needs to see one at a time. Every read is scoped
 * by `userId` and leaves out the trash; every write sets `userId` itself, from the session, never from the file.
 */

export const existing = {
  courses: (userId: string) =>
    prisma.course.findMany({ where: { userId, deletedAt: null }, select: { id: true, code: true, term: true }, take: 20_001 }),
  projects: (userId: string) =>
    prisma.project.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true }, take: 20_001 }),
  goals: (userId: string) =>
    prisma.goal.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true }, take: 20_001 }),
  assessments: (userId: string) =>
    prisma.assessment.findMany({
      where: { userId, course: { deletedAt: null } },
      select: { id: true, courseId: true, title: true, dueDate: true },
      take: 20_001,
    }),
  /** Title and the SHA-256 of the text with every line break an LF, computed here so the text never travels (as the vault import does). */
  notes: (userId: string) =>
    prisma.$queryRaw<{ id: string; title: string; hash: string }[]>`
      SELECT "id", "title",
             encode(sha256(convert_to(replace(replace("content", chr(13) || chr(10), chr(10)), chr(13), chr(10)), 'UTF8')), 'hex') AS "hash"
      FROM "Note"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL
      ORDER BY "createdAt" ASC, "id" ASC`,
  tasks: (userId: string) =>
    prisma.task.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, title: true, dueDate: true, courseId: true },
      take: 100_001,
    }),
  events: (userId: string) =>
    prisma.event.findMany({
      where: { userId, subscriptionId: null },
      select: { id: true, title: true, startTime: true, endTime: true },
      take: 100_001,
    }),
  flashcards: (userId: string) =>
    prisma.flashcard.findMany({
      where: { userId, OR: [{ noteId: null }, { note: { deletedAt: null } }] },
      select: { id: true, noteId: true, question: true, clozeIndex: true },
      take: 100_001,
    }),
  referenceKeys: async (userId: string) =>
    (await prisma.reference.findMany({ where: { userId }, select: { key: true }, take: 20_001 })).map((row) => row.key),
};

const CHUNK = 1000;
async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let at = 0; at < rows.length; at += CHUNK) await write(rows.slice(at, at + CHUNK));
}

export const insert = {
  courses: (userId: string, rows: { id: string; code: string; title: string; term: string; credits: number | null; finalGrade: string | null }[]) =>
    inChunks(rows, (data) => prisma.course.createMany({ data: data.map((row) => ({ ...row, userId })) })),
  assessments: (
    userId: string,
    rows: { id: string; courseId: string; title: string; weight: number; score: number | null; maxScore: number; dueDate: Date | null }[],
  ) => inChunks(rows, (data) => prisma.assessment.createMany({ data: data.map((row) => ({ ...row, userId })) })),
  tasks: (
    userId: string,
    rows: {
      id: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      tags: string[];
      dueDate: Date | null;
      estimatedMinutes: number;
      scheduledStart: Date | null;
      scheduledEnd: Date | null;
      completedAt: Date | null;
      recurrenceId: string | null;
      projectId: string | null;
      courseId: string | null;
      noteId: string | null;
      goalId: string | null;
      assessmentId: string | null;
    }[],
  ) => inChunks(rows, (data) => prisma.task.createMany({ data: data.map((row) => ({ ...row, userId })) })),
  checklistItems: (userId: string, rows: { taskId: string; title: string; done: boolean; position: number }[]) =>
    inChunks(rows, (data) => prisma.taskChecklistItem.createMany({ data: data.map((row) => ({ ...row, userId })) })),
  events: (
    userId: string,
    rows: {
      id: string;
      title: string;
      description: string | null;
      location: string | null;
      startTime: Date;
      endTime: Date;
      recurrenceId: string | null;
      projectId: string | null;
      courseId: string | null;
    }[],
  ) => inChunks(rows, (data) => prisma.event.createMany({ data: data.map((row) => ({ ...row, userId })) })),
  flashcards: (
    userId: string,
    rows: {
      noteId: string | null;
      question: string;
      answer: string;
      clozeIndex: number | null;
      easeFactor: number;
      intervalDays: number;
      repetitions: number;
      dueAt: Date;
      lastReviewed: Date | null;
    }[],
  ) => inChunks(rows, (data) => prisma.flashcard.createMany({ data: data.map((row) => ({ ...row, userId })) })),
};
