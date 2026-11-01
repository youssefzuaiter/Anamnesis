/**
 * Line breaks in saved notes, against a real Postgres. DB-only like the rest of this tier.
 *
 * Notes saved through the form before line breaks were normalised are stored with CR LF,
 * because that is how a browser sends a textarea. The form now arrives as LF, so a Save
 * with no edit would differ from the stored text only in its line breaks. A version exists
 * to undo an edit, and each one pushes the oldest of the 20 kept out, so a change nobody
 * can see must not take one.
 *
 * `updateNote` tries to re-embed the note; with Ollama off that logs a warning and carries
 * on, which nothing below depends on.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import * as noteService from "@/services/note-service";
import { listVersions } from "@/repositories/note-repository";

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `breaks-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const input = (content: string, title = "Lecture 4") => ({
  title,
  content,
  tags: [] as string[],
  isFavorite: false,
  projectId: null,
  courseId: null,
});

async function oldNote(userId: string, content: string, title = "Lecture 4") {
  // Written straight to the table, as a note saved by the form before the change was.
  return prisma.note.create({ data: { ...input(content, title), userId } });
}

test("saving an old note with CR LF breaks and no edit takes no version, and stores LF", async () => {
  const user = await newUser();
  const note = await oldNote(user.id, "first\r\n\r\nsecond\r\nthird");

  await noteService.updateNote(user.id, note.id, input("first\n\nsecond\nthird"));

  assert.equal((await listVersions(user.id, note.id)).length, 0);
  const stored = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  assert.equal(stored.content, "first\n\nsecond\nthird");
});

test("a real edit to a note stored with CR LF still takes a version, of the text it replaced", async () => {
  const user = await newUser();
  const note = await oldNote(user.id, "first\r\nsecond");

  await noteService.updateNote(user.id, note.id, input("first\nsecond, edited"));

  const versions = await listVersions(user.id, note.id);
  assert.equal(versions.length, 1);
  const kept = await prisma.noteVersion.findFirstOrThrow({ where: { noteId: note.id } });
  assert.equal(kept.content, "first\r\nsecond");
});

test("a changed title still takes a version when the line breaks differ too", async () => {
  const user = await newUser();
  const note = await oldNote(user.id, "first\r\nsecond");

  await noteService.updateNote(user.id, note.id, input("first\nsecond", "Lecture 4, revised"));

  assert.equal((await listVersions(user.id, note.id)).length, 1);
});

test("restoring a version equal to the current text takes no version, whatever its line breaks", async () => {
  const user = await newUser();
  const note = await oldNote(user.id, "first\r\nsecond");
  const version = await prisma.noteVersion.create({
    data: { userId: user.id, noteId: note.id, title: "Lecture 4", content: "first\r\nsecond" },
  });

  await noteService.restoreVersion(user.id, version.id);

  // Only the version this test made; restoring identical text added none.
  assert.equal((await listVersions(user.id, note.id)).length, 1);
});
