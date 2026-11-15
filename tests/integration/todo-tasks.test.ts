/** Turning a note's TODO lines into tasks, against a real Postgres (ROADMAP item 33). */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { proposeTodoTasks, createTodoTasks } from "@/services/todo-service";

const users: string[] = [];
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function newUser() {
  const user = await prisma.user.create({ data: { email: `todo-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user.id;
}
const refused = (code: string, message: RegExp) => (error: unknown) => error instanceof AppError && error.code === code && message.test(error.message);
const note = (userId: string, content: string, deletedAt: Date | null = null) =>
  prisma.note.create({ data: { userId, title: `Plan ${randomUUID().slice(0, 6)}`, content, tags: [], deletedAt } });
const task = (userId: string, title: string, extra: { status?: string; deletedAt?: Date | null } = {}) =>
  prisma.task.create({ data: { userId, title, ...extra } });

test("a line is offered unless the account already has a task with that title, open, done or trashed", async () => {
  const me = await newUser();
  const n = await note(me, "- [ ] Email Ada\n- [ ] Book the lab\nTODO: Read chapter 3\nTODO: Old job");
  await task(me, "email ada");
  await task(me, "Book the lab", { status: "done" });
  await task(me, "Old job", { deletedAt: new Date() });
  assert.deepEqual(await proposeTodoTasks(me, n.id), ["Read chapter 3"]);
});

test("another account's task with the same title does not stop a line from being offered", async () => {
  const me = await newUser();
  const other = await newUser();
  await task(other, "Email Ada");
  const n = await note(me, "- [ ] Email Ada");
  assert.deepEqual(await proposeTodoTasks(me, n.id), ["Email Ada"]);
});

test("confirming creates the chosen tasks, on the note's course, and only lines the server finds in the note", async () => {
  const me = await newUser();
  const course = await prisma.course.create({ data: { userId: me, code: "CMP1", title: "Intro", term: "Fall" } });
  const n = await prisma.note.create({ data: { userId: me, title: "Lecture", content: "- [ ] Read paper\nTODO: Sketch design", tags: [], courseId: course.id } });
  // The browser may send anything; only the note's own lines can become tasks.
  const made = await createTodoTasks(me, n.id, ["Read paper", "Sketch design", "A title the note never had", "<img src=x onerror=alert(1)>"]);
  assert.equal(made, 2);
  const titles = (await prisma.task.findMany({ where: { userId: me }, select: { title: true, courseId: true } }));
  assert.deepEqual(titles.map((t) => t.title).sort(), ["Read paper", "Sketch design"]);
  assert.ok(titles.every((t) => t.courseId === course.id));
});

test("confirming twice creates nothing the second time, and a title sent twice makes one task", async () => {
  const me = await newUser();
  const n = await note(me, "- [ ] Once only");
  assert.equal(await createTodoTasks(me, n.id, ["Once only", "once only"]), 1);
  assert.equal(await createTodoTasks(me, n.id, ["Once only"]), 0);
  assert.equal(await prisma.task.count({ where: { userId: me, title: "Once only" } }), 1);
});

test("another account's note, a trashed note and a made-up id are all the same refusal, and nothing is created", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await note(other, "- [ ] Theirs");
  const trashed = await note(me, "- [ ] Trashed", new Date());
  for (const id of [theirs.id, trashed.id, randomUUID()]) {
    await assert.rejects(() => proposeTodoTasks(me, id), refused("RESOURCE_NOT_FOUND", /does not exist/));
    await assert.rejects(() => createTodoTasks(me, id, ["Theirs"]), refused("RESOURCE_NOT_FOUND", /does not exist/));
  }
  assert.equal(await prisma.task.count({ where: { userId: me } }), 0);
});

test("a line the person unticked is not created, even though the note still has it", async () => {
  const me = await newUser();
  const n = await note(me, "- [ ] Keep this\n- [ ] Drop this");
  assert.equal(await createTodoTasks(me, n.id, ["Keep this"]), 1);
  assert.deepEqual((await prisma.task.findMany({ where: { userId: me }, select: { title: true } })).map((t) => t.title), ["Keep this"]);
});
