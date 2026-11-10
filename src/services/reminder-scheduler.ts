import "server-only";
import { ntfyPublisher, type Publish } from "@/lib/ntfy";
import { runReminderTick } from "@/services/reminder-push-service";

/*
 * What fires reminders while no tab is open: a timer inside the app server itself, started once from
 * `src/instrumentation.ts` when the server starts. No job runner, no separate process, no endpoint to
 * call: the app container already runs around the clock, and the ReminderDelivery claim makes a second
 * scheduler (a dev reload, the old and new containers during a deploy) harmless.
 *
 * It starts only when both NTFY_URL and NTFY_TOKEN are set, so a development server or a release
 * without ntfy configured never sends anything.
 */

type Run = (now: Date, publish: Publish) => Promise<unknown>;
type Handle = { stop(): void };
type State = { handle: Handle | null; configured: boolean; busy: boolean; lastTickAt: number | null };

// On globalThis so a development reload, which re-evaluates this module, finds the running one.
const shared = globalThis as unknown as { __anamnesisReminders?: State };
function state(): State {
  shared.__anamnesisReminders ??= { handle: null, configured: false, busy: false, lastTickAt: null };
  return shared.__anamnesisReminders;
}

export function startReminderScheduler(
  options: {
    env?: Record<string, string | undefined>;
    intervalMs?: number;
    firstDelayMs?: number;
    run?: Run;
  } = {},
): Handle | null {
  const current = state();
  if (current.handle) return current.handle;

  const env = options.env ?? process.env;
  const url = env.NTFY_URL?.trim();
  const token = env.NTFY_TOKEN?.trim();
  if (!url || !token) {
    current.configured = false;
    console.info("[reminders] push reminders off: NTFY_URL or NTFY_TOKEN not set");
    return null;
  }

  current.configured = true;
  const publish = ntfyPublisher(url, token);
  const run = options.run ?? runReminderTick;

  const tick = async () => {
    // One at a time: a slow tick (a slow ntfy, a slow database) makes the next one skip, not pile up.
    if (current.busy) return;
    current.busy = true;
    try {
      await run(new Date(), publish);
    } catch (error) {
      // The message only: an error from deep in a driver can carry connection details.
      const message = error instanceof Error ? error.message.replaceAll(token, "[token]") : "unknown error";
      console.error("[reminders] tick failed:", message);
    } finally {
      current.busy = false;
      current.lastTickAt = Date.now();
    }
  };

  // The first tick waits a little, so a starting server answers requests before it sends anything.
  const first = setTimeout(() => void tick(), options.firstDelayMs ?? 10_000);
  const timer = setInterval(() => void tick(), options.intervalMs ?? 60_000);
  // Neither keeps a process alive on its own (a test, a script, a server that is shutting down).
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

/** For the deep health check: whether reminders are set up, and how long ago the last tick ran. */
export function reminderSchedulerStatus(): { configured: boolean; lastTickSecondsAgo: number | null } {
  const current = state();
  return {
    configured: current.configured,
    lastTickSecondsAgo: current.lastTickAt === null ? null : Math.round((Date.now() - current.lastTickAt) / 1000),
  };
}
