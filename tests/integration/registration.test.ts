/** Who may create an account, against a real Postgres (ROADMAP item 25). */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { currentRegistrationMode, registerAccount } from "@/services/registration-service";

const CODE = "integration-invite-code-0001";
const made: string[] = [];
const email = () => {
  const e = `registration-${randomUUID()}@test.local`;
  made.push(e);
  return e;
};
after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: made } } });
  await prisma.$disconnect();
});
const refused = (code: string, message: RegExp) => (error: unknown) => error instanceof AppError && error.code === code && message.test(error.message);
const input = (overrides: Partial<{ email: string; inviteCode: unknown }> = {}) => ({ name: "Someone", email: email(), password: "long-enough-password", inviteCode: undefined as unknown, ...overrides });

// The dev and CI databases already hold accounts (the e2e account, other tests'), so this file
// sees "code" and "closed"; "open" (no account at all) is a unit rule and is what CI's e2e setup
// exercises on its empty database.
test("with accounts present and no code configured, registration is closed and writes nothing", async () => {
  await prisma.user.create({ data: { email: email(), passwordHash: "x" } });
  assert.equal(await currentRegistrationMode(undefined), "closed");
  const attempt = input({ inviteCode: CODE });
  await assert.rejects(() => registerAccount(attempt, undefined), refused("FORBIDDEN", /closed/));
  assert.equal(await prisma.user.count({ where: { email: attempt.email } }), 0);
});

test("with a code configured, a wrong or missing code writes nothing and says only that the code is wrong", async () => {
  assert.equal(await currentRegistrationMode(CODE), "code");
  for (const inviteCode of [undefined, "", "wrong-code-but-long-enough", CODE.toUpperCase(), [CODE]]) {
    const attempt = input({ inviteCode });
    await assert.rejects(() => registerAccount(attempt, CODE), refused("FORBIDDEN", /invite code/), String(inviteCode));
    assert.equal(await prisma.user.count({ where: { email: attempt.email } }), 0);
  }
});

test("the right code creates the account with a profile, its email lower-cased and its password hashed", async () => {
  const attempt = input({ inviteCode: `  ${CODE} ` });
  attempt.email = attempt.email.toUpperCase();
  made.push(attempt.email.toLowerCase());
  const user = await registerAccount(attempt, CODE);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } });
  assert.equal(row.email, attempt.email.toLowerCase());
  assert.ok(row.profile);
  assert.ok(row.passwordHash.startsWith("scrypt$"));
});

test("a taken email is reported only to someone who holds the code", async () => {
  const taken = email();
  await prisma.user.create({ data: { email: taken, passwordHash: "x" } });
  await assert.rejects(() => registerAccount(input({ email: taken, inviteCode: "wrong-code-but-long-enough" }), CODE), refused("FORBIDDEN", /invite code/));
  await assert.rejects(() => registerAccount(input({ email: taken }), undefined), refused("FORBIDDEN", /closed/));
  await assert.rejects(() => registerAccount(input({ email: taken, inviteCode: CODE }), CODE), refused("VALIDATION_ERROR", /already exists/));
});

test("two registrations at once with the right code both land, one row each", async () => {
  const [a, b] = [input({ inviteCode: CODE }), input({ inviteCode: CODE })];
  await Promise.all([registerAccount(a, CODE), registerAccount(b, CODE)]);
  assert.equal(await prisma.user.count({ where: { email: { in: [a.email, b.email] } } }), 2);
});
