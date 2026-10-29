import "server-only";
import { prisma } from "@/lib/prisma";
import { DAILY_TAG } from "@/lib/daily";
import type { NoteModel as Note } from "@/generated/prisma/models";

export type NoteSummary = Pick<
  Note,
  "id" | "title" | "tags" | "isFavorite" | "updatedAt"
> & { excerpt: string };

export type NoteInput = {
  title: string;
  content: string;
  tags: string[];
  isFavorite: boolean;
  projectId: string | null;
  courseId: string | null;
};

const EXCERPT_LENGTH = 160;

function toSummary(
  note: Pick<Note, "id" | "title" | "tags" | "isFavorite" | "updatedAt" | "content">,
): NoteSummary {
  const flattened = note.content.replace(/\s+/g, " ").trim();
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    isFavorite: note.isFavorite,
    updatedAt: note.updatedAt,
    excerpt:
      flattened.length > EXCERPT_LENGTH
        ? `${flattened.slice(0, EXCERPT_LENGTH).trimEnd()}…`
        : flattened,
  };
}

export async function listNotes(
  userId: string,
  options: {
    favoritesOnly?: boolean;
    tag?: string;
    take?: number;
    skip?: number;
  } = {},
): Promise<NoteSummary[]> {
  const notes = await prisma.note.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(options.favoritesOnly ? { isFavorite: true } : {}),
      ...(options.tag ? { tags: { has: options.tag } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    ...(options.take ? { take: options.take } : {}),
    ...(options.skip ? { skip: options.skip } : {}),
    select: {
      id: true,
      title: true,
      tags: true,
      isFavorite: true,
      updatedAt: true,
      content: true,
    },
  });

  return notes.map(toSummary);
}

export async function findNotesByIds(
  userId: string,
  ids: string[],
): Promise<NoteSummary[]> {
  if (ids.length === 0) return [];

  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: null, id: { in: ids } },
    select: {
      id: true,
      title: true,
      tags: true,
      isFavorite: true,
      updatedAt: true,
      content: true,
    },
  });

  const byId = new Map(notes.map((note) => [note.id, toSummary(note)]));
  // Preserve the caller's ordering, which for search results is by relevance.
  return ids.flatMap((id) => {
    const note = byId.get(id);
    return note ? [note] : [];
  });
}

/** Every live note's id and title: what a `[[link]]` can resolve to, ambiguity included. */
export async function listNoteTitles(
  userId: string,
): Promise<{ id: string; title: string }[]> {
  return prisma.note.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, title: true },
  });
}

/**
 * Live notes whose text contains `text`, in any case, most recently edited first.
 * Prisma's `contains` escapes `%` and `_`, so a title is matched literally. A
 * narrowing step only: the caller confirms each hit as a mention of whole words.
 */
