/**
 * The calendar feed against a real Postgres, DB-only like the rest of this tier. Each test makes its
 * own accounts so one test's rows cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { parseIcs } from "@/lib/ics";
import { hashFeedToken, newFeedToken } from "@/lib/calendar-feed";
import { buildFullExport } from "@/services/export-service";
import { buildFeedForToken, createFeedLink, getFeedLinkStatus, revokeFeedLink } from "@/services/calendar-feed-service";

const users: string[] = [];
async function newUser(withProfile = false): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `feed-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  if (withProfile) await prisma.userProfile.create({ data: { userId: user.id } });
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const now = new Date("2026-11-06T12:00:00Z");
const at = (days: number, hour = 9) => new Date(now.getTime() + days * 86_400_000 + (hour - 12) * 3_600_000);
const addEvent = (userId: string, title: string, days: number, extra: Record<string, unknown> = {}) =>
  prisma.event.create({ data: { userId, title, startTime: at(days), endTime: at(days, 10), ...extra } });
const addTask = (userId: string, title: string, extra: Record<string, unknown> = {}) => prisma.task.create({ data: { userId, title, ...extra } });
const lines = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
const summaries = (ics: string) => lines(ics).filter((l) => l.startsWith("SUMMARY:")).map((l) => l.slice(8));

async function feedOf(userId: string): Promise<string> {
  const { token } = await createFeedLink(userId);
  const feed = await buildFeedForToken(token, now);
  assert.ok(feed, "the token resolves");
  return feed;
}

test("a link shows that account's events and open dated tasks, and nothing else", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const feed = await prisma.calendarSubscription.create({ data: { userId: alice.id, name: "Timetable", url: "https://example.com/t.ics" } });

  await addEvent(alice.id, "Alice lecture", 3, { location: "Hall C", description: "PRIVATE-DESCRIPTION" });
  await addEvent(alice.id, "Alice long ago", -40);
  await addEvent(alice.id, "Alice far away", 400);
  await addEvent(alice.id, "Imported class", 4, { subscriptionId: feed.id, externalUid: "x@y" });
  await addTask(alice.id, "Alice block", { scheduledStart: at(5), scheduledEnd: at(5, 11) });
  await addTask(alice.id, "Alice due", { dueDate: at(6) });
  await addTask(alice.id, "Alice done", { dueDate: at(6), status: "done" });
  await addTask(alice.id, "Alice trashed", { dueDate: at(6), deletedAt: new Date() });
  await addTask(alice.id, "Alice undated");
  await addTask(alice.id, "Alice overdue long ago", { dueDate: at(-40) });
  await addTask(alice.id, "Alice due next year", { dueDate: at(400) });
  await addTask(alice.id, "Alice old block", { scheduledStart: at(-40), scheduledEnd: at(-40, 10) });
  await addTask(alice.id, "Alice far block", { scheduledStart: at(400), scheduledEnd: at(400, 10) });
  await addTask(alice.id, "Alice overdue last week", { dueDate: at(-7) });
  await addTask(alice.id, "Alice stale block due soon", { scheduledStart: at(-40), scheduledEnd: at(-40, 10), dueDate: at(8) });
  await addEvent(bob.id, "Bob secret meeting", 3);
  await addTask(bob.id, "Bob secret task", { dueDate: at(6) });

  const ics = await feedOf(alice.id);
  assert.deepEqual(summaries(ics).sort(), ["Alice lecture", "Due: Alice due", "Due: Alice overdue last week", "Due: Alice stale block due soon", "Task: Alice block"].sort());
  for (const secret of ["Bob secret", "PRIVATE-DESCRIPTION", "Alice done", "Alice trashed", "Alice undated", "Alice long ago", "Alice far away", "Imported class", "overdue long ago", "due next year", "Alice old block", "Alice far block"]) {
    assert.ok(!ics.includes(secret), `the feed holds "${secret}"`);
  }
  assert.ok(lines(ics).includes("LOCATION:Hall C"), "an event's place is shown");
  assert.equal(parseIcs(ics).length, 5, "the feed parses back");
});

test("the token is nowhere in the database: only its hash is kept", async () => {
  const user = await newUser(true);
  const { token } = await createFeedLink(user.id);
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(profile.calendarFeedHash, hashFeedToken(token));
  assert.ok(profile.calendarFeedCreatedAt instanceof Date);
  assert.ok(!JSON.stringify(profile).includes(token));
  const rows = await prisma.$queryRaw<{ found: number }[]>`SELECT count(*)::int AS found FROM "UserProfile" p WHERE row_to_json(p)::text LIKE ${"%" + token + "%"}`;
  assert.equal(rows[0].found, 0);
  const rowsOfTheUser = await prisma.$queryRaw<{ text: string }[]>`SELECT row_to_json(p)::text AS text FROM "UserProfile" p WHERE p."userId" = ${user.id}`;
  assert.ok(!rowsOfTheUser[0].text.includes(token));
});

test("making a new link ends the old one at once, and turning it off ends the new one", async () => {
  const user = await newUser();
  await addEvent(user.id, "Still here", 2);
  const first = await createFeedLink(user.id);
  assert.ok(await buildFeedForToken(first.token, now));
  const second = await createFeedLink(user.id);
  assert.notEqual(first.token, second.token);
  assert.equal(await buildFeedForToken(first.token, now), null, "the old address is dead");
  assert.ok(await buildFeedForToken(second.token, now));
  await revokeFeedLink(user.id);
  assert.equal(await buildFeedForToken(second.token, now), null, "turned off");
  assert.equal(await prisma.userProfile.count({ where: { userId: user.id, calendarFeedHash: { not: null } } }), 0);
});

test("the status follows creating, renewing and turning off, and an account with no profile row can make a link", async () => {
  const user = await newUser(false);
  assert.deepEqual(await getFeedLinkStatus(user.id), { active: false, createdAt: null });
  assert.equal(await prisma.userProfile.count({ where: { userId: user.id } }), 0, "reading the status made no row");
  const made = await createFeedLink(user.id);
  const status = await getFeedLinkStatus(user.id);
  assert.equal(status.active, true);
  assert.equal(+(status.createdAt as Date), +made.createdAt);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const renewed = await createFeedLink(user.id);
  assert.ok(+renewed.createdAt > +made.createdAt, "renewing dates the new link");
  await revokeFeedLink(user.id);
  assert.deepEqual(await getFeedLinkStatus(user.id), { active: false, createdAt: null });
  await revokeFeedLink(user.id); // turning off what is off is fine
});

test("an address that is not a live token of anybody gives nothing, whatever it looks like", async () => {
  const user = await newUser();
  await createFeedLink(user.id);
  for (const bad of ["", "short", "../etc/passwd", newFeedToken(), "A".repeat(43), "A".repeat(44), `${"A".repeat(42)}+`, "%00".repeat(20), "x".repeat(100_000)]) {
    assert.equal(await buildFeedForToken(bad, now), null, JSON.stringify(bad.slice(0, 40)));
  }
});

test("two accounts never share a token, and each token shows only its own account", async () => {
  const a = await newUser();
  const b = await newUser();
  await addEvent(a.id, "Only A", 2);
  await addEvent(b.id, "Only B", 2);
  const ta = await createFeedLink(a.id);
  const tb = await createFeedLink(b.id);
  assert.notEqual(ta.token, tb.token);
  assert.deepEqual(summaries((await buildFeedForToken(ta.token, now)) as string), ["Only A"]);
  assert.deepEqual(summaries((await buildFeedForToken(tb.token, now)) as string), ["Only B"]);
});

test("hostile titles arrive as escaped, folded lines and the feed still parses", async () => {
  const user = await newUser();
  const evil = "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nATTENDEE:mailto:x@example.com";
  await addEvent(user.id, evil, 2, { location: `Room\r\nDESCRIPTION:injected` });
  await addEvent(user.id, "ğ".repeat(100_000), 3);
  await addTask(user.id, "Task, with; separators \\ and 😀", { dueDate: at(4) });
  const ics = await feedOf(user.id);
  const l = lines(ics);
  assert.equal(l.filter((x) => x === "BEGIN:VEVENT").length, 3);
  assert.ok(!l.some((x) => x.startsWith("ATTENDEE") || x.startsWith("DESCRIPTION")));
  for (const raw of ics.split("\r\n")) assert.ok(Buffer.byteLength(raw) <= 75);
  assert.equal(parseIcs(ics).length, 3);
});

test("an account with thousands of events and tasks gets a bounded feed in bounded time", async () => {
  const user = await newUser();
  await prisma.event.createMany({ data: Array.from({ length: 2500 }, (_, i) => ({ userId: user.id, title: `Event ${i}`, startTime: at(1 + (i % 300)), endTime: at(1 + (i % 300), 10) })) });
  await prisma.task.createMany({ data: Array.from({ length: 2500 }, (_, i) => ({ userId: user.id, title: `Task ${i}`, dueDate: at(1 + (i % 300)) })) });
  const { token } = await createFeedLink(user.id);
  const start = performance.now();
  const ics = (await buildFeedForToken(token, now)) as string;
  const took = performance.now() - start;
  const s = summaries(ics);
  assert.equal(s.filter((x) => x.startsWith("Event ")).length, 2000);
  assert.equal(s.filter((x) => x.startsWith("Due: Task ")).length, 2000);
  assert.ok(took < 5000, `took ${took.toFixed(0)} ms`);
});

test("the JSON export carries when the link was made but never its hash", async () => {
  const user = await newUser();
  const { token } = await createFeedLink(user.id);
  const file = await buildFullExport(user.id);
  const text = JSON.stringify(file);
  assert.ok(!text.includes(hashFeedToken(token)) && !text.includes(token));
  assert.ok(!("calendarFeedHash" in (file.profile as object)));
  assert.ok((file.profile as { calendarFeedCreatedAt: unknown }).calendarFeedCreatedAt);
});

test("a missing or empty account id is refused before any query", async () => {
  for (const bad of [undefined, null, "", 42]) {
    for (const fn of [createFeedLink, revokeFeedLink, getFeedLinkStatus]) {
      await assert.rejects(() => fn(bad as never), (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR", `${fn.name} ${String(bad)}`);
    }
  }
});
