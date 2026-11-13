/** The list of signed-in devices and ending them, against a real Postgres (ROADMAP item 27). */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import {
  startSession,
  isSessionValid,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  revokeAllSessions,
  MAX_SESSIONS,
  TOUCH_EVERY_MS,
} from "@/services/session-service";

const users: string[] = [];
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function newUser() {
  const user = await prisma.user.create({ data: { email: `sessions-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user.id;
}
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const NOW = new Date("2026-11-13T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const days = (n: number) => minutes(n * 24 * 60);
const refused = (code: string, message: RegExp) => (error: unknown) => error instanceof AppError && error.code === code && message.test(error.message);

test("a sign-in makes one row with a device label and nothing else about the device", async () => {
  const userId = await newUser();
  const sid = await startSession(userId, CHROME, NOW);
  const row = await prisma.authSession.findUniqueOrThrow({ where: { id: sid } });
  assert.deepEqual([row.userId, row.device], [userId, "Chrome on macOS"]);
  assert.ok(!JSON.stringify(row).includes("Mozilla"), "the user agent itself is not stored");
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: await startSession(userId, null, NOW) } })).device, "Unknown device");
});

test("a token is valid while its row exists for that account, and for nothing else", async () => {
  const [a, b] = [await newUser(), await newUser()];
  const sid = await startSession(a, CHROME, NOW);
  assert.equal(await isSessionValid({ userId: a, sessionId: sid }, NOW), true);
  assert.equal(await isSessionValid({ userId: b, sessionId: sid }, NOW), false, "another account's claim on the id");
  for (const bad of [undefined, null, "", "not-a-session", randomUUID(), 5, {}]) assert.equal(await isSessionValid({ userId: a, sessionId: bad }, NOW), false, String(bad));
  assert.equal(await isSessionValid({ userId: randomUUID(), sessionId: sid }, NOW), false);
  assert.equal(await isSessionValid({ userId: undefined, sessionId: sid }, NOW), false);
});

test("last seen is written at most once per interval", async () => {
  const userId = await newUser();
  const sid = await startSession(userId, CHROME, NOW);
  const seen = async () => (await prisma.authSession.findUniqueOrThrow({ where: { id: sid } })).lastSeenAt.getTime();
  await isSessionValid({ userId, sessionId: sid }, new Date(NOW.getTime() + TOUCH_EVERY_MS - 1000));
  assert.equal(await seen(), NOW.getTime(), "too soon to write again");
  const later = new Date(NOW.getTime() + TOUCH_EVERY_MS + 1000);
  await isSessionValid({ userId, sessionId: sid }, later);
  assert.equal(await seen(), later.getTime());
});

test("the list is the account's own, newest activity first, and says which one is this", async () => {
  const [me, other] = [await newUser(), await newUser()];
  const first = await startSession(me, CHROME, NOW);
  const second = await startSession(me, IPHONE, minutes(10));
  await startSession(other, CHROME, minutes(20));
  const list = await listSessions(me, first);
  assert.deepEqual(list.map((s) => [s.id, s.device, s.current]), [[second, "Safari on iPhone", false], [first, "Chrome on macOS", true]]);
  assert.deepEqual(await listSessions(me, null), list.map((s) => ({ ...s, current: false })));
});

test("ending one session ends only it; another account's id, a missing id and this device are refused", async () => {
  const [me, other] = [await newUser(), await newUser()];
  const here = await startSession(me, CHROME, NOW);
  const phone = await startSession(me, IPHONE, NOW);
  const theirs = await startSession(other, CHROME, NOW);
  await assert.rejects(() => revokeSession(me, theirs, here), refused("RESOURCE_NOT_FOUND", /does not exist/));
  await assert.rejects(() => revokeSession(me, randomUUID(), here), refused("RESOURCE_NOT_FOUND", /does not exist/));
  await assert.rejects(() => revokeSession(me, "not-a-session", here), refused("RESOURCE_NOT_FOUND", /does not exist/));
  await assert.rejects(() => revokeSession(me, here, here), refused("VALIDATION_ERROR", /Sign out/));
  assert.equal(await isSessionValid({ userId: other, sessionId: theirs }, NOW), true, "the other account's session is untouched");
  await revokeSession(me, phone, here);
  assert.equal(await isSessionValid({ userId: me, sessionId: phone }, NOW), false, "refused on its very next check");
  assert.equal(await isSessionValid({ userId: me, sessionId: here }, NOW), true);
});

test("ending the others keeps this one; ending all ends this one too; neither touches another account", async () => {
  const [me, other] = [await newUser(), await newUser()];
  const here = await startSession(me, CHROME, NOW);
  const a = await startSession(me, IPHONE, NOW);
  const b = await startSession(me, IPHONE, NOW);
  const theirs = await startSession(other, CHROME, NOW);
  assert.equal(await revokeOtherSessions(me, here), 2);
  assert.deepEqual([await isSessionValid({ userId: me, sessionId: here }, NOW), await isSessionValid({ userId: me, sessionId: a }, NOW), await isSessionValid({ userId: me, sessionId: b }, NOW)], [true, false, false]);
  assert.equal(await revokeAllSessions(me), 1);
  assert.equal(await isSessionValid({ userId: me, sessionId: here }, NOW), false);
  assert.equal(await isSessionValid({ userId: other, sessionId: theirs }, NOW), true);
  assert.equal(await revokeAllSessions(me), 0);
});

test("an account keeps at most the newest 50 sessions, and idle ones are pruned at the next sign-in", async () => {
  const userId = await newUser();
  const old = await startSession(userId, CHROME, days(-40));
  const ids: string[] = [];
  for (let i = 0; i < MAX_SESSIONS + 5; i++) ids.push(await startSession(userId, CHROME, minutes(i)));
  const left = await prisma.authSession.findMany({ where: { userId }, select: { id: true } });
  assert.equal(left.length, MAX_SESSIONS);
  assert.ok(!left.some((s) => s.id === old), "a session idle for 30 days is gone");
  assert.ok(!left.some((s) => ids.slice(0, 5).includes(s.id)), "the oldest are the ones dropped");
  assert.ok(ids.slice(5).every((id) => left.some((s) => s.id === id)));
});

test("a session idle for more than 30 days is pruned at the next sign-in, and one idle for 29 is kept", async () => {
  const userId = await newUser();
  const stale = await startSession(userId, CHROME, days(-31));
  const recent = await startSession(userId, CHROME, days(-29));
  const fresh = await startSession(userId, CHROME, NOW);
  const left = (await prisma.authSession.findMany({ where: { userId }, select: { id: true } })).map((s) => s.id).sort();
  assert.deepEqual(left, [recent, fresh].sort());
  assert.ok(!left.includes(stale));
});

test("a deleted account's sessions are gone with it", async () => {
  const userId = await newUser();
  const sid = await startSession(userId, CHROME, NOW);
  await prisma.user.delete({ where: { id: userId } });
  assert.equal(await isSessionValid({ userId, sessionId: sid }, NOW), false);
  assert.equal(await prisma.authSession.count({ where: { id: sid } }), 0);
});

test("the cost of the check on every request", async () => {
  const userId = await newUser();
  const sid = await startSession(userId, CHROME, NOW);
  const started = performance.now();
  for (let i = 0; i < 100; i++) await isSessionValid({ userId, sessionId: sid }, NOW);
  const per = (performance.now() - started) / 100;
  console.log(`isSessionValid: ${per.toFixed(2)} ms per call`);
  assert.ok(per < 25, `${per} ms`);
});
