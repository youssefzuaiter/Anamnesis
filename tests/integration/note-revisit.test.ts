/** The note that comes back, against a real Postgres (ROADMAP item 32). */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getRevisit } from "@/services/dashboard-service";

const users: string[] = [];
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function newUser() {
  const user = await prisma.user.create({ data: { email: `revisit-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user.id;
}
const NOW = new Date(2026, 10, 14, 9, 0);
const note = (userId: string, title: string, updatedAt: Date, deletedAt: Date | null = null) =>
  prisma.note.create({ data: { userId, title, content: "x", tags: [], updatedAt, deletedAt } });

test("the note from this day two years ago comes back, and it is mine", async () => {
  const me = await newUser();
  const other = await newUser();
  await note(me, "Older, not today", new Date(2023, 4, 2));
  const anniversary = await note(me, "Two years ago today", new Date(2024, 10, 14, 17, 0));
  await note(other, "Their anniversary", new Date(2024, 10, 14, 10, 0));
  const revisit = await getRevisit(me, NOW);
  assert.equal(revisit?.note.id, anniversary.id);
  assert.equal(revisit?.reason, "onThisDay");
  assert.equal(revisit?.yearsAgo, 2);
});

test("a trashed note never comes back, and a note changed recently never does", async () => {
  const me = await newUser();
  await note(me, "In the trash", new Date(2023, 0, 5), new Date(2025, 0, 1));
  await note(me, "Changed last week", new Date(NOW.getTime() - 7 * 86_400_000));
  assert.equal(await getRevisit(me, NOW), null);
});

test("with no anniversary, an untouched note comes back, and another account's never does", async () => {
  const me = await newUser();
  const other = await newUser();
  await note(other, "Theirs, untouched", new Date(2020, 1, 1));
  const mine = await note(me, "Mine, untouched", new Date(2025, 2, 3));
  const revisit = await getRevisit(me, NOW);
  assert.equal(revisit?.note.id, mine.id);
  assert.equal(revisit?.reason, "untouched");
  assert.equal(await getRevisit(randomUUID(), NOW), null, "an account with no notes gets no card");
});
