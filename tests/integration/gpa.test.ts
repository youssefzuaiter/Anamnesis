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
import { AppError } from "@/lib/api-response";
import { DEFAULT_GRADE_SCALE } from "@/lib/gpa-scale";
import * as gpaService from "@/services/gpa-service";

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

type CourseFields = {
  code?: string;
  term?: string;
  credits?: number | null;
  finalGrade?: string | null;
  deleted?: boolean;
};

function addCourse(userId: string, fields: CourseFields = {}) {
  return prisma.course.create({
    data: {
      userId,
      code: fields.code ?? "CMP1000",
      title: `Course ${fields.code ?? "CMP1000"}`,
      term: fields.term ?? "Fall 2026",
      credits: fields.credits ?? null,
      finalGrade: fields.finalGrade ?? null,
      deletedAt: fields.deleted ? new Date() : null,
    },
  });
}

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await assert.rejects(promise, (error) => error instanceof AppError && error.code === code);
}

const row = (courseId: string) => prisma.course.findUniqueOrThrow({ where: { id: courseId } });

test("setCourseGrade stores credits and a normalised letter, and clears them", async () => {
  const user = await newUser();
  const course = await addCourse(user.id);

  await gpaService.setCourseGrade(user.id, course.id, { credits: 3, finalGrade: " ba " });
  assert.deepEqual(
    [(await row(course.id)).credits, (await row(course.id)).finalGrade],
    [3, "BA"],
  );

  await gpaService.setCourseGrade(user.id, course.id, { credits: 2.5, finalGrade: "s" });
  assert.deepEqual(
    [(await row(course.id)).credits, (await row(course.id)).finalGrade],
    [2.5, "S"],
  );

  await gpaService.setCourseGrade(user.id, course.id, { credits: null, finalGrade: null });
  assert.deepEqual(
    [(await row(course.id)).credits, (await row(course.id)).finalGrade],
    [null, null],
  );

  await gpaService.setCourseGrade(user.id, course.id, { credits: 4, finalGrade: "AA" });
  await gpaService.setCourseGrade(user.id, course.id, { credits: 0, finalGrade: "" });
  assert.deepEqual(
    [(await row(course.id)).credits, (await row(course.id)).finalGrade],
    [null, null],
  );
});

test("setCourseGrade refuses credits and letters that make no sense, and changes nothing", async () => {
  const user = await newUser();
  const course = await addCourse(user.id, { credits: 4, finalGrade: "AA" });

  const bad: { credits: number | null; finalGrade: string | null }[] = [
    { credits: -1, finalGrade: "AA" },
    { credits: 31, finalGrade: "AA" },
    { credits: Number.NaN, finalGrade: "AA" },
    { credits: Number.POSITIVE_INFINITY, finalGrade: "AA" },
    { credits: 4, finalGrade: "TOOLONG" },
    { credits: 4, finalGrade: "A B" },
  ];
  for (const input of bad) {
    await expectCode(gpaService.setCourseGrade(user.id, course.id, input), "VALIDATION_ERROR");
  }
  const after = await row(course.id);
  assert.deepEqual([after.credits, after.finalGrade], [4, "AA"]);
});

test("another account's course, a deleted course and a missing one are the same refusal", async () => {
  const mine = await newUser();
  const other = await newUser();
  const theirs = await addCourse(other.id, { credits: 4, finalGrade: "AA" });
  const gone = await addCourse(mine.id, { credits: 4, finalGrade: "AA", deleted: true });

  await expectCode(
    gpaService.setCourseGrade(mine.id, theirs.id, { credits: 1, finalGrade: "FF" }),
    "RESOURCE_NOT_FOUND",
  );
  await expectCode(
    gpaService.setCourseGrade(mine.id, gone.id, { credits: 1, finalGrade: "FF" }),
    "RESOURCE_NOT_FOUND",
  );
  await expectCode(
    gpaService.setCourseGrade(mine.id, randomUUID(), { credits: 1, finalGrade: "FF" }),
    "RESOURCE_NOT_FOUND",
  );

  const untouched = await row(theirs.id);
  assert.deepEqual([untouched.credits, untouched.finalGrade], [4, "AA"]);
  const stillGone = await row(gone.id);
  assert.deepEqual([stillGone.credits, stillGone.finalGrade], [4, "AA"]);
});

