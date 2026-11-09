import "server-only";
import { AppError } from "@/lib/api-response";
import { classifyLoad, MIN_SESSION_SECONDS } from "@/lib/focus";
import * as focusRepository from "@/repositories/focus-repository";
import type { FocusSwitches } from "@/repositories/focus-repository";

export type { FocusSwitches };

/*
 * Everything the three switches govern is decided here, not in the actions and not in the browser: an
 * action only parses its input, finds the session's account and calls in. A client that keeps sending
 * after a switch is turned off stores nothing, and a client that sends somebody else's course or task
 * is told nothing about it.
 */

export function getSettings(userId: string): Promise<FocusSwitches> {
  return focusRepository.getSettings(userId);
}

export async function setTracking(userId: string, enabled: boolean): Promise<FocusSwitches> {
  // Writing time and the course it belongs to are asked for separately, so turning the first off ends
  // the second as well: turning tracking back on starts from "no course" again.
  await focusRepository.setFlags(
    userId,
    enabled ? { focusTrackingEnabled: true } : { focusTrackingEnabled: false, focusIncludeCourse: false },
  );
  return focusRepository.getSettings(userId);
}

export async function setIncludeCourse(userId: string, enabled: boolean): Promise<FocusSwitches> {
  if (enabled) {
    if (!(await focusRepository.turnOnCourse(userId))) {
      throw new AppError("FORBIDDEN", "Turn on Record focus sessions first.");
    }
  } else {
    await focusRepository.setFlags(userId, { focusIncludeCourse: false });
  }
  return focusRepository.getSettings(userId);
}

export async function setTimerSessions(userId: string, enabled: boolean): Promise<FocusSwitches> {
  await focusRepository.setFlags(userId, { timerSessionsEnabled: enabled });
  return focusRepository.getSettings(userId);
}

export async function recordWritingSession(
  userId: string,
  input: {
    activeSeconds: number;
    charactersTyped: number;
    typingSpeedWpm: number;
    courseId?: string | null;
  },
): Promise<void> {
  // Sessions too short to mean anything are dropped rather than stored as noise.
  if (input.activeSeconds < MIN_SESSION_SECONDS || input.charactersTyped === 0) return;

  const settings = await focusRepository.getSettings(userId);
  if (!settings.tracking) throw new AppError("FORBIDDEN", "Focus tracking is off.");

  // The course comes from the browser, so it is only kept when the person asked for it and it is theirs.
  // A course that is not theirs is stored as no course, exactly as if none had been sent.
  const courseId =
    settings.includeCourse && input.courseId && (await focusRepository.ownsCourse(userId, input.courseId))
      ? input.courseId
      : null;

  await focusRepository.recordSession(userId, {
    sessionDuration: input.activeSeconds,
    typingSpeedWpm: input.typingSpeedWpm,
    cognitiveLoad: classifyLoad(input.activeSeconds, input.typingSpeedWpm),
    courseId,
  });
}

export async function recordTimerSession(
  userId: string,
  input: { taskId: string; seconds: number },
): Promise<{ saved: boolean; seconds: number; courseCode: string | null }> {
  if (input.seconds < MIN_SESSION_SECONDS) return { saved: false, seconds: 0, courseCode: null };

  // The switch answers before the task is looked at, so a refusal never says whether a task exists.
  if (!(await focusRepository.getSettings(userId)).timer) {
    throw new AppError("FORBIDDEN", "Remembering timer sessions is off.");
  }

  // The course is the task's own, found on the server: the browser sends a task, never a course.
  const task = await focusRepository.findTimedTask(userId, input.taskId);
  if (!task) throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");

  await focusRepository.recordTimerSession(userId, { seconds: input.seconds, courseId: task.courseId });
  return { saved: true, seconds: input.seconds, courseCode: task.courseCode };
}

export function clearHistory(userId: string): Promise<number> {
  return focusRepository.deleteAllSessions(userId);
}
