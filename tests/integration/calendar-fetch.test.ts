/**
 * Calendar subscriptions fetch a URL a person typed, so they go through the shared guard: local names,
 * private addresses and non-http schemes are refused before anything is stored or fetched.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { addSubscription } from "@/services/calendar-service";

const users: string[] = [];
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("a calendar link inside this machine or its network is refused, and nothing is kept", async () => {
  const user = await prisma.user.create({ data: { email: `cal-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  for (const url of ["http://localhost:3200/x.ics", "http://ntfy/x.ics", "http://host.docker.internal:11434/", "webcal://10.0.0.1/c.ics", "http://[::1]/c.ics", "http://0.0.0.0/c.ics", "http://2130706433/c.ics"]) {
    await assert.rejects(
      () => addSubscription(user.id, { name: "Timetable", url }),
      (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR" && /not reachable from this server/.test(error.message),
      url,
    );
  }
  await assert.rejects(() => addSubscription(user.id, { name: "Timetable", url: "ftp://example.com/c.ics" }), (error: unknown) => error instanceof AppError && /http/.test(error.message));
  assert.equal(await prisma.calendarSubscription.count({ where: { userId: user.id } }), 0);
});