export async function listNotesContaining(
  userId: string,
  text: string,
  excludeIds: string[],
  take: number,
): Promise<{ id: string; title: string; content: string }[]> {
  return prisma.note.findMany({
    where: {
      userId,
      deletedAt: null,
      id: { notIn: excludeIds },
      content: { contains: text, mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, title: true, content: true },
  });
}

export async function getNote(
  userId: string,
  noteId: string,
): Promise<Note | null> {
  return prisma.note.findFirst({
    where: { id: noteId, userId, deletedAt: null },
  });
}

/**
 * The account's daily note for a day: the non-deleted note with that exact title
 * and the `daily` tag. If more than one exists (a rename leaves the old one, a
 * restore brings one back), the earliest wins, so opening never hides an older one.
 */
export async function findDailyNote(
  userId: string,
  title: string,
): Promise<Note | null> {
  return prisma.note.findFirst({
    where: { userId, deletedAt: null, title, tags: { has: DAILY_TAG } },
    orderBy: { createdAt: "asc" },
  });
}

export async function createNote(
  userId: string,
  input: NoteInput,
): Promise<Note> {
  return prisma.note.create({ data: { ...input, userId } });
}

export async function updateNote(
  userId: string,
  noteId: string,
  input: NoteInput,
): Promise<Note | null> {
  // updateMany rather than update so the userId predicate is part of the write
  // itself; update() would match on id alone and only then check ownership.
  const { count } = await prisma.note.updateMany({
    where: { id: noteId, userId, deletedAt: null },
    data: input,
  });
  if (count === 0) return null;
  return getNote(userId, noteId);
}

export async function softDeleteNote(
  userId: string,
  noteId: string,
): Promise<boolean> {
  const { count } = await prisma.note.updateMany({
    where: { id: noteId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0;
}

export type DeletedNote = Pick<Note, "id" | "title" | "deletedAt">;

export async function listDeletedNotes(userId: string): Promise<DeletedNote[]> {
  return prisma.note.findMany({
    where: { userId, deletedAt: { not: null } },
    select: { id: true, title: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });
}

export async function restoreNote(
  userId: string,
  noteId: string,
): Promise<Note | null> {
  const { count } = await prisma.note.updateMany({
    where: { id: noteId, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (count === 0) return null;
  return getNote(userId, noteId);
}

/** Permanent. Only ever called on a row that is already soft-deleted. */
export async function purgeNote(
  userId: string,
  noteId: string,
): Promise<boolean> {
  const { count } = await prisma.note.deleteMany({
    where: { id: noteId, userId, deletedAt: { not: null } },
  });
  return count > 0;
}

export async function listTags(userId: string): Promise<string[]> {
  const rows = await prisma.note.findMany({
    where: { userId, deletedAt: null },
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((row) => row.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Snapshots taken before each save, newest first. */
export async function listVersions(
  userId: string,
  noteId: string,
  take = 20,
): Promise<{ id: string; title: string; createdAt: Date; length: number }[]> {
  const rows = await prisma.noteVersion.findMany({
    where: { userId, noteId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true, content: true },
    take,
  });
  return rows.map(({ content, ...row }) => ({ ...row, length: content.length }));
}

export async function getVersion(
  userId: string,
  versionId: string,
): Promise<{ noteId: string; title: string; content: string } | null> {
  return prisma.noteVersion.findFirst({
    where: { id: versionId, userId },
    select: { noteId: true, title: true, content: true },
  });
}

/** Keeps the most recent `keep` snapshots of a note and drops the rest. */
export async function snapshot(
  userId: string,
  note: Pick<Note, "id" | "title" | "content">,
  keep = 20,
): Promise<void> {
  await prisma.noteVersion.create({
    data: {
      userId,
      noteId: note.id,
      title: note.title,
      content: note.content,
    },
  });

  const stale = await prisma.noteVersion.findMany({
    where: { userId, noteId: note.id },
    orderBy: { createdAt: "desc" },
    skip: keep,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.noteVersion.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
  }
}

/** Total matching the same filters `listNotes` uses, for paging. */
export async function countNotes(
  userId: string,
  options: { favoritesOnly?: boolean; tag?: string } = {},
): Promise<number> {
  return prisma.note.count({
    where: {
      userId,
      deletedAt: null,
      ...(options.favoritesOnly ? { isFavorite: true } : {}),
      ...(options.tag ? { tags: { has: options.tag } } : {}),
    },
  });
}

/** Applies one change to many notes at once, scoped by userId in the write. */
export async function bulkUpdateNotes(
  userId: string,
  noteIds: string[],
  data: { courseId?: string | null; projectId?: string | null },
): Promise<number> {
  if (noteIds.length === 0) return 0;
  const { count } = await prisma.note.updateMany({
    where: { id: { in: noteIds }, userId, deletedAt: null },
    data,
  });
  return count;
}

export async function bulkAddTag(
  userId: string,
  noteIds: string[],
  tag: string,
): Promise<number> {
  const notes = await prisma.note.findMany({
    where: { id: { in: noteIds }, userId, deletedAt: null },
    select: { id: true, tags: true },
  });

  let changed = 0;
  for (const note of notes) {
    if (note.tags.includes(tag)) continue;
    await prisma.note.update({
      where: { id: note.id },
      data: { tags: [...note.tags, tag] },
    });
    changed++;
  }
  return changed;
}

export async function bulkSoftDelete(
  userId: string,
  noteIds: string[],
): Promise<string[]> {
  const owned = await prisma.note.findMany({
    where: { id: { in: noteIds }, userId, deletedAt: null },
    select: { id: true },
  });
  if (owned.length === 0) return [];

  await prisma.note.updateMany({
    where: { id: { in: owned.map((note) => note.id) }, userId },
    data: { deletedAt: new Date() },
  });
  return owned.map((note) => note.id);
}
