import "server-only";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { EXPORT_FORMAT_VERSION, NOT_INCLUDED, afterCreated, afterRecorded, feedHost, type ExportPage } from "@/lib/export-shape";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import * as checklistRepository from "@/repositories/task-checklist-repository";

/**
 * Everything a user owns that can safely leave the machine: a personal backup and portability
 * export, not a system dump. What it promises, and what it leaves out and why, is written down in
 * `lib/export-shape.ts` and checked against the schema by `tests/integration/export.test.ts`, so a
 * model or a column added later cannot be forgotten.
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
 *
 * Two forms of the same file, from one list of tables: `buildFullExport` holds it in memory (the
 * tests and the evals read it), `streamFullExport` writes it as text a page at a time, which is what
 * the download uses. Held whole, an export takes about five times its own size in memory (measured:
 * a 131 MB file peaked at 690 MB), which is too much for a machine this size at the largest account.
 * It is not a snapshot: rows changed while it runs can be missing or half-updated.
 */

/** Rows per query: few where one row can be 100,000 characters, many where a row is a few dozen bytes. */
const HEAVY_PAGE = 50;
const LIGHT_PAGE = 1000;

/** Oldest first, ties by id, so the order is stable and a page can resume after any row. */
const oldestFirst = (page: ExportPage) => ({
  orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  take: page.take,
});

/**
 * A table read a page at a time; `at` is the ordering value a page resumes from. Method syntax, so
 * that a `Table<Note>` can stand where the loop over every table wants a `Table<{ id: string }>`.
 */
type Table<T extends { id: string }> = {
  size: number;
  at(row: T): Date;
  read(userId: string, page: ExportPage): Promise<T[]>;
};
const tableBy = <T extends { id: string }>(size: number, read: Table<T>["read"], at: Table<T>["at"]): Table<T> => ({
  size,
  at,
  read,
});
const table = <T extends { id: string; createdAt: Date }>(size: number, read: Table<T>["read"]): Table<T> =>
  tableBy(size, read, (row) => row.createdAt);

