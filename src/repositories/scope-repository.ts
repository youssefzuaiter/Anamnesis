import "server-only";
import { prisma } from "@/lib/prisma";
import type { AssistantScope } from "@/lib/assistant-scope";

/**
 * The course, project or note a scope names, if it is the caller's own and not
 * deleted. The lookup is scoped by `userId`, so another account's id finds
 * nothing, the same as an id that never existed.
 */
export async function getScopeEntity(
  userId: string,
  scope: AssistantScope,
): Promise<{ id: string; label: string } | null> {
  switch (scope.kind) {
    case "course": {
      const course = await prisma.course.findFirst({
        where: { id: scope.id, userId, deletedAt: null },
        select: { id: true, code: true, title: true },
      });
      return course ? { id: course.id, label: `${course.code} — ${course.title}` } : null;
    }
    case "project": {
      const project = await prisma.project.findFirst({
        where: { id: scope.id, userId, deletedAt: null },
        select: { id: true, title: true },
      });
      return project ? { id: project.id, label: project.title } : null;
    }
    case "note": {
      const note = await prisma.note.findFirst({
        where: { id: scope.id, userId, deletedAt: null },
        select: { id: true, title: true },
      });
      return note ? { id: note.id, label: note.title } : null;
    }
  }
}

/**
 * The ids of the live notes and tasks, and the events, that belong to a course
 * or a project (their `courseId` / `projectId`). A note scope has no members.
 */
export async function listScopeMembers(
  userId: string,
  scope: AssistantScope,
): Promise<{ notes: string[]; tasks: string[]; events: string[] }> {
  if (scope.kind === "note") return { notes: [], tasks: [], events: [] };

  const link = scope.kind === "course" ? { courseId: scope.id } : { projectId: scope.id };
  const [notes, tasks, events] = await Promise.all([
    prisma.note.findMany({ where: { userId, deletedAt: null, ...link }, select: { id: true } }),
    prisma.task.findMany({ where: { userId, deletedAt: null, ...link }, select: { id: true } }),
    prisma.event.findMany({ where: { userId, ...link }, select: { id: true } }),
  ]);
  return {
    notes: notes.map((row) => row.id),
    tasks: tasks.map((row) => row.id),
    events: events.map((row) => row.id),
  };
}
