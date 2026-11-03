import "server-only";
import { prisma } from "@/lib/prisma";
import { EXPORT_FORMAT_VERSION, NOT_INCLUDED, feedHost } from "@/lib/export-shape";
import * as flashcardRepository from "@/repositories/flashcard-repository";

const oldestFirst = { createdAt: "asc" } as const;

/**
 * Everything a user owns that can safely leave the machine, in one payload: a personal backup and
 * portability export, not a system dump. What it promises, and what it leaves out and why, is
 * written down in `lib/export-shape.ts` and checked against the schema by
 * `tests/integration/export.test.ts`, so a model or a column added later cannot be forgotten.
 *
 * - Every query carries `userId`, the children's too.
 * - Soft-deleted rows are left out, as every other read path treats `deletedAt` as gone, and so is
 *   everything that belongs to one (a trashed note's versions, cards and attachments, a deleted
 *   course's assessments, a deleted conversation's messages), so no child points at a missing parent.
 *   A note, task or event in a deleted course keeps its `courseId`, which then names a course that is
 *   not in the file.
 * - `passwordHash` is never read into the file, and a calendar feed's address, a bearer secret, is
 *   read only to take its host and is never returned. Attachment bytes are not here, only the records.
 * - `WorkspaceEmbedding` is derived and regenerable, and its vector column cannot be written as JSON.
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
    courses,
    assessments,
    flashcards,
    noteVersions,
    conversations,
    messages,
    attachments,
    feeds,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
    }),
    // The whole profile: an explicit field list here once dropped the GPA target and scale.
    prisma.userProfile.findUnique({ where: { userId } }),
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
    prisma.course.findMany({ where: { userId, deletedAt: null }, orderBy: oldestFirst }),
    prisma.assessment.findMany({ where: { userId, course: { deletedAt: null } }, orderBy: oldestFirst }),
    flashcardRepository.listLiveForExport(userId),
    prisma.noteVersion.findMany({ where: { userId, note: { deletedAt: null } }, orderBy: oldestFirst }),
    prisma.conversation.findMany({ where: { userId, deletedAt: null }, orderBy: oldestFirst }),
    prisma.message.findMany({ where: { userId, conversation: { deletedAt: null } }, orderBy: oldestFirst }),
    prisma.attachment.findMany({ where: { userId, note: { deletedAt: null } }, orderBy: oldestFirst }),
    prisma.calendarSubscription.findMany({ where: { userId }, orderBy: oldestFirst }),
  ]);

  // The address is a secret: keep its host, drop the rest.
  const calendarSubscriptions = feeds.map(({ url, ...feed }) => ({ ...feed, host: feedHost(url) }));

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    notIncluded: NOT_INCLUDED,
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
    courses,
    assessments,
    flashcards,
    noteVersions,
    conversations,
    messages,
    attachments,
    calendarSubscriptions,
  };
}
