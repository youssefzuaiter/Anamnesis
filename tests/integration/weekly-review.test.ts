/** The weekly review's goals, courses and assessments against a real Postgres (ROADMAP item 31). */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildWeeklyReview } from "@/services/review-service";

const users: string[] = [];
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function newUser() {
  const user = await prisma.user.create({ data: { email: `weekly-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user.id;
}

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

test("goals: a task finished toward a goal, directly or through a live project, counts once; others do not", async () => {
  const me = await newUser();
  const goal = await prisma.goal.create({ data: { userId: me, title: "Read widely", category: "career", progress: 40 } });
  const project = await prisma.project.create({ data: { userId: me, title: "Reading list", category: "career", goalId: goal.id } });
  const done = { status: "done", completedAt: daysAgo(2), userId: me };
  await prisma.task.create({ data: { ...done, title: "Direct", goalId: goal.id } });
  await prisma.task.create({ data: { ...done, title: "Both ways", goalId: goal.id, projectId: project.id } });
  await prisma.task.create({ data: { ...done, title: "Through project", projectId: project.id } });

  const review = await buildWeeklyReview(me, NOW);
  const moved = review.goalsMoved.find((g) => g.id === goal.id);
  assert.ok(moved, "the goal appears");
  assert.equal(moved.doneTasks, 3, "three distinct tasks, the one linked both ways once");
  assert.equal(moved.progress, 40, "its current progress is shown");
});

test("goals: another account's goal, a deleted goal, and a task through a deleted project do not appear", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await prisma.goal.create({ data: { userId: other, title: "Theirs", category: "career" } });
  await prisma.task.create({ data: { userId: other, title: "Theirs done", status: "done", completedAt: daysAgo(1), goalId: theirs.id } });
  const gone = await prisma.goal.create({ data: { userId: me, title: "Gone", category: "career", deletedAt: daysAgo(1) } });
  await prisma.task.create({ data: { userId: me, title: "For a gone goal", status: "done", completedAt: daysAgo(1), goalId: gone.id } });
  const deletedProject = await prisma.project.create({ data: { userId: me, title: "Old", category: "career", deletedAt: daysAgo(1) } });
  const goal = await prisma.goal.create({ data: { userId: me, title: "Live goal", category: "career" } });
  await prisma.task.create({ data: { userId: me, title: "Via deleted project", status: "done", completedAt: daysAgo(1), projectId: deletedProject.id, goalId: null } });
  await prisma.project.update({ where: { id: deletedProject.id }, data: { goalId: goal.id } });

  const review = await buildWeeklyReview(me, NOW);
  assert.ok(!review.goalsMoved.some((g) => g.id === theirs.id), "another account's goal");
  assert.ok(!review.goalsMoved.some((g) => g.id === gone.id), "a deleted goal");
  assert.ok(!review.goalsMoved.some((g) => g.id === goal.id), "a task through a deleted project does not count for its goal");
});

test("courses: tasks finished this week per live course, and a deleted or another account's course is left out", async () => {
  const me = await newUser();
  const other = await newUser();
  const course = await prisma.course.create({ data: { userId: me, code: "CMP2003", title: "Algorithms", term: "Fall" } });
  await prisma.task.create({ data: { userId: me, title: "Lab", status: "done", completedAt: daysAgo(3), courseId: course.id } });
  await prisma.task.create({ data: { userId: me, title: "Essay", status: "done", completedAt: daysAgo(4), courseId: course.id } });
  await prisma.task.create({ data: { userId: me, title: "Old", status: "done", completedAt: daysAgo(30), courseId: course.id } });
  const theirs = await prisma.course.create({ data: { userId: other, code: "X1", title: "Theirs", term: "Fall" } });
  await prisma.task.create({ data: { userId: other, title: "Theirs", status: "done", completedAt: daysAgo(1), courseId: theirs.id } });
  const gone = await prisma.course.create({ data: { userId: me, code: "OLD1", title: "Gone", term: "Fall", deletedAt: daysAgo(1) } });
  await prisma.task.create({ data: { userId: me, title: "For gone", status: "done", completedAt: daysAgo(1), courseId: gone.id } });

  const review = await buildWeeklyReview(me, NOW);
  assert.equal(review.coursesMoved.find((c) => c.id === course.id)?.doneTasks, 2, "two this week, the one from last month is not counted");
  assert.ok(!review.coursesMoved.some((c) => c.id === theirs.id));
  assert.ok(!review.coursesMoved.some((c) => c.id === gone.id));
});

test("assessments due next week show only if unscored, on the caller's live courses", async () => {
  const me = await newUser();
  const other = await newUser();
  const course = await prisma.course.create({ data: { userId: me, code: "MAT1", title: "Calculus", term: "Fall" } });
  const due = daysAhead(3);
  const unscored = await prisma.assessment.create({ data: { userId: me, courseId: course.id, title: "Midterm", weight: 30, dueDate: due } });
  await prisma.assessment.create({ data: { userId: me, courseId: course.id, title: "Quiz done", weight: 5, score: 9, maxScore: 10, dueDate: due } });
  await prisma.assessment.create({ data: { userId: me, courseId: course.id, title: "Next month", weight: 5, dueDate: daysAhead(40) } });
  const theirCourse = await prisma.course.create({ data: { userId: other, code: "Y1", title: "Theirs", term: "Fall" } });
  await prisma.assessment.create({ data: { userId: other, courseId: theirCourse.id, title: "Theirs exam", weight: 50, dueDate: due } });

  const review = await buildWeeklyReview(me, NOW);
  assert.deepEqual(review.assessmentsDue.map((a) => a.id), [unscored.id]);
  assert.equal(review.assessmentsDue[0].courseCode, "MAT1");
});

test("a task of mine linked to another account's goal never shows that goal (the ownership check is not the only layer)", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await prisma.goal.create({ data: { userId: other, title: "Their goal", category: "career" } });
  // Written straight into the database, as a bad write path would: the goal id is not the caller's.
  await prisma.task.create({ data: { userId: me, title: "Mine, linked across", status: "done", completedAt: daysAgo(1), goalId: theirs.id } });
  const review = await buildWeeklyReview(me, NOW);
  assert.ok(!review.goalsMoved.some((g) => g.id === theirs.id), "another account's goal is not listed");
});

test("an unscored assessment on a deleted course is not due", async () => {
  const me = await newUser();
  const gone = await prisma.course.create({ data: { userId: me, code: "DEL9", title: "Deleted", term: "Fall", deletedAt: daysAgo(1) } });
  await prisma.assessment.create({ data: { userId: me, courseId: gone.id, title: "Ghost exam", weight: 20, dueDate: daysAhead(2) } });
  const review = await buildWeeklyReview(me, NOW);
  assert.equal(review.assessmentsDue.length, 0);
});
