import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarAutoSyncEnabled, startCalendarSyncScheduler } from "@/services/calendar-sync-scheduler";

test("auto sync is on in production, off elsewhere, and the flag decides either way", () => {
  assert.equal(calendarAutoSyncEnabled({ NODE_ENV: "production" }), true);
  assert.equal(calendarAutoSyncEnabled({ NODE_ENV: "development" }), false);
  assert.equal(calendarAutoSyncEnabled({ NODE_ENV: "test" }), false);
  assert.equal(calendarAutoSyncEnabled({}), false);
  assert.equal(calendarAutoSyncEnabled({ NODE_ENV: "development", CALENDAR_AUTO_SYNC: "1" }), true);
  assert.equal(calendarAutoSyncEnabled({ NODE_ENV: "production", CALENDAR_AUTO_SYNC: "0" }), false);
  assert.equal(calendarAutoSyncEnabled({ NODE_ENV: "development", CALENDAR_AUTO_SYNC: "yes" }), false, "only 1 and 0 are flags");
});

test("a development server starts nothing, and a started scheduler runs its job, one at a time, and a failing job does not stop it", async () => {
  assert.equal(startCalendarSyncScheduler({ env: { NODE_ENV: "development" } }), null);

  let running = 0;
  let maxRunning = 0;
  let calls = 0;
  const handle = startCalendarSyncScheduler({
    env: { CALENDAR_AUTO_SYNC: "1" },
    firstDelayMs: 5,
    intervalMs: 10,
    run: async () => {
      calls += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 35));
      running -= 1;
      if (calls === 1) throw new Error("first run fails");
    },
  });
  assert.ok(handle);
  await new Promise((r) => setTimeout(r, 160));
  handle.stop();
  assert.ok(calls >= 2, `ran again after a failure (${calls})`);
  assert.equal(maxRunning, 1, "never two at once");
  const after = calls;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, after, "stopped");
});
