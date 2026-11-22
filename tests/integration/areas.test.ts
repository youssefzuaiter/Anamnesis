/**
 * Areas (ROADMAP item 56) against a real Postgres: the setting's default and storage, and what Today shows for each area and filter. Nothing is
 * changed by a view: every test re-reads the rows.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getDashboard } from "@/services/dashboard-service";
import { getAreasSetting, setAreasSetting } from "@/repositories/profile-repository";
import { parseAreas } from "@/lib/areas";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `areas-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const NOW = new Date(2026, 10, 23, 10, 0);
const today = new Date(2026, 10, 23, 18, 0);

async function world() {
  const me = await newUser();
  const course = await prisma.course.create({ data: { userId: me, code: "CMP2003", title: "ML", term: "Fall 2026", credits: 6 } });
  const work = await prisma.project.create({ data: { userId: me, title: "Billing", category: "Work" } });
  const uni = await prisma.project.create({ data: { userId: me, title: "Thesis", category: "University" } });
  const personal = await prisma.project.create({ data: { userId: me, title: "Home", category: "Personal" } });
  const task = (title: string, extra: object = {}) => prisma.task.create({ data: { userId: me, title, dueDate: today, status: "todo", ...extra } });
  await task("Lab report", { courseId: course.id });
  await task("Review PR", { projectId: work.id });
  await task("Thesis outline", { projectId: uni.id });
  await task("Buy milk", { projectId: personal.id });
  await task("Loose task");
  await prisma.assessment.create({ data: { userId: me, courseId: course.id, title: "Midterm", weight: 30, dueDate: new Date(2026, 10, 27) } });
  const block = (title: string, extra: object) => task(title, { dueDate: null, scheduledStart: new Date(2026, 10, 23, 15), scheduledEnd: new Date(2026, 10, 23, 16), ...extra });
  await block("Study block", { courseId: course.id });
  await block("Work block", { projectId: work.id });
  await prisma.event.create({ data: { userId: me, title: "Lecture", startTime: new Date(2026, 10, 23, 12), endTime: new Date(2026, 10, 23, 13), courseId: course.id } });
  await prisma.event.create({ data: { userId: me, title: "Standup", startTime: new Date(2026, 10, 23, 14), endTime: new Date(2026, 10, 23, 14, 15), projectId: work.id } });
  return { me, course };
}
const titles = (list: { title: string }[]) => list.map((x) => x.title).sort();

test("an account that never chose is School, and the choice is stored per account", async () => {
  const a = await newUser();
  const b = await newUser();
  assert.equal(parseAreas(await getAreasSetting(a)), "school");
  await setAreasSetting(a, "both");
  assert.equal(await getAreasSetting(a), "both");
  assert.equal(await getAreasSetting(b), null, "another account is untouched");
  await setAreasSetting(a, "work");
  assert.equal(await getAreasSetting(a), "work");
});

test("both areas, no filter: everything, with School and Work named and unrelated items unnamed", async () => {
  const { me } = await world();
  const d = await getDashboard(me, NOW, { areas: "both", filter: "all" });
  assert.deepEqual(titles(d.todayTasks), ["Buy milk", "Lab report", "Loose task", "Review PR", "Thesis outline"]);
  assert.deepEqual(titles(d.todayEvents), ["Lecture", "Standup"]);
  const named = Object.fromEntries([...d.todayTasks, ...d.todayEvents].map((x) => [x.title, d.areaLabels[x.id] ?? null]));
  assert.deepEqual(named, { "Lab report": "School", "Review PR": "Work", "Thesis outline": "School", "Buy milk": null, "Loose task": null, Lecture: "School", Standup: "Work" });
});

test("the Work filter hides School items and study cards; items in neither area stay", async () => {
  const { me } = await world();
  const d = await getDashboard(me, NOW, { areas: "both", filter: "work" });
  assert.deepEqual(titles(d.todayTasks), ["Buy milk", "Loose task", "Review PR"]);
  assert.deepEqual(titles(d.todayEvents), ["Standup"]);
  assert.deepEqual(titles(d.todayBlocks), ["Work block"]);
  assert.equal(d.cardsDue, 0);
  assert.equal(d.nextAssessment, null);
  assert.equal((await getDashboard(me, NOW, { areas: "both", filter: "all" })).nextAssessment?.title, "Midterm");
  assert.deepEqual(titles(d.activeProjects), ["Billing", "Home"], "the University project is hidden; a Personal one belongs to neither area and stays");
});

test("the School filter hides Work items", async () => {
  const { me } = await world();
  const d = await getDashboard(me, NOW, { areas: "both", filter: "school" });
  assert.deepEqual(titles(d.todayTasks), ["Buy milk", "Lab report", "Loose task", "Thesis outline"]);
  assert.deepEqual(titles(d.todayEvents), ["Lecture"]);
  assert.deepEqual(titles(d.todayBlocks), ["Study block"]);
});

test("with only Work on, study things are not shown and no labels are made; data is unchanged", async () => {
  const { me } = await world();
  const before = await prisma.task.count({ where: { userId: me } });
  const d = await getDashboard(me, NOW, { areas: "work", filter: "all" });
  assert.equal(d.nextAssessment, null);
  assert.equal(d.examReadiness, null);
  assert.deepEqual(d.areaLabels, {});
  assert.equal(await prisma.task.count({ where: { userId: me } }), before);
  const school = await getDashboard(me, NOW, { areas: "school", filter: "all" });
  assert.equal(school.nextAssessment?.title, "Midterm");
});

test("another account's items never appear, whatever the filter", async () => {
  const { me } = await world();
  const other = await world();
  const d = await getDashboard(me, NOW, { areas: "both", filter: "all" });
  assert.ok(!d.todayTasks.some((t) => t.userId === other.me));
});