export const tables = {
  projects: table(LIGHT_PAGE, (userId, page) =>
    prisma.project.findMany({ where: { AND: [{ userId, deletedAt: null }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  // Exported alongside projects and tasks, which carry a `goalId`: without the goal rows those ids
  // would point at nothing in the file.
  goals: table(LIGHT_PAGE, (userId, page) =>
    prisma.goal.findMany({ where: { AND: [{ userId, deletedAt: null }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  notes: table(HEAVY_PAGE, (userId, page) =>
    prisma.note.findMany({ where: { AND: [{ userId, deletedAt: null }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  tasks: table(LIGHT_PAGE, (userId, page) =>
    prisma.task.findMany({ where: { AND: [{ userId, deletedAt: null }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  // The steps of live tasks only, like every other child of a task in the trash.
  checklistItems: table(LIGHT_PAGE, (userId, page) => checklistRepository.listLiveForExport(userId, page)),
  events: table(LIGHT_PAGE, (userId, page) =>
    prisma.event.findMany({ where: { AND: [{ userId }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  links: table(LIGHT_PAGE, (userId, page) =>
    prisma.entityLink.findMany({ where: { AND: [{ userId }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  // The one table that is ordered by another column: it has no createdAt.
  focusTelemetry: tableBy(
    LIGHT_PAGE,
    (userId, page) =>
      prisma.focusTelemetry.findMany({
        where: { AND: [{ userId }, afterRecorded(page.after)] },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        take: page.take,
      }),
    (row) => row.recordedAt,
  ),
  // Ordered by recordedAt for the same reason: it has no createdAt.
  studySessions: tableBy(
    LIGHT_PAGE,
    (userId, page) =>
      prisma.studySession.findMany({
        where: { AND: [{ userId }, afterRecorded(page.after)] },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        take: page.take,
      }),
    (row) => row.recordedAt,
  ),
  auditEvents: table(LIGHT_PAGE, (userId, page) =>
    prisma.auditEvent.findMany({ where: { AND: [{ userId }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  courses: table(LIGHT_PAGE, (userId, page) =>
    prisma.course.findMany({ where: { AND: [{ userId, deletedAt: null }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  assessments: table(LIGHT_PAGE, (userId, page) =>
    prisma.assessment.findMany({ where: { AND: [{ userId, course: { deletedAt: null } }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  flashcards: table(LIGHT_PAGE, (userId, page) => flashcardRepository.listLiveForExport(userId, page)),
  noteVersions: table(HEAVY_PAGE, (userId, page) =>
    prisma.noteVersion.findMany({ where: { AND: [{ userId, note: { deletedAt: null } }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  conversations: table(LIGHT_PAGE, (userId, page) =>
    prisma.conversation.findMany({ where: { AND: [{ userId, deletedAt: null }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  messages: table(HEAVY_PAGE, (userId, page) =>
    prisma.message.findMany({ where: { AND: [{ userId, conversation: { deletedAt: null } }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  attachments: table(LIGHT_PAGE, (userId, page) =>
    prisma.attachment.findMany({ where: { AND: [{ userId, note: { deletedAt: null } }, afterCreated(page.after)] }, ...oldestFirst(page) }),
  ),
  // The address is a secret: it is read to take its host and dropped here, for both forms of the file.
  calendarSubscriptions: table(LIGHT_PAGE, async (userId, page) => {
    const feeds = await prisma.calendarSubscription.findMany({ where: { AND: [{ userId }, afterCreated(page.after)] }, ...oldestFirst(page) });
    return feeds.map(({ url, ...feed }) => ({ ...feed, host: feedHost(url) }));
  }),
};

/**
 * An export reads whole tables, and in a Prisma `where` an `undefined` means "no filter": asked for a
 * missing id, every query would return every account's rows. The session always gives a string, so
 * this is unreachable today; it is checked before the first query so it stays that way.
 */
export function assertUserId(userId: unknown): asserts userId is string {
  if (typeof userId !== "string" || userId === "") throw new AppError("VALIDATION_ERROR", "An export needs an account.");
}

const readUser = (userId: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
  });

// The whole profile: an explicit field list here once dropped the GPA target and scale.
const readProfile = async (userId: string) => {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) return null;
  // The stored form of the calendar feed secret stays in the database; see OMITTED_COLUMNS.
  const { calendarFeedHash, ...rest } = profile;
  void calendarFeedHash;
  return rest;
};

/** The pages of a table, one after another: the one place that knows when the last page has been read. */
export async function* pagesOf<T extends { id: string }>(source: Table<T>, userId: string, size: number): AsyncGenerator<T[]> {
  let after: ExportPage["after"] = null;
  for (;;) {
    const batch: T[] = await source.read(userId, { take: size, after });
    if (batch.length > 0) yield batch;
    if (batch.length < size) return;
    const last = batch[batch.length - 1];
    after = { at: source.at(last), id: last.id };
  }
}

async function readAll<T extends { id: string }>(source: Table<T>, userId: string): Promise<T[]> {
  const rows: T[] = [];
  for await (const batch of pagesOf(source, userId, source.size)) rows.push(...batch);
  return rows;
}

/** The file held in memory. */
export async function buildFullExport(userId: string) {
  assertUserId(userId);
  const [
    user,
    profile,
    projects,
    goals,
    notes,
    tasks,
    checklistItems,
    events,
    links,
    focusTelemetry,
    studySessions,
    auditEvents,
    courses,
    assessments,
    flashcards,
    noteVersions,
    conversations,
    messages,
    attachments,
    calendarSubscriptions,
  ] = await Promise.all([
    readUser(userId),
    readProfile(userId),
    readAll(tables.projects, userId),
    readAll(tables.goals, userId),
    readAll(tables.notes, userId),
    readAll(tables.tasks, userId),
    readAll(tables.checklistItems, userId),
    readAll(tables.events, userId),
    readAll(tables.links, userId),
    readAll(tables.focusTelemetry, userId),
    readAll(tables.studySessions, userId),
    readAll(tables.auditEvents, userId),
    readAll(tables.courses, userId),
    readAll(tables.assessments, userId),
    readAll(tables.flashcards, userId),
    readAll(tables.noteVersions, userId),
    readAll(tables.conversations, userId),
    readAll(tables.messages, userId),
    readAll(tables.attachments, userId),
    readAll(tables.calendarSubscriptions, userId),
  ]);

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
    checklistItems,
    events,
    links,
    focusTelemetry,
    studySessions,
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

/**
 * The same file as text, a page of rows at a time, one row per line. It is valid JSON only when it
 * ends: a failure part-way leaves it unterminated, which a reader sees as invalid, never as a
 * shorter file that looks whole.
 */
export async function* streamFullExport(
  userId: string,
  options: { pageSize?: number } = {},
): AsyncGenerator<string> {
  assertUserId(userId);
  const user = await readUser(userId);
  const profile = await readProfile(userId);
  yield [
    "{",
    `"formatVersion": ${EXPORT_FORMAT_VERSION},`,
    `"exportedAt": ${JSON.stringify(new Date().toISOString())},`,
    `"notIncluded": ${JSON.stringify(NOT_INCLUDED)},`,
    `"user": ${JSON.stringify(user)},`,
    `"profile": ${JSON.stringify(profile)}`,
  ].join("\n");

  const override = options.pageSize === undefined ? null : Math.max(1, Math.floor(options.pageSize));
  for (const [key, source] of Object.entries(tables) as [string, Table<{ id: string }>][]) {
    const size = override ?? source.size;
    yield `,\n${JSON.stringify(key)}: [`;
    let first = true;
    for await (const batch of pagesOf(source, userId, size)) {
      let text = "";
      for (const row of batch) {
        text += `${first ? "\n" : ",\n"}${JSON.stringify(row)}`;
        first = false;
      }
      yield text;
    }
    yield first ? "]" : "\n]";
  }
  yield "\n}\n";
}
