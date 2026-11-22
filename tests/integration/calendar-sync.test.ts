/** Scheduled calendar sync (ROADMAP item 54) against a real Postgres: which calendars are due, what a failure records, and that nothing leaves its owner. */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { SYNC_INTERVAL_MS } from "@/lib/calendar-source";
import * as calendarRepository from "@/repositories/calendar-repository";
import { MAX_PER_TICK, runCalendarSyncTick, syncSubscription } from "@/services/calendar-service";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `sync-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const NOW = new Date("2026-11-22T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const sub = (userId: string, over: Record<string, unknown> = {}) =>
  prisma.calendarSubscription.create({ data: { userId, name: "Timetable", url: "https://calendar.google.com/calendar/ical/me/private-secret123/basic.ics", ...over } });

test("the tick reads calendars never tried or last tried an interval ago, longest waiting first, and leaves fresh ones", async () => {
  const me = await newUser();
  const never = await sub(me);
  const stale = await sub(me, { lastAttemptAt: ago(SYNC_INTERVAL_MS + 60_000) });
  const stalest = await sub(me, { lastAttemptAt: ago(SYNC_INTERVAL_MS * 5) });
  const fresh = await sub(me, { lastAttemptAt: ago(SYNC_INTERVAL_MS - 60_000) });
  const seen: string[] = [];
  const r = await runCalendarSyncTick(NOW, async (_user, id) => { seen.push(id); }, 10_000);
  const mine = seen.filter((id) => [never.id, stale.id, stalest.id, fresh.id].includes(id));
  assert.deepEqual(mine, [never.id, stalest.id, stale.id], "never tried first, then the longest waiting; the fresh one is not read");
  assert.ok(r.tried >= 3);
});

test("each calendar is read as its own owner's, and one that fails does not hold the others up", async () => {
  const a = await newUser();
  const b = await newUser();
  const sa = await sub(a);
  const sb = await sub(b);
  const calls: [string, string][] = [];
  const r = await runCalendarSyncTick(NOW, async (user, id) => {
    if ([sa.id, sb.id].includes(id)) calls.push([user, id]);
    if (id === sa.id) throw new AppError("INTEGRATION_ERROR", "down");
  }, 10_000);
  assert.deepEqual(calls.sort(), [[a, sa.id], [b, sb.id]].sort());
  assert.ok(r.failed >= 1);
});

test("a run reads at most MAX_PER_TICK calendars", async () => {
  const me = await newUser();
  await prisma.calendarSubscription.createMany({ data: Array.from({ length: MAX_PER_TICK + 5 }, (_, i) => ({ userId: me, name: `C${i}`, url: `https://example.com/${i}.ics` })) });
  let n = 0;
  await runCalendarSyncTick(NOW, async () => { n += 1; });
  assert.ok(n <= MAX_PER_TICK);
});

test("a failed sync records when and why, with no address in it, keeps the events of the last good sync, and waits its interval", async () => {
  const me = await newUser();
  const s = await sub(me, { url: "http://localhost:3200/secret-path-abc.ics" });
  const ev = await prisma.event.create({ data: { userId: me, title: "Kept class", startTime: ago(-3_600_000), endTime: ago(-7_200_000), subscriptionId: s.id, externalUid: "u1" } });
  await assert.rejects(syncSubscription(me, s.id), (e: unknown) => e instanceof AppError);
  const after1 = await prisma.calendarSubscription.findUniqueOrThrow({ where: { id: s.id } });
  assert.ok(after1.lastAttemptAt && after1.lastError);
  assert.ok(!/secret-path|localhost|http/i.test(after1.lastError ?? ""), after1.lastError ?? "");
  assert.equal(after1.lastSyncedAt, null);
  assert.ok(await prisma.event.findUnique({ where: { id: ev.id } }), "the events of the last good sync are kept");
  const seen: string[] = [];
  await runCalendarSyncTick(new Date(), async (_u, id) => { seen.push(id); });
  assert.ok(!seen.includes(s.id), "a calendar that just failed is not hammered");
});

test("a good sync clears the last failure and counts as an attempt", async () => {
  const me = await newUser();
  const s = await sub(me, { lastError: "The calendar returned 500." });
  await calendarRepository.markSynced(me, s.id, 12);
  const row = await prisma.calendarSubscription.findUniqueOrThrow({ where: { id: s.id } });
  assert.deepEqual([row.lastError, row.lastEventCount, row.lastSyncedAt !== null, row.lastAttemptAt !== null], [null, 12, true, true]);
});

test("another account's calendar, or one that no longer exists, is refused and nothing is recorded on it", async () => {
  const me = await newUser();
  const them = await newUser();
  const theirs = await sub(them);
  await assert.rejects(syncSubscription(me, theirs.id), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  await assert.rejects(syncSubscription(me, randomUUID()), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  const row = await prisma.calendarSubscription.findUniqueOrThrow({ where: { id: theirs.id } });
  assert.deepEqual([row.lastAttemptAt, row.lastError], [null, null]);
});

test("recording a failure on another account's calendar writes nothing (the repository is scoped on its own)", async () => {
  const me = await newUser();
  const them = await newUser();
  const theirs = await sub(them);
  await calendarRepository.markSyncFailed(me, theirs.id, "forged", NOW);
  const row = await prisma.calendarSubscription.findUniqueOrThrow({ where: { id: theirs.id } });
  assert.deepEqual([row.lastAttemptAt, row.lastError], [null, null]);
});
