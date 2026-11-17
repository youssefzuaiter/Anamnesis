import "server-only";
import { AppError } from "@/lib/api-response";
import { MIN_SESSION_SECONDS } from "@/lib/focus";
import { ntfyPublisher, type Publish } from "@/lib/ntfy";
import {
  FOCUS_CHOICES,
  ROUND_LENGTH,
  due,
  finalize,
  pause,
  resume,
  skipBreak,
  skipToBreak,
  startBreak,
  startFocus,
  startNextFocus,
  unsaved,
  view,
  type TimerState,
  type TimerView,
} from "@/lib/focus-timer";
import * as focusRepository from "@/repositories/focus-repository";
import * as repo from "@/repositories/focus-timer-repository";
import * as reminderRepository from "@/repositories/reminder-repository";

/*
 * The focus timer, on the server (ROADMAP item 40). It keeps counting while the person browses, takes breaks, saves study time and rings a
 * phone. The rules are `lib/focus-timer.ts`; this file reads and writes the one timer of an account and does the side effects, each exactly
 * once: a change is a compare-and-set (see the repository), study time is written in the same transaction as the change that earns it, and the
 * phone is rung only by whoever wins the change that finishes a phase. Nothing ever starts by itself.
 */

const MAX_ATTEMPTS = 4;

export type TimerSnapshot = {
  view: TimerView;
  taskId: string | null;
  /** Null when the task has since been deleted. */
  taskTitle: string | null;
  courseCode: string | null;
  /** ISO time the running phase ends, for the browser's countdown; null unless running. */
  endsAt: string | null;
  /** The server's clock when this was read, so the browser can correct for its own. */
  serverNow: string;
  focusMinutes: number;
  /** Of this focus phase, seconds already saved as study time. */
  savedSeconds: number;
  notifyPhone: boolean;
  /** Whether "Remember timer sessions" is on, so the page can say whether time is kept. */
  rememberOn: boolean;
  /** Whether a phone could be rung (push set up and the server configured for it). */
  phoneAvailable: boolean;
};

type Options = { now?: Date; publish?: Publish };

function assertUser(userId: string): void {
  if (typeof userId !== "string" || userId === "") throw new AppError("AUTH_REQUIRED", "Sign in first.");
}

// --- the phone ---------------------------------------------------------------------------------------

let envPublisher: Publish | null | undefined;
/** The publisher for the configured ntfy server, or null when there is none. */
function defaultPublisher(): Publish | null {
  if (envPublisher !== undefined) return envPublisher;
  const url = process.env.NTFY_URL?.trim();
  const token = process.env.NTFY_TOKEN?.trim();
  envPublisher = url && token ? ntfyPublisher(url, token) : null;
  return envPublisher;
}

async function phoneTopic(userId: string): Promise<string | null> {
  const profile = await reminderRepository.getPushProfile(userId);
  return profile?.enabled && profile.topic ? profile.topic : null;
}

async function phoneAvailable(userId: string, options: Options): Promise<boolean> {
  if ((options.publish ?? defaultPublisher()) === null) return false;
  return (await phoneTopic(userId)) !== null;
}

/** Rings the phone, if the person asked and it is set up. A failure is logged and never reaches the timer. */
async function ring(userId: string, finished: TimerState, taskTitle: string | null, options: Options): Promise<void> {
  if (!finished.notifyPhone) return;
  const publish = options.publish ?? defaultPublisher();
  if (!publish) return;
  try {
    const topic = await phoneTopic(userId);
    if (!topic) return;
    const where = view(finished, new Date(0));
    const message =
      finished.phase === "focus"
        ? {
            title: "Focus session done",
            body: `${taskTitle ?? "Your task"} · ${Math.round(finished.phaseSeconds / 60)} min. ${where.next === "long_break" ? "Take a 15 minute break." : "Take a 5 minute break."}`,
          }
        : {
            title: finished.phase === "long_break" ? "Long break over" : "Break over",
            body: `Focus session ${(finished.completedFocus % ROUND_LENGTH) + 1} of ${ROUND_LENGTH} is ready when you are.`,
          };
    await publish({ topic, ...message });
  } catch (error) {
    console.error("[timer] the phone could not be rung:", error instanceof Error ? error.message : "unknown error");
  }
}

// --- the timeout that finishes a session on time ------------------------------------------------------

