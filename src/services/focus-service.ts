import "server-only";
import { AppError } from "@/lib/api-response";
import { classifyLoad, MIN_SESSION_SECONDS, summarise, type FocusSummary } from "@/lib/focus";
import {
  buildCourseLines,
  measuresShown,
  mergeRecent,
  rangeStart,
  type CourseLine,
  type Grouped,
  type Measure,
  type RecentEntry,
  type StudyRange,
} from "@/lib/study-time";
import * as focusRepository from "@/repositories/focus-repository";
import type { FocusSwitches } from "@/repositories/focus-repository";
import { listCourseOptions } from "@/repositories/course-repository";

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

// --- Reading it back ----------------------------------------------------------------------------------

const RECENT = 30;

const total = (rows: Grouped[]): Measure =>
  rows.reduce(
    (sum, row) => ({ seconds: sum.seconds + row.seconds, sessions: sum.sessions + row.sessions }),
    { seconds: 0, sessions: 0 },
  );

export type StudyTimeView = {
  settings: FocusSwitches;
  range: StudyRange;
  lines: CourseLine[];
  scaleSeconds: number;
  writing: Measure;
  timer: Measure;
  shown: { writing: boolean; timer: boolean };
  recent: RecentEntry[];
  courses: { id: string; code: string; title: string }[];
  stats: FocusSummary;
  hasHistory: boolean;
  courseHint: boolean;
};

/**
 * Everything the Focus page shows: the switches, time per course over a window, the newest sessions
 * and the typing figures. Totals are the table sums, so a course in the trash moves its time to "No
 * course" and nothing is lost.
 */
export async function getStudyTime(userId: string, range: StudyRange, now: Date): Promise<StudyTimeView> {
  const window = { since: rangeStart(range, now) };
  const [settings, courses, writingRows, timerRows, writingRecent, timerRecent, counts] = await Promise.all([
    focusRepository.getSettings(userId),
    listCourseOptions(userId),
    focusRepository.groupWritingByCourse(userId, window),
    focusRepository.groupTimerByCourse(userId, window),
    focusRepository.listSessions(userId, RECENT),
    focusRepository.listTimerSessions(userId, RECENT),
    focusRepository.countSessions(userId),
  ]);

  const { lines, scaleSeconds } = buildCourseLines(courses, writingRows, timerRows);
  const noCourse = lines.find((line) => line.courseId === null);

  return {
    settings,
    range,
    lines,
    scaleSeconds,
    writing: total(writingRows),
    timer: total(timerRows),
    shown: measuresShown({
      writingOn: settings.tracking,
      timerOn: settings.timer,
      writingSessions: counts.writing,
      timerSessions: counts.timer,
    }),
    recent: mergeRecent(
      writingRecent.map((row) => ({
        kind: "writing" as const,
        id: row.id,
        at: row.recordedAt,
        seconds: row.sessionDuration,
        courseId: row.courseId,
        wpm: row.typingSpeedWpm,
        load: row.cognitiveLoad,
      })),
      timerRecent.map((row) => ({
        kind: "timer" as const,
        id: row.id,
        at: row.recordedAt,
        seconds: row.seconds,
        courseId: row.courseId,
        wpm: null,
        load: null,
      })),
      RECENT,
    ),
    courses,
    stats: summarise(writingRecent),
    hasHistory: counts.writing + counts.timer > 0,
    // Writing is being kept but not its course, so it all sits under "No course": say how to split it.
    courseHint: settings.tracking && !settings.includeCourse && (noCourse?.writing.sessions ?? 0) > 0,
  };
}

export type CourseStudyTime = {
  settings: FocusSwitches;
  writing: Measure;
  timer: Measure;
  shown: { writing: boolean; timer: boolean };
  visible: boolean;
};

/** What the course page's card shows: this course over the last 28 days. */
export async function getCourseStudyTime(userId: string, courseId: string, now: Date): Promise<CourseStudyTime> {
  const window = { since: rangeStart("28", now), courseId };
  const [settings, writingRows, timerRows, counts] = await Promise.all([
    focusRepository.getSettings(userId),
    focusRepository.groupWritingByCourse(userId, window),
    focusRepository.groupTimerByCourse(userId, window),
    focusRepository.countSessions(userId, courseId),
  ]);

  return {
    settings,
    writing: total(writingRows),
    timer: total(timerRows),
    shown: measuresShown({
      writingOn: settings.tracking,
      timerOn: settings.timer,
      writingSessions: counts.writing,
      timerSessions: counts.timer,
    }),
    // A card that would say nothing and ask for nothing is not drawn: only while something is being
    // recorded, or there is something recorded for this course, does it appear.
    visible: settings.tracking || settings.timer || counts.writing + counts.timer > 0,
  };
}