test("the overview holds only the caller's live courses, with their marks", async () => {
  const mine = await newUser();
  const other = await newUser();
  const live = await addCourse(mine.id, { code: "CMP2003", credits: 4, finalGrade: "BA" });
  await addCourse(mine.id, { code: "OLD1000", credits: 4, finalGrade: "AA", deleted: true });
  await addCourse(other.id, { code: "THEIRS1", credits: 4, finalGrade: "AA" });
  const bare = await addCourse(mine.id, { code: "BARE1000" });
  await prisma.assessment.createMany({
    data: [
      { userId: mine.id, courseId: live.id, title: "Midterm", weight: 50, score: 40, maxScore: 100 },
      { userId: mine.id, courseId: live.id, title: "Final", weight: 50 },
    ],
  });

  const overview = await gpaService.getGpaOverview(mine.id);

  assert.deepEqual(overview.courses.map((c) => c.code).sort(), ["BARE1000", "CMP2003"]);
  const mapped = overview.courses.find((c) => c.id === live.id);
  assert.deepEqual(mapped, {
    id: live.id,
    code: "CMP2003",
    title: "Course CMP2003",
    term: "Fall 2026",
    credits: 4,
    finalGrade: "BA",
  });
  assert.deepEqual(overview.marks[live.id], { average: 40, remaining: 50 });
  assert.deepEqual(overview.marks[bare.id], { average: null, remaining: 0 });
});

test("a fresh account has the preset, no target, and counts as using the preset", async () => {
  const user = await newUser();
  const overview = await gpaService.getGpaOverview(user.id);
  assert.deepEqual(overview.scale, DEFAULT_GRADE_SCALE);
  assert.equal(overview.usesDefaultScale, true);
  assert.equal(overview.targetGpa, null);
  assert.equal(overview.courses.length, 0);
});

test("a stored scale that is unusable gives the preset instead of an error", async () => {
  const user = await newUser();
  for (const stored of [
    "garbage",
    { letter: "AA", points: 4 },
    [{ letter: "AA", points: 4 }, { letter: "AA", points: 3 }],
    [{ letter: "AA", points: 99 }],
    [],
  ]) {
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, gpaScale: stored },
      update: { gpaScale: stored },
    });
    const overview = await gpaService.getGpaOverview(user.id);
    assert.deepEqual(overview.scale, DEFAULT_GRADE_SCALE, JSON.stringify(stored));
    assert.equal(overview.usesDefaultScale, true);
  }
});

test("a custom scale is saved, sorted, and read back; a bad one is refused and nothing is stored; null resets", async () => {
  const user = await newUser();

  await gpaService.saveGradeScale(user.id, [
    { letter: "b", points: 3 },
    { letter: "A", points: 4 },
  ]);
  const custom = await gpaService.getGpaOverview(user.id);
  assert.deepEqual(custom.scale, [
    { letter: "A", points: 4 },
    { letter: "B", points: 3 },
  ]);
  assert.equal(custom.usesDefaultScale, false);

  await expectCode(
    gpaService.saveGradeScale(user.id, [
      { letter: "A", points: 4 },
      { letter: "a", points: 3 },
    ]),
    "VALIDATION_ERROR",
  );
  await expectCode(gpaService.saveGradeScale(user.id, "garbage"), "VALIDATION_ERROR");
  await expectCode(gpaService.saveGradeScale(user.id, []), "VALIDATION_ERROR");
  assert.deepEqual((await gpaService.getGpaOverview(user.id)).scale, custom.scale);

  await gpaService.saveGradeScale(user.id, null);
  const reset = await gpaService.getGpaOverview(user.id);
  assert.deepEqual(reset.scale, DEFAULT_GRADE_SCALE);
  assert.equal(reset.usesDefaultScale, true);
  assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } })).gpaScale, null);
});

test("a target is stored when it fits the scale, refused when it does not, and cleared by null", async () => {
  const user = await newUser();

  await gpaService.setTargetGpa(user.id, 3.5);
  assert.equal((await gpaService.getGpaOverview(user.id)).targetGpa, 3.5);

  for (const target of [0, -1, 4.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expectCode(gpaService.setTargetGpa(user.id, target), "VALIDATION_ERROR");
  }
  assert.equal((await gpaService.getGpaOverview(user.id)).targetGpa, 3.5);

  await gpaService.saveGradeScale(user.id, [{ letter: "A", points: 10 }]);
  await gpaService.setTargetGpa(user.id, 7.5);
  assert.equal((await gpaService.getGpaOverview(user.id)).targetGpa, 7.5);

  await gpaService.setTargetGpa(user.id, null);
  assert.equal((await gpaService.getGpaOverview(user.id)).targetGpa, null);
});

test("the profile row is made for an account that has none", async () => {
  const user = await newUser();
  assert.equal(await prisma.userProfile.count({ where: { userId: user.id } }), 0);
  await gpaService.setTargetGpa(user.id, 3);
  assert.equal(await prisma.userProfile.count({ where: { userId: user.id } }), 1);
});

test("one account's settings never change another's", async () => {
  const mine = await newUser();
  const other = await newUser();
  await gpaService.setTargetGpa(other.id, 3.2);
  await gpaService.saveGradeScale(other.id, [{ letter: "P", points: 1 }]);

  await gpaService.setTargetGpa(mine.id, 3.9);
  await gpaService.saveGradeScale(mine.id, null);

  const theirs = await gpaService.getGpaOverview(other.id);
  assert.equal(theirs.targetGpa, 3.2);
  assert.deepEqual(theirs.scale, [{ letter: "P", points: 1 }]);
});
