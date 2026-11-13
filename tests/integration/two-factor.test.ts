/** Two-factor sign-in against a real Postgres (ROADMAP item 26). */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { hashPassword } from "@/lib/password";
import { base32Decode, totp, STEP_SECONDS } from "@/lib/totp";
import { seal } from "@/lib/secret-box";
import { hashRecoveryCode } from "@/lib/recovery-codes";
import { buildFullExport } from "@/services/export-service";
import {
  beginSetup,
  confirmSetup,
  checkSecondFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  twoFactorStatus,
} from "@/services/two-factor-service";

const PASSWORD = "a-long-enough-password";
const users: string[] = [];
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function newUser() {
  const user = await prisma.user.create({ data: { email: `twofactor-${randomUUID()}@test.local`, passwordHash: await hashPassword(PASSWORD) } });
  users.push(user.id);
  return user.id;
}
const NOW = 1_800_000_000_000;
const at = (steps: number) => NOW + steps * STEP_SECONDS * 1000;
const refused = (code: string, message: RegExp) => (error: unknown) => error instanceof AppError && error.code === code && message.test(error.message);

/** A user with two-factor on: the authenticator's key and the recovery codes. */
async function enabled() {
  const userId = await newUser();
  const setup = await beginSetup(userId, `x@test.local`);
  const key = base32Decode(setup.secret)!;
  const { recoveryCodes } = await confirmSetup(userId, totp(key, NOW), NOW);
  return { userId, key, recoveryCodes };
}

test("setup is pending until a right code confirms it, and a pending setup does not lock anyone out", async () => {
  const userId = await newUser();
  assert.deepEqual(await twoFactorStatus(userId), { enabled: false, recoveryCodesLeft: 0 });
  const setup = await beginSetup(userId, "me@test.local");
  assert.match(setup.uri, /^otpauth:\/\/totp\/Anamnesis:me%40test\.local\?secret=[A-Z2-7]{32}&/);
  assert.match(setup.qrSvg, /^<svg/);
  assert.equal((await twoFactorStatus(userId)).enabled, false);
  assert.equal(await checkSecondFactor(userId, undefined, NOW), true, "nothing is required before it is confirmed");

  const key = base32Decode(setup.secret)!;
  await assert.rejects(() => confirmSetup(userId, "000000", NOW), refused("VALIDATION_ERROR", /code is not right/));
  assert.equal((await twoFactorStatus(userId)).enabled, false);
  assert.equal(await checkSecondFactor(userId, undefined, NOW), true);

  const { recoveryCodes } = await confirmSetup(userId, totp(key, NOW), NOW);
  assert.equal(recoveryCodes.length, 10);
  assert.deepEqual(await twoFactorStatus(userId), { enabled: true, recoveryCodesLeft: 10 });
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.ok(row.totpEnabledAt && row.totpSecret && !row.totpSecret.includes(setup.secret), "the key is stored sealed");
  const stored = await prisma.recoveryCode.findMany({ where: { userId } });
  assert.equal(stored.length, 10);
  for (const code of recoveryCodes) assert.ok(stored.some((s) => s.codeHash === hashRecoveryCode(code)));
  assert.ok(stored.every((s) => !recoveryCodes.includes(s.codeHash)), "only hashes are kept");
});

test("setup cannot be confirmed without beginning, twice, or after it is on; a second begin replaces the key", async () => {
  const userId = await newUser();
  await assert.rejects(() => confirmSetup(userId, "123456", NOW), refused("VALIDATION_ERROR", /Start setup first/));
  const first = await beginSetup(userId, "a@test.local");
  const second = await beginSetup(userId, "a@test.local");
  assert.notEqual(first.secret, second.secret);
  await assert.rejects(() => confirmSetup(userId, totp(base32Decode(first.secret)!, NOW), NOW), refused("VALIDATION_ERROR", /code is not right/));
  await confirmSetup(userId, totp(base32Decode(second.secret)!, NOW), NOW);
  await assert.rejects(() => beginSetup(userId, "a@test.local"), refused("VALIDATION_ERROR", /already on/));
  await assert.rejects(() => confirmSetup(userId, totp(base32Decode(second.secret)!, at(1)), at(1)), refused("VALIDATION_ERROR", /already on/));
});

test("a code passes once, the next step passes, a stale or distant one does not, and nothing passes with none", async () => {
  const { userId, key } = await enabled();
  assert.equal(await checkSecondFactor(userId, totp(key, NOW), NOW), false, "the step that confirmed setup is spent");
  assert.equal(await checkSecondFactor(userId, totp(key, at(1)), at(1)), true);
  assert.equal(await checkSecondFactor(userId, totp(key, at(1)), at(1)), false, "replay");
  assert.equal(await checkSecondFactor(userId, totp(key, at(0)), at(1)), false, "an earlier step than the last accepted");
  assert.equal(await checkSecondFactor(userId, totp(key, at(5)), at(1)), false, "five steps away");
  for (const given of [undefined, null, "", "12345", "abcdef", 123456, ["123456"]]) assert.equal(await checkSecondFactor(userId, given, at(2)), false, JSON.stringify(given));
  assert.equal(await checkSecondFactor(userId, totp(key, at(2)), at(2)), true);
});