const shared = globalThis as unknown as { __anamnesisTimerTimeouts?: Map<string, ReturnType<typeof setTimeout>> };
const armed = (): Map<string, ReturnType<typeof setTimeout>> => (shared.__anamnesisTimerTimeouts ??= new Map());

function disarm(userId: string): void {
  const timeout = armed().get(userId);
  if (timeout) clearTimeout(timeout);
  armed().delete(userId);
}

/** Wakes the server at the end of a running phase to finish it (and ring), so a phone is rung on time with every tab closed. */
function arm(userId: string, endsAt: Date, options: Options): void {
  disarm(userId);
  const delay = Math.min(Math.max(0, endsAt.getTime() - Date.now()) + 300, 2 ** 31 - 1);
  const timeout = setTimeout(() => {
    armed().delete(userId);
    void getTimer(userId, { publish: options.publish }).catch((error) => console.error("[timer] could not finish a session:", error instanceof Error ? error.message : "unknown"));
  }, delay);
  timeout.unref();
  armed().set(userId, timeout);
}

/** For tests: forget every pending timeout. */
export function cancelAllArmed(): void {
  for (const timeout of armed().values()) clearTimeout(timeout);
  armed().clear();
}

// --- reading and finishing ------------------------------------------------------------------------------

async function studyFor(userId: string, state: TimerState, now: Date): Promise<{ seconds: number; courseId: string | null } | null> {
  const seconds = unsaved(state, now);
  if (seconds < MIN_SESSION_SECONDS) return null;
  if (!(await focusRepository.getSettings(userId)).timer) return null;
  return { seconds, courseId: state.taskId ? await repo.courseOfTask(userId, state.taskId) : null };
}

/** The account's timer, finished first if it has run out: the same compare-and-set whoever notices, so it is saved and rung once. */
async function settled(userId: string, options: Options): Promise<repo.TimerRow | null> {
  const now = options.now ?? new Date();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await repo.getTimer(userId);
    if (row === null || !due(row, now)) return row;
    const study = await studyFor(userId, row, now);
    const next = finalize(row, now);
    next.savedSeconds = row.savedSeconds + (study?.seconds ?? 0);
    if (await repo.change(userId, row, next, study)) {
      const title = row.taskId ? ((await repo.findTask(userId, row.taskId))?.title ?? null) : null;
      await ring(userId, next, title, options);
      disarm(userId);
      return { ...next, id: row.id, updatedAt: new Date() };
    }
  }
  return repo.getTimer(userId);
}

async function snapshotOf(userId: string, row: repo.TimerRow, options: Options): Promise<TimerSnapshot> {
  const now = options.now ?? new Date();
  const [task, switches, phone] = await Promise.all([
    row.taskId ? repo.findTask(userId, row.taskId) : Promise.resolve(null),
    focusRepository.getSettings(userId),
    phoneAvailable(userId, options),
  ]);
  return {
    view: view(row, now),
    taskId: row.taskId,
    taskTitle: task?.title ?? null,
    courseCode: task?.courseCode ?? null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    serverNow: now.toISOString(),
    focusMinutes: row.focusMinutes,
    savedSeconds: row.savedSeconds,
    notifyPhone: row.notifyPhone,
    rememberOn: switches.timer,
    phoneAvailable: phone,
  };
}

/** The account's timer as the page shows it, or null when there is none. */
export async function getTimer(userId: string, options: Options = {}): Promise<TimerSnapshot | null> {
  assertUser(userId);
  const row = await settled(userId, options);
  if (row === null) return null;
  if (row.endsAt !== null) arm(userId, row.endsAt, options);
  return snapshotOf(userId, row, options);
}

/** Whether a phone could be rung for this account: ntfy is configured on the server and the person has push reminders on. */
export async function isPhoneAvailable(userId: string): Promise<boolean> {
  assertUser(userId);
  return phoneAvailable(userId, {});
}

/** Finishes the timers that have run out, for the minute tick (a server that restarted lost its timeouts). */
export async function finishDueTimers(now: Date, publish?: Publish): Promise<number> {
  const users = await repo.listDueUsers(now);
  for (const userId of users) {
    try {
      await settled(userId, { now, publish });
    } catch (error) {
      console.error("[timer] could not finish a session:", error instanceof Error ? error.message : "unknown");
    }
  }
  return users.length;
}

