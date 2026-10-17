import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Everything a user owns, in one payload — a personal backup / portability
 * export, not a system dump. `passwordHash` is never selected (explicit field
 * lists rather than a bare `findUnique`, so a future schema change can't
 * silently start including it), soft-deleted rows are left out the same way
 * every other read path in this app already treats `deletedAt` as gone, and
 * `WorkspaceEmbedding` is skipped entirely — it is derived, regenerable from
 * the content already in the export, and its `vector` column is a Prisma
 * `Unsupported` type that cannot be selected as JSON in the first place.
 */
export async function buildFullExport(userId: string) {
  const [
    user,
    profile,
    projects,
    goals,
    notes,
    tasks,
    events,
    links,
    focusTelemetry,
    auditEvents,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
    }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { university: true, program: true, studentId: true, focusTrackingEnabled: true },
    }),
    prisma.project.findMany({ where: { userId, deletedAt: null } }),
    // Exported alongside projects and tasks, which carry a `goalId` — without
    // the goal rows those ids would point at nothing in the file.
    prisma.goal.findMany({ where: { userId, deletedAt: null } }),
    prisma.note.findMany({ where: { userId, deletedAt: null } }),
    prisma.task.findMany({ where: { userId, deletedAt: null } }),
    prisma.event.findMany({ where: { userId } }),
    prisma.entityLink.findMany({ where: { userId } }),
    prisma.focusTelemetry.findMany({ where: { userId } }),
    prisma.auditEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    user,
    profile,
    projects,
    goals,
    notes,
    tasks,
    events,
    links,
    focusTelemetry,
    auditEvents,
  };
}