test("a recovery code works once, in any case and spacing, and not for another account", async () => {
  const a = await enabled();
  const b = await enabled();
  const code = a.recoveryCodes[0];
  assert.equal(await checkSecondFactor(b.userId, code, NOW), false, "another account's code");
  assert.equal(await checkSecondFactor(a.userId, code.toUpperCase().replaceAll("-", " "), NOW), true);
  assert.equal(await checkSecondFactor(a.userId, code, NOW), false, "used");
  assert.equal(await checkSecondFactor(a.userId, a.recoveryCodes[1], NOW), true, "the others still work");
  assert.equal(await checkSecondFactor(a.userId, "aaaa-aaaa-aaaa-aaaa", NOW), false);
  assert.deepEqual(await twoFactorStatus(a.userId), { enabled: true, recoveryCodesLeft: 8 });
  assert.equal(await checkSecondFactor(a.userId, totp(b.key, at(3)), at(3)), false, "another account's authenticator");
});

test("the same code or recovery code used at the same moment passes exactly once", async () => {
  const { userId, key, recoveryCodes } = await enabled();
  const same = await Promise.all(Array.from({ length: 8 }, () => checkSecondFactor(userId, totp(key, at(1)), at(1))));
  assert.equal(same.filter(Boolean).length, 1);
  const recovery = await Promise.all(Array.from({ length: 8 }, () => checkSecondFactor(userId, recoveryCodes[0], at(1))));
  assert.equal(recovery.filter(Boolean).length, 1);
});

test("a stored key that cannot be opened (the app secret changed) refuses codes but recovery codes still work", async () => {
  const { userId, key, recoveryCodes } = await enabled();
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: seal(key, "some-other-app-secret-entirely-1234567890") } });
  assert.equal(await checkSecondFactor(userId, totp(key, at(1)), at(1)), false);
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: "garbage" } });
  assert.equal(await checkSecondFactor(userId, totp(key, at(1)), at(1)), false);
  assert.equal(await checkSecondFactor(userId, recoveryCodes[0], at(1)), true);
});

test("turning off needs the password and a code, and clears everything", async () => {
  const { userId, key, recoveryCodes } = await enabled();
  await assert.rejects(() => disableTwoFactor(userId, "wrong password", totp(key, at(1)), at(1)), refused("FORBIDDEN", /password or code/));
  await assert.rejects(() => disableTwoFactor(userId, PASSWORD, "000000", at(1)), refused("FORBIDDEN", /password or code/));
  await assert.rejects(() => disableTwoFactor(userId, PASSWORD, undefined, at(1)), refused("FORBIDDEN", /password or code/));
  assert.equal((await twoFactorStatus(userId)).enabled, true, "refusals change nothing");
  await disableTwoFactor(userId, PASSWORD, recoveryCodes[0], at(1));
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.deepEqual([row.totpSecret, row.totpEnabledAt, row.totpLastStep], [null, null, null]);
  assert.equal(await prisma.recoveryCode.count({ where: { userId } }), 0);
  assert.equal(await checkSecondFactor(userId, undefined, at(2)), true);
});

test("regenerating replaces every recovery code and needs the password and a code", async () => {
  const { userId, key, recoveryCodes } = await enabled();
  await assert.rejects(() => regenerateRecoveryCodes(userId, "wrong password", totp(key, at(1)), at(1)), refused("FORBIDDEN", /password or code/));
  const fresh = await regenerateRecoveryCodes(userId, PASSWORD, totp(key, at(1)), at(1));
  assert.equal(fresh.recoveryCodes.length, 10);
  assert.equal(await checkSecondFactor(userId, recoveryCodes[0], at(2)), false, "an old code is gone");
  assert.equal(await checkSecondFactor(userId, fresh.recoveryCodes[0], at(2)), true);
});

test("guessing the code for a sensitive change is throttled, as a password is", async () => {
  const { userId, key } = await enabled();
  for (let i = 0; i < 5; i++) await assert.rejects(() => disableTwoFactor(userId, PASSWORD, "000000", at(1)), refused("FORBIDDEN", /password or code/));
  await assert.rejects(() => disableTwoFactor(userId, PASSWORD, totp(key, at(1)), at(1)), refused("RATE_LIMITED", /Too many attempts/));
  assert.equal((await twoFactorStatus(userId)).enabled, true);
});

test("deleting an account deletes its recovery codes", async () => {
  const { userId } = await enabled();
  await prisma.user.delete({ where: { id: userId } });
  assert.equal(await prisma.recoveryCode.count({ where: { userId } }), 0);
});

test("the sealed key, the recovery hashes and the step are nowhere in the data export", async () => {
  const { userId, recoveryCodes } = await enabled();
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const json = JSON.stringify(await buildFullExport(userId));
  assert.ok(!json.includes(row.totpSecret!), "the sealed key");
  for (const code of recoveryCodes) assert.ok(!json.includes(hashRecoveryCode(code)) && !json.includes(code), "a recovery code or its hash");
  assert.ok(!/totp|recoveryCode/i.test(json), "the column names");
});
