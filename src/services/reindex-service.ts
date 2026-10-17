import "server-only";
import { prisma } from "@/lib/prisma";
import { indexEntity } from "@/lib/vector";
import {
  embeddableTextFor,
  projectTaskSummary,
  courseAssessmentSummary,
  goalRollupSummary,
} from "@/services/embeddable-text";
import { ROLLUP_ORDER } from "@/services/goal-service";

export type ReindexReport = {
  indexed: number;
  failed: number;
  byType: Record<string, number>;
};

/**
 * Rebuilds the vector index for everything the user owns.
 *
 * Needed because indexing is best-effort at write time: a save made while
 * Ollama was stopped succeeds, drops its stale embeddings, and leaves that
 * entity invisible to semantic search until it is saved again. Before this
 * there was no way to notice or repair that — and bulk Markdown import makes
 * it easy to create hundreds of such notes in one go.
 */
export async function reindexEverything(
  userId: string,
): Promise<ReindexReport> {
  const [notes, tasks, events, projects, courses, goals] = await Promise.all([
    prisma.note.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, title: true, content: true, tags: true },
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null },
      select: {
        id: true, title: true, description: true, status: true,
        priority: true, dueDate: true, estimatedMinutes: true, tags: true,
      },
    }),
    prisma.event.findMany({
      where: { userId },
      select: {
        id: true, title: true, description: true, startTime: true,
        endTime: true, location: true,
      },
    }),
    prisma.project.findMany({
      where: { userId, deletedAt: null },
      select: {
        id: true, title: true, category: true, progress: true,
        // A project's embedded text includes a rundown of its tasks, so they
        // come along rather than being fetched one project at a time.
        tasks: {
          where: { deletedAt: null },
          select: { title: true, status: true },
        },
      },
    }),
    prisma.course.findMany({
      where: { userId, deletedAt: null },
      select: {
        id: true, code: true, title: true, term: true,
        // A course's embedded text includes a rundown of its assessments, so
        // they come along rather than being fetched one course at a time.
        assessments: {
          select: { title: true, weight: true, score: true, maxScore: true, dueDate: true },
        },
      },
    }),
    prisma.goal.findMany({
      where: { userId, deletedAt: null },
      select: {
        id: true, title: true, description: true, category: true,
        targetDate: true, progress: true,
        // A goal's embedded text includes a rundown of its linked projects and
        // of its own direct tasks. Ordered exactly as the write path orders
        // them, or the rebuilt text could differ from what a save embeds.
        projects: {
          where: { deletedAt: null },
          select: { title: true, progress: true },
          orderBy: [...ROLLUP_ORDER],
        },
        tasks: {
          where: { deletedAt: null },
          select: { title: true, status: true },
          orderBy: [...ROLLUP_ORDER],
        },
      },
    }),
  ]);

  const report: ReindexReport = {
    indexed: 0,
    failed: 0,
    byType: { note: 0, task: 0, event: 0, project: 0, course: 0, goal: 0 },
  };

  const work = [
    ...notes.map((row) => ["note", row.id, embeddableTextFor.note(row)] as const),
    ...tasks.map((row) => ["task", row.id, embeddableTextFor.task(row)] as const),
    ...events.map((row) => ["event", row.id, embeddableTextFor.event(row)] as const),
    ...projects.map(
      (row) =>
        [
          "project",
          row.id,
          embeddableTextFor.project(row, projectTaskSummary(row.tasks)),
        ] as const,
    ),
    ...courses.map(
      (row) =>
        [
          "course",
          row.id,
          embeddableTextFor.course(row, courseAssessmentSummary(row.assessments)),
        ] as const,
    ),
    ...goals.map(
      (row) =>
        [
          "goal",
          row.id,
          embeddableTextFor.goal(row, goalRollupSummary(row.projects, row.tasks)),
        ] as const,
    ),
  ];

  for (const [type, id, text] of work) {
    try {
      await indexEntity(userId, type, id, text);
      report.indexed++;
      report.byType[type]++;
    } catch {
      // One unembeddable row must not abandon the rest of the rebuild.
      report.failed++;
    }
  }

  return report;
}
