/**
 * The scheduler that fires reminders while no tab is open: when it starts, that it ticks, that a failing
 * tick does not stop it, and that there is only ever one. The tick itself is tested in
 * reminders-push.test.ts; here it is mostly a stand-in, except in the one test that runs the real one.
 */
import "dotenv/config";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@/lib/prisma";
import { reminderSchedulerStatus, startReminderScheduler } from "@/services/reminder-scheduler";

const servers: Server[] = [];
let running: { stop(): void } | null = null;
afterEach(() => {
  running?.stop();
  running = null;
});
after(async () => {
  for (const server of servers) server.close();
  await prisma.$disconnect();
});

const configured = { NTFY_URL: "http://127.0.0.1:9", NTFY_TOKEN: "tk_abcdefghijklmnopqrstuvwxyz123" };
const until = async (condition: () => boolean, ms = 3_000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("without ntfy settings nothing starts, and the status says so", () => {
  for (const env of [{}, { NTFY_URL: "http://x" }, { NTFY_TOKEN: "tk_x" }, { NTFY_URL: "  ", NTFY_TOKEN: "tk_x" }]) {
    assert.equal(startReminderScheduler({ env }), null, JSON.stringify(env));
  }
  assert.equal(reminderSchedulerStatus().configured, false);
});

test("with them it ticks, and a second start is the same scheduler", async () => {
  let ticks = 0;
  running = startReminderScheduler({ env: configured, intervalMs: 20, firstDelayMs: 0, run: async () => void ticks++ });
  assert.ok(running);
  assert.equal(startReminderScheduler({ env: configured, intervalMs: 20, firstDelayMs: 0, run: async () => void ticks++ }), running);
  await until(() => ticks >= 3);
  const status = reminderSchedulerStatus();
  assert.equal(status.configured, true);
  assert.ok(status.lastTickSecondsAgo !== null && status.lastTickSecondsAgo <= 1);
});

test("a tick that throws is logged without the token, and the next tick still runs", async () => {
  let ticks = 0;
  const logged: string[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => void logged.push(parts.map(String).join(" "));
  try {
    running = startReminderScheduler({
      env: configured,
      intervalMs: 20,
      firstDelayMs: 0,
      run: async () => {
        ticks++;
        if (ticks === 1) throw new Error(`database went away ${configured.NTFY_TOKEN}`);
      },
    });
    await until(() => ticks >= 3);
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((line) => line.includes("[reminders] tick failed")));
  assert.ok(logged.every((line) => !line.includes(configured.NTFY_TOKEN)), "the token is never logged");
});

test("ticks never overlap: a slow tick makes the next ones wait their turn", async () => {
  let active = 0;
  let most = 0;
  let ticks = 0;
  running = startReminderScheduler({
    env: configured,
    intervalMs: 5,
    firstDelayMs: 0,
    run: async () => {
      active++;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 60));
      active--;
      ticks++;
    },
  });
  await until(() => ticks >= 3);
  assert.equal(most, 1);
});

test("stop ends it, and a new start after a stop is a new scheduler", async () => {
  let ticks = 0;
  const first = startReminderScheduler({ env: configured, intervalMs: 20, firstDelayMs: 0, run: async () => void ticks++ });
  await until(() => ticks >= 1);
  first!.stop();
  const settled = ticks;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(ticks <= settled + 1, "at most a tick already under way");
  running = startReminderScheduler({ env: configured, intervalMs: 20, firstDelayMs: 0, run: async () => void ticks++ });
  assert.notEqual(running, first);
});

test("the real tick runs against the database and posts to the configured server", async () => {
  const server = createServer((req, res) => {
    req.resume();
    res.end("{}");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const logged: string[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => void logged.push(parts.map(String).join(" "));
  try {
    const before = Date.now();
    running = startReminderScheduler({ env: { NTFY_URL: `http://127.0.0.1:${port}`, NTFY_TOKEN: configured.NTFY_TOKEN }, intervalMs: 50, firstDelayMs: 0 });
    await until(() => {
      const ago = reminderSchedulerStatus().lastTickSecondsAgo;
      return ago !== null && Date.now() - ago * 1000 >= before - 1000;
    }, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged.filter((line) => line.includes("[reminders]")), [], "the real tick ran without failing");
});
