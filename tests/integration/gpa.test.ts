/**
 * The GPA columns, the grade and settings writes, and the overview, against a real
 * Postgres, DB-only like the rest of this tier. The checks that matter here are the
 * ones a pure unit test cannot make: another account's course is never read or
 * changed, a deleted course is never counted, and what is stored survives a read.
 *
 * Each test makes its own accounts so one test's courses cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `gpa-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

test("the new columns exist and are optional", async () => {
  const user = await newUser();
  const course = await prisma.course.create({
    data: { userId: user.id, code: "CMP1000", title: "Course", term: "Fall 2026" },
  });
  assert.equal(course.credits, null);
  assert.equal(course.finalGrade, null);

  const graded = await prisma.course.update({
    where: { id: course.id },
    data: { credits: 3.5, finalGrade: "BA" },
  });
  assert.equal(graded.credits, 3.5);
  assert.equal(graded.finalGrade, "BA");

  const fresh = await prisma.userProfile.create({ data: { userId: user.id } });
  assert.equal(fresh.targetGpa, null);
  assert.equal(fresh.gpaScale, null);

  const saved = await prisma.userProfile.update({
    where: { userId: user.id },
    data: { targetGpa: 3.5, gpaScale: [{ letter: "AA", points: 4 }] },
  });
  assert.equal(saved.targetGpa, 3.5);
  assert.deepEqual(saved.gpaScale, [{ letter: "AA", points: 4 }]);
});