// --- commands ---------------------------------------------------------------------------------------------

/**
 * One command: read the (finished-if-due) timer, work out the next state and the study time it earns, and apply them together. Retried when
 * someone else changed the timer in between.
 */
async function command(
  userId: string,
  options: Options,
  step: (state: TimerState, now: Date) => TimerState | null,
  how: { saves: boolean; needsTimer?: boolean },
): Promise<TimerSnapshot | null> {
  assertUser(userId);
  const now = options.now ?? new Date();
  const needsTimer = how.needsTimer ?? true;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await settled(userId, options);
    if (row === null && needsTimer) throw new AppError("VALIDATION_ERROR", "There is no timer running.");
    let next: TimerState | null;
    try {
      next = step(row as TimerState, now);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("VALIDATION_ERROR", error instanceof Error ? error.message : "That is not possible right now.");
    }
    // A command that leaves a focus session (reset, skip to a break, stop, start on another task) saves what ran and was not yet saved.
    const study = how.saves && row !== null ? await studyFor(userId, row, now) : null;
    if (await repo.change(userId, row, next, study)) {
      if (next === null) {
        disarm(userId);
        return null;
      }
      if (next.endsAt !== null) arm(userId, next.endsAt, options);
      else disarm(userId);
      const stored = await repo.getTimer(userId);
      return stored ? snapshotOf(userId, stored, options) : null;
    }
  }
  throw new AppError("VALIDATION_ERROR", "The timer changed while you were using it. Look again.");
}

function must(snapshot: TimerSnapshot | null): TimerSnapshot {
  if (!snapshot) throw new AppError("VALIDATION_ERROR", "There is no timer running.");
  return snapshot;
}

export async function startTimer(userId: string, input: { taskId: string; minutes: number; notify: boolean }, options: Options = {}): Promise<TimerSnapshot> {
  assertUser(userId);
  if (!(FOCUS_CHOICES as readonly number[]).includes(input.minutes)) {
    throw new AppError("VALIDATION_ERROR", `Choose ${FOCUS_CHOICES.join(", ")} minutes.`);
  }
  // The switch for the browser's request is checked after the task, as everywhere: a refusal never says whether a task exists.
  const task = await repo.findTask(userId, input.taskId);
  if (!task) throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
  const snapshot = await command(
    userId,
    options,
    (state, now) => {
      // Starting on another task (or another length) keeps the round going only on the same task; a new task is a new round.
      const sameRound = state !== null && state.taskId === input.taskId;
      return startFocus({ taskId: input.taskId, minutes: input.minutes, notify: input.notify === true, completedFocus: sameRound ? state.completedFocus % ROUND_LENGTH : 0 }, now);
    },
    { saves: true, needsTimer: false },
  );
  return snapshot!;
}

export const pauseTimer = async (userId: string, options: Options = {}) => must(await command(userId, options, (state, now) => pause(state, now), { saves: false }));
export const resumeTimer = async (userId: string, options: Options = {}) => must(await command(userId, options, (state, now) => resume(state, now), { saves: false }));
/** Back to a focus session that is ready to start, saving what ran. */
export const resetTimer = async (userId: string, options: Options = {}) => must(await command(userId, options, (state) => skipBreak(state), { saves: true }));
export const skipToBreakTimer = async (userId: string, options: Options = {}) => must(await command(userId, options, (state, now) => skipToBreak(state, now), { saves: true }));
export const startBreakTimer = async (userId: string, options: Options = {}) => must(await command(userId, options, (state, now) => startBreak(state, now), { saves: false }));
export const startNextFocusTimer = async (userId: string, options: Options = {}) => must(await command(userId, options, (state, now) => startNextFocus(state, now), { saves: false }));
/** Skips a break (or the one on offer after a session) and gets the next focus session ready. */
export const skipBreakTimer = async (userId: string, options: Options = {}) =>
  must(await command(
    userId,
    options,
    (state) => {
      if (state.phase === "focus" && state.finishedAt === null) throw new Error("There is no break to skip.");
      return skipBreak(state);
    },
    { saves: false },
  ));

/** Ends the round: what ran is saved and the timer is gone. Stopping when there is none is not an error. */
export async function stopTimer(userId: string, options: Options = {}): Promise<void> {
  await command(userId, options, () => null, { saves: true, needsTimer: false });
}
