import "server-only";
import { runCalendarSyncTick } from "@/services/calendar-service";

/*
 * What keeps imported calendars current while nobody presses Sync (ROADMAP item 54): a timer inside the app server, started from
 * `src/instrumentation.ts` like the reminder scheduler. Every few minutes it reads the calendars not tried for 30 minutes (`runCalendarSyncTick`).
 *
 * On in production and off in development and tests, so a development server never fetches a person's real calendar link on its own and the
 * browser tests see only what they set up; `CALENDAR_AUTO_SYNC=1` turns it on anywhere and `CALENDAR_AUTO_SYNC=0` off in production.
 */

type Handle = { stop(): void };
type State = { handle: Handle | null };

const shared = globalThis as unknown as { __anamnesisCalendarSync?: State };
function state(): State {
  shared.__anamnesisCalendarSync ??= { handle: null };
  return shared.__anamnesisCalendarSync;
}

export function calendarAutoSyncEnabled(env: Record<string, string | undefined>): boolean {
  const flag = env.CALENDAR_AUTO_SYNC?.trim();
  if (flag === "1") return true;
  if (flag === "0") return false;
  return env.NODE_ENV === "production";
}

export function startCalendarSyncScheduler(
  options: { env?: Record<string, string | undefined>; intervalMs?: number; firstDelayMs?: number; run?: () => Promise<unknown> } = {},
): Handle | null {
  const current = state();
  if (current.handle) return current.handle;
  const env = options.env ?? process.env;
  if (!calendarAutoSyncEnabled(env)) return null;

  const run = options.run ?? (() => runCalendarSyncTick());
  let busy = false;
  const tick = async () => {
    // One at a time: a slow feed makes the next tick skip, not pile up.
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (error) {
      // The message only: an error from deep in a driver can carry connection details.
      console.error("[calendars] sync failed:", error instanceof Error ? error.message : "unknown error");
    } finally {
      busy = false;
    }
  };

  const first = setTimeout(() => void tick(), options.firstDelayMs ?? 60_000);
  const timer = setInterval(() => void tick(), options.intervalMs ?? 5 * 60_000);
  first.unref();
  timer.unref();
  const handle: Handle = {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
      if (current.handle === handle) current.handle = null;
    },
  };
  current.handle = handle;
  return handle;
}
