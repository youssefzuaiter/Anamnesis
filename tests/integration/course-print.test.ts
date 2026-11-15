/**
 * The notes a course prints (ROADMAP item 34), against a real Postgres: the caller's own live
 * notes of that course only, in the order they were written, bounded.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { listCourseNotesForPrint } from "@/repositories/note-repository";

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `print-${randomUUID()}@test.local`, passwordHash: "x" } });
  created.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const course = (userId: string, code: string) =>
  prisma.course.create({ data: { userId, code, title: code, term: "Fall" } });
const note = (userId: string, courseId: string | null, title: string, extra: object = {}) =>
  prisma.note.create({ data: { userId, courseId, title, content: `text of ${title}`, tags: [], ...extra } });

test("only this course's live notes of the caller, oldest first, and no other account's", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await course(me.id, "AAA1");
  const elsewhere = await course(me.id, "BBB2");
  const theirs = await course(other.id, "CCC3");

  await note(me.id, mine.id, "second", { createdAt: new Date("2026-01-02") });
  await note(me.id, mine.id, "first", { createdAt: new Date("2026-01-01") });
  await note(me.id, mine.id, "gone", { deletedAt: new Date() });
  await note(me.id, elsewhere.id, "other course");
  await note(me.id, null, "no course");
  await note(other.id, theirs.id, "stranger");

  const rows = await listCourseNotesForPrint(me.id, mine.id, 10);
  assert.deepEqual(rows.map((row) => row.title), ["first", "second"]);
  assert.equal(rows[0].content, "text of first");

  // Asking for another account's course with my id gives nothing, and the reverse too.
  assert.deepEqual(await listCourseNotesForPrint(me.id, theirs.id, 10), []);
  assert.deepEqual(await listCourseNotesForPrint(other.id, mine.id, 10), []);
});

test("the bound is applied after the order, so the first notes written are the ones kept", async () => {
  const me = await newUser();
  const mine = await course(me.id, "DDD4");
  for (let index = 0; index < 5; index++) {
    await note(me.id, mine.id, `n${index}`, { createdAt: new Date(2026, 0, index + 1) });
  }
  const rows = await listCourseNotesForPrint(me.id, mine.id, 3);
  assert.deepEqual(rows.map((row) => row.title), ["n0", "n1", "n2"]);
});
