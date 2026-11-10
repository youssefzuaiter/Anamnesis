/**
 * Reminders sent while no tab is open, against a real Postgres. The transport is a capturing `Publish`
 * (the database, the planner and the claiming are real; only the HTTP hop to ntfy is replaced, and that
 * hop has its own tests in ntfy.test.ts). Every test makes its own accounts; a tick serves every account
 * with push on, so assertions look only at this test's topics.
 *
 * Times are built with local-time constructors, so the file passes in any time zone.
 * The dates are years ahead on purpose: the scheduler test's real-clock tick runs at the same time over
 * every account, and on a day these dates matched it claimed the digest first (CI, 2026-11-10).
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import type { Publish, PushMessage } from "@/lib/ntfy";
import * as push from "@/services/reminder-push-service";

const users: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `push-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const endOfDay = (y: number, m: number, d: number) => new Date(y, m - 1, d, 23, 59, 59, 999);

function capture(fail: (message: PushMessage) => boolean = () => false) {
  const calls: PushMessage[] = [];
  const publish: Publish = async (message) => {
    calls.push(message);
    if (fail(message)) throw new Error("ntfy answered 503");
  };
  return { calls, publish };
}

async function pushOn(userId: string, over: Partial<{ leadMinutes: number; digestHour: number; showTitles: boolean }> = {}) {
  const settings = await push.setPushSettings(userId, { enabled: true, leadMinutes: 15, digestHour: 8, showTitles: true, ...over });
  return settings.topic!;
}
const mine = (calls: PushMessage[], topic: string) => calls.filter((call) => call.topic === topic);
const refused = (message: RegExp) => (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR" && message.test(error.message);

// --- Settings -----------------------------------------------------------------------------------------

test("push is off until turned on, and turning it on makes one private topic that stays", async () => {
  const user = await newUser();
  const saved = await push.setPushSettings(user.id, { enabled: false, leadMinutes: 30, digestHour: 9, showTitles: true });
  assert.equal(saved.topic, null, "saving the choices with push off makes no topic");
  await push.setPushSettings(user.id, { enabled: false, leadMinutes: 15, digestHour: 8, showTitles: true });
  assert.deepEqual(await push.getPushSettings(user.id), {
    enabled: false,
    prefs: { leadMinutes: 15, digestHour: 8, showTitles: true },
    topic: null,
    lastError: null,
  });
  const topic = await pushOn(user.id, { leadMinutes: 30, digestHour: 7, showTitles: false });
  assert.match(topic, /^anamnesis-[a-z2-7]{24}$/);
  const again = await push.setPushSettings(user.id, { enabled: false, leadMinutes: 5, digestHour: 12, showTitles: true });
  assert.deepEqual([again.enabled, again.topic, again.prefs], [false, topic, { leadMinutes: 5, digestHour: 12, showTitles: true }]);
  assert.equal(await pushOn(user.id), topic, "turning it on again keeps the topic the phone subscribed to");
  const other = await newUser();
  assert.notEqual(await pushOn(other.id), topic);
});

test("a time outside the choices is refused and nothing changes", async () => {
  const user = await newUser();
  const base = { enabled: true, leadMinutes: 15, digestHour: 8, showTitles: true };
  for (const bad of [{ leadMinutes: 7 }, { leadMinutes: 0 }, { leadMinutes: -15 }, { digestHour: 5 }, { digestHour: 13 }, { digestHour: 8.5 }]) {
    await assert.rejects(() => push.setPushSettings(user.id, { ...base, ...bad }), refused(/not one of the choices/), JSON.stringify(bad));
  }
  assert.equal((await push.getPushSettings(user.id)).enabled, false);
});

// --- The digest ---------------------------------------------------------------------------------------

test("the digest waits for its hour, names only open tasks of this account, and goes once", async () => {
  const user = await newUser();
  const theirs = await newUser();
  const topic = await pushOn(user.id);
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "Overdue essay", dueDate: endOfDay(2031, 11, 9) },
      { userId: user.id, title: "Problem set", dueDate: endOfDay(2031, 11, 10) },
      { userId: user.id, title: "Tomorrow", dueDate: endOfDay(2031, 11, 11) },
      { userId: user.id, title: "Done already", dueDate: endOfDay(2031, 11, 10), status: "done" },
      { userId: user.id, title: "In the trash", dueDate: endOfDay(2031, 11, 10), deletedAt: new Date() },
      { userId: theirs.id, title: "Someone else's", dueDate: endOfDay(2031, 11, 10) },
    ],
  });
  const { calls, publish } = capture();
  await push.runReminderTick(local(2031, 11, 10, 7, 59), publish);
  assert.deepEqual(mine(calls, topic), []);
  await push.runReminderTick(local(2031, 11, 10, 8, 5), publish);
  assert.deepEqual(mine(calls, topic), [{ topic, title: "Due today", body: "Overdue essay, Problem set" }]);
  const [row] = await prisma.reminderDelivery.findMany({ where: { userId: user.id } });
  assert.deepEqual([row.key, row.attempts, row.sentAt?.getTime(), row.lastError], ["digest:2031-11-10", 1, local(2031, 11, 10, 8, 5).getTime(), null]);
  await push.runReminderTick(local(2031, 11, 10, 8, 6), publish);
  await push.runReminderTick(local(2031, 11, 10, 21, 0), publish);
  assert.equal(mine(calls, topic).length, 1, "once a day");
  await push.runReminderTick(local(2031, 11, 11, 8, 0), publish);
  assert.equal(mine(calls, topic).length, 2, "the next day has its own");
});

test("two schedulers ticking at the same moment send the digest once", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id);
  await prisma.task.create({ data: { userId: user.id, title: "Race", dueDate: endOfDay(2031, 11, 12) } });
  // A slow transport keeps the first send in flight while the other ticks try to claim it.
  const calls: PushMessage[] = [];
  const slow: Publish = async (message) => {
    calls.push(message);
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  const now = local(2031, 11, 12, 9, 0);
  await Promise.all([push.runReminderTick(now, slow), push.runReminderTick(now, slow), push.runReminderTick(now, slow)]);
  assert.equal(mine(calls, topic).length, 1);
});

test("hidden titles reach the phone hidden", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id, { showTitles: false });
  await prisma.task.create({ data: { userId: user.id, title: "Private appointment", dueDate: endOfDay(2031, 11, 13) } });
  const { calls, publish } = capture();
  await push.runReminderTick(local(2031, 11, 13, 9, 0), publish);
  assert.deepEqual(mine(calls, topic), [{ topic, title: "Due today", body: "1 task due today" }]);
});

// --- Starts -------------------------------------------------------------------------------------------

test("an event or a planned task inside the lead time is announced once; what already began is not", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id, { leadMinutes: 15 });
  const now = local(2031, 11, 14, 10, 0);
  const feed = await prisma.calendarSubscription.create({ data: { userId: user.id, name: "Timetable", url: "https://example.com/t.ics" } });
  await prisma.event.createMany({
    data: [
      { userId: user.id, title: "Lecture", startTime: local(2031, 11, 14, 10, 10), endTime: local(2031, 11, 14, 11, 0) },
      { userId: user.id, title: "Imported lab", startTime: local(2031, 11, 14, 10, 12), endTime: local(2031, 11, 14, 11, 0), subscriptionId: feed.id, externalUid: "lab-1" },
      { userId: user.id, title: "Already started", startTime: local(2031, 11, 14, 9, 55), endTime: local(2031, 11, 14, 11, 0) },
      { userId: user.id, title: "Later today", startTime: local(2031, 11, 14, 12, 0), endTime: local(2031, 11, 14, 13, 0) },
    ],
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "Planned reading", scheduledStart: local(2031, 11, 14, 10, 14), scheduledEnd: local(2031, 11, 14, 11, 0) },
      { userId: user.id, title: "Planned but done", scheduledStart: local(2031, 11, 14, 10, 5), status: "done" },
      { userId: user.id, title: "Planned but trashed", scheduledStart: local(2031, 11, 14, 10, 5), deletedAt: new Date() },
    ],
  });
  const stranger = await newUser();
  await prisma.event.create({ data: { userId: stranger.id, title: "Someone else's meeting", startTime: local(2031, 11, 14, 10, 8), endTime: local(2031, 11, 14, 11, 0) } });
  await prisma.task.create({ data: { userId: stranger.id, title: "Someone else's plan", scheduledStart: local(2031, 11, 14, 10, 9) } });
  const { calls, publish } = capture();
  await push.runReminderTick(now, publish);
  assert.deepEqual(mine(calls, topic).map((call) => [call.title, call.body]), [
    ["Starts in 10 min", "Lecture"],
    ["Starts in 12 min", "Imported lab"],
    ["Starts in 14 min", "Planned reading"],
  ]);
  await push.runReminderTick(local(2031, 11, 14, 10, 1), publish);
  assert.equal(mine(calls, topic).length, 3, "each once");
});

test("a planned task moved to a later time is announced again for its new start", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id);
  const task = await prisma.task.create({ data: { userId: user.id, title: "Movable", scheduledStart: local(2031, 11, 15, 10, 10) } });
  const { calls, publish } = capture();
  await push.runReminderTick(local(2031, 11, 15, 10, 0), publish);
  await prisma.task.update({ where: { id: task.id }, data: { scheduledStart: local(2031, 11, 15, 10, 20) } });
  await push.runReminderTick(local(2031, 11, 15, 10, 9), publish);
  assert.deepEqual(mine(calls, topic).map((call) => call.title), ["Starts in 10 min", "Starts in 11 min"]);
});

test("nothing is sent with push off, or for an account that is gone", async () => {
  const off = await newUser();
  const topic = await pushOn(off.id);
  await push.setPushSettings(off.id, { enabled: false, leadMinutes: 15, digestHour: 8, showTitles: true });
  await prisma.task.create({ data: { userId: off.id, title: "Due", dueDate: endOfDay(2031, 11, 16) } });
  const gone = await newUser();
  const goneTopic = await pushOn(gone.id);
  await prisma.task.create({ data: { userId: gone.id, title: "Due", dueDate: endOfDay(2031, 11, 16) } });
  await prisma.user.delete({ where: { id: gone.id } });
  const { calls, publish } = capture();
  await push.runReminderTick(local(2031, 11, 16, 9, 0), publish);
  assert.deepEqual([mine(calls, topic), mine(calls, goneTopic)], [[], []]);
});

// --- Failures -----------------------------------------------------------------------------------------

test("a failed send is retried on later ticks, shown in settings until it goes, and never more than three tries", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id);
  await prisma.task.create({ data: { userId: user.id, title: "Flaky", dueDate: endOfDay(2031, 11, 17) } });
  let down = true;
  const { calls, publish } = capture((message) => message.topic === topic && down);
  await push.runReminderTick(local(2031, 11, 17, 9, 0), publish);
  assert.equal((await push.getPushSettings(user.id)).lastError, "ntfy answered 503");
  down = false;
  await push.runReminderTick(local(2031, 11, 17, 9, 1), publish);
  assert.equal(mine(calls, topic).length, 2, "retried once and delivered");
  assert.equal((await push.getPushSettings(user.id)).lastError, null, "a delivered retry clears the error");
  await push.runReminderTick(local(2031, 11, 17, 9, 2), publish);
  assert.equal(mine(calls, topic).length, 2, "delivered means done");

  const stuck = await newUser();
  const stuckTopic = await pushOn(stuck.id);
  await prisma.task.create({ data: { userId: stuck.id, title: "Never", dueDate: endOfDay(2031, 11, 18) } });
  const always = capture((message) => message.topic === stuckTopic);
  for (let minute = 0; minute < 6; minute++) await push.runReminderTick(local(2031, 11, 18, 9, minute), always.publish);
  assert.equal(mine(always.calls, stuckTopic).length, 3);
});

test("one account's failure does not stop another's reminder in the same tick", async () => {
  const broken = await newUser();
  const fine = await newUser();
  const brokenTopic = await pushOn(broken.id);
  const fineTopic = await pushOn(fine.id);
  for (const user of [broken, fine]) await prisma.task.create({ data: { userId: user.id, title: "Due", dueDate: endOfDay(2031, 11, 19) } });
  const { calls, publish } = capture((message) => message.topic === brokenTopic);
  await push.runReminderTick(local(2031, 11, 19, 9, 0), publish);
  assert.equal(mine(calls, fineTopic).length, 1);
});

test("delivery rows older than 30 days are deleted, newer ones kept", async () => {
  const user = await newUser();
  const now = local(2031, 11, 20, 9, 0);
  const day = 86_400_000;
  await prisma.reminderDelivery.createMany({
    data: [
      { userId: user.id, key: "digest:old", attempts: 1, sentAt: now, createdAt: new Date(now.getTime() - 31 * day) },
      { userId: user.id, key: "digest:recent", attempts: 1, sentAt: now, createdAt: new Date(now.getTime() - 29 * day) },
    ],
  });
  await push.runReminderTick(now, capture().publish);
  const keys = (await prisma.reminderDelivery.findMany({ where: { userId: user.id } })).map((row) => row.key);
  assert.deepEqual(keys, ["digest:recent"]);
});

// --- The test button ----------------------------------------------------------------------------------

test("a test notification goes to this account's topic, and only when push is on", async () => {
  const user = await newUser();
  const { calls, publish } = capture();
  await assert.rejects(() => push.sendTestNotification(user.id, publish), refused(/Turn on reminders to your phone first/));
  const topic = await pushOn(user.id);
  await push.sendTestNotification(user.id, publish);
  assert.deepEqual(calls, [{ topic, title: "Anamnesis", body: "Reminders reach this device." }]);
});

test("a retry in flight is not taken by a second scheduler", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id);
  await prisma.task.create({ data: { userId: user.id, title: "Retry race", dueDate: endOfDay(2031, 11, 21) } });
  const first = capture((message) => message.topic === topic);
  await push.runReminderTick(local(2031, 11, 21, 9, 0), first.publish);
  const calls: PushMessage[] = [];
  const slow: Publish = async (message) => {
    calls.push(message);
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  const now = local(2031, 11, 21, 9, 1);
  await Promise.all([push.runReminderTick(now, slow), push.runReminderTick(now, slow)]);
  assert.equal(mine(calls, topic).length, 1, "one retry");
  const [row] = await prisma.reminderDelivery.findMany({ where: { userId: user.id } });
  assert.deepEqual([row.attempts, row.lastError, row.sentAt !== null], [2, null, true]);
});

test("a failed send does not stop the account's next reminder", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id);
  await prisma.task.create({ data: { userId: user.id, title: "Due", dueDate: endOfDay(2031, 11, 22) } });
  await prisma.event.create({ data: { userId: user.id, title: "Seminar", startTime: local(2031, 11, 22, 9, 10), endTime: local(2031, 11, 22, 10, 0) } });
  const { calls, publish } = capture((message) => message.topic === topic && message.title === "Due today");
  await push.runReminderTick(local(2031, 11, 22, 9, 0), publish);
  assert.deepEqual(mine(calls, topic).map((call) => call.title), ["Due today", "Starts in 10 min"]);
});

test("the test button is refused again once push is turned off", async () => {
  const user = await newUser();
  await pushOn(user.id);
  await push.setPushSettings(user.id, { enabled: false, leadMinutes: 15, digestHour: 8, showTitles: true });
  await assert.rejects(() => push.sendTestNotification(user.id, capture().publish), refused(/Turn on reminders to your phone first/));
});

test("the repository only lists starts after the moment asked for", async () => {
  const { listStarting } = await import("@/repositories/reminder-repository");
  const user = await newUser();
  await prisma.event.createMany({
    data: [
      { userId: user.id, title: "Before", startTime: local(2031, 11, 23, 8, 0), endTime: local(2031, 11, 23, 9, 0) },
      { userId: user.id, title: "At", startTime: local(2031, 11, 23, 9, 0), endTime: local(2031, 11, 23, 10, 0) },
      { userId: user.id, title: "After", startTime: local(2031, 11, 23, 9, 5), endTime: local(2031, 11, 23, 10, 0) },
    ],
  });
  const found = await listStarting(user.id, local(2031, 11, 23, 9, 0), local(2031, 11, 23, 9, 30));
  assert.deepEqual(found.map((item) => item.title), ["After"]);
});

test("an old failure stops being shown once a later reminder goes through", async () => {
  const user = await newUser();
  const topic = await pushOn(user.id);
  await prisma.task.create({ data: { userId: user.id, title: "Due", dueDate: endOfDay(2031, 11, 24) } });
  const down = capture((message) => message.topic === topic);
  for (let minute = 0; minute < 4; minute++) await push.runReminderTick(local(2031, 11, 24, 9, minute), down.publish);
  assert.equal((await push.getPushSettings(user.id)).lastError, "ntfy answered 503", "out of tries: shown");
  await prisma.event.create({ data: { userId: user.id, title: "Later", startTime: local(2031, 11, 24, 15, 10), endTime: local(2031, 11, 24, 16, 0) } });
  await push.runReminderTick(local(2031, 11, 24, 15, 0), capture().publish);
  assert.equal((await push.getPushSettings(user.id)).lastError, null, "a newer reminder was delivered");
});
