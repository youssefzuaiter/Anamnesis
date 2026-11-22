/**
 * Assignments from a pasted post (ROADMAP item 55) against a real Postgres. The model is a scripted fake. Checked: the proposal is held to the post,
 * the code fallback when the model is off, only the caller's own course is used, nothing is written before confirming, and a confirmed add is all or none.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { addTasksFromPost, proposeFromPost } from "@/services/post-intake-service";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `post-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const NOW = new Date(2026, 10, 22, 10, 0);
const POST = "Hi all. Assignment 2 is due on Friday 4 December at 23:59 on the course page. Lab report 3 is due tomorrow. Have a good week!";
const course = (userId: string, code = "CMP2003") => prisma.course.create({ data: { userId, code, title: "ML", term: "Fall 2026" } });
const answer = {
  items: [
    { title: "Assignment 2", quote: "Assignment 2 is due on Friday 4 December at 23:59 on the course page." },
    { title: "Invented", quote: "Bring a laptop to every class." },
  ],
};

test("a proposal is the items the post backs up, dated by code, and nothing is written", async () => {
  const me = await newUser();
  const p = await proposeFromPost(me, POST, null, { complete: async () => answer, now: NOW });
  assert.equal(p.engine, "model");
  assert.deepEqual(p.rows.map((r) => [r.title, r.dueDate, r.existing]), [["Assignment 2", "2026-12-04", false]]);
  assert.equal(await prisma.task.count({ where: { userId: me } }), 0);
});

test("with the assistant unavailable or unusable, rules read the post", async () => {
  const me = await newUser();
  for (const complete of [
    async () => { throw new AppError("AI_UNAVAILABLE", "off"); },
    async () => ({ nonsense: true }),
  ]) {
    const p = await proposeFromPost(me, POST, null, { complete, now: NOW });
    assert.equal(p.engine, "rules");
    assert.deepEqual(p.rows.map((r) => [r.title, r.dueDate]), [["Assignment 2", "2026-12-04"], ["Lab report 3", "2026-11-23"]]);
  }
  const forced = await proposeFromPost(me, POST, null, { complete: async () => { throw new Error("must not be called"); }, now: NOW, engine: "code" });
  assert.equal(forced.engine, "rules");
});

test("an unexpected failure is not swallowed as a fallback", async () => {
  const me = await newUser();
  await assert.rejects(proposeFromPost(me, POST, null, { complete: async () => { throw new Error("boom"); }, now: NOW }), /boom/);
});

test("an empty post is refused", async () => {
  const me = await newUser();
  await assert.rejects(proposeFromPost(me, "  \n ", null, { now: NOW }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_ERROR");
});

test("the course is the one chosen or the one the post names, and only the caller's own", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await course(me);
  const theirs = await course(other);
  const named = await proposeFromPost(me, `CMP 2003: ${POST}`, null, { complete: async () => answer, now: NOW });
  assert.equal(named.courseId, mine.id);
  const chosen = await proposeFromPost(me, POST, mine.id, { complete: async () => answer, now: NOW });
  assert.equal(chosen.courseId, mine.id);
  await assert.rejects(proposeFromPost(me, POST, theirs.id, { complete: async () => answer, now: NOW }), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  const alone = await proposeFromPost(other, `CMP2003 ${POST}`, null, { complete: async () => answer, now: NOW });
  assert.equal(alone.courseId, theirs.id, "another account's course code never resolves for me");
});

test("a task the person already has starts unticked", async () => {
  const me = await newUser();
  await prisma.task.create({ data: { userId: me, title: "assignment 2", dueDate: new Date(2026, 11, 4, 23, 59), status: "todo" } });
  const p = await proposeFromPost(me, POST, null, { complete: async () => answer, now: NOW });
  assert.equal(p.rows[0].existing, true);
});

test("a confirmed add makes the caller's own tasks tagged post; another account's course writes nothing", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await course(me);
  const theirs = await course(other);
  const rows = [
    { title: "Assignment 2", dueDate: "2026-12-04", courseId: mine.id, note: "From a pasted post" },
    { title: "Read ch 5", dueDate: null, courseId: null, note: "" },
  ];
  assert.deepEqual(await addTasksFromPost(me, rows), { created: 2 });
  const tasks = await prisma.task.findMany({ where: { userId: me }, orderBy: { title: "asc" } });
  assert.deepEqual(tasks.map((t) => [t.title, t.tags, t.courseId]), [["Assignment 2", ["post"], mine.id], ["Read ch 5", ["post"], null]]);
  assert.equal(tasks[0].dueDate?.getHours(), 23);

  await assert.rejects(addTasksFromPost(me, [rows[1], { ...rows[0], courseId: theirs.id }]), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  assert.equal(await prisma.task.count({ where: { userId: me } }), 2, "a refused add wrote nothing");
});
