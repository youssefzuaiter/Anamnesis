import "server-only";
import { AppError } from "@/lib/api-response";
import type { GpaCourse } from "@/lib/gpa";
import { summarise } from "@/lib/grades";
import {
  maxPoints,
  normaliseLetter,
  scaleOrDefault,
  validateScale,
  type GradeScale,
} from "@/lib/gpa-scale";
import * as courseRepository from "@/repositories/course-repository";
import * as profileRepository from "@/repositories/profile-repository";

/** The most credits one course can be worth. */
export const MAX_CREDITS = 30;

export type GpaOverview = {
  /** The caller's live courses only. */
  courses: GpaCourse[];
  /** Marks so far per course id, for reference: never turned into a letter. */
  marks: Record<string, { average: number | null; remaining: number }>;
  scale: GradeScale;
  /** True when no usable scale is stored, so the preset is in use. */
  usesDefaultScale: boolean;
  targetGpa: number | null;
};

/** The scale stored for this account, checked on every read: stored JSON is not trusted. */
function effectiveScale(stored: unknown): { scale: GradeScale; usesDefaultScale: boolean } {
  const check = validateScale(stored);
  return check.ok
    ? { scale: check.scale, usesDefaultScale: false }
    : { scale: scaleOrDefault(null), usesDefaultScale: true };
}

export async function getGpaOverview(userId: string): Promise<GpaOverview> {
  const [courses, settings] = await Promise.all([
    courseRepository.listCourses(userId),
    profileRepository.getGpaSettings(userId),
  ]);

  const marks: GpaOverview["marks"] = {};
  for (const course of courses) {
    const summary = summarise(course.assessments);
    marks[course.id] = { average: summary.currentAverage, remaining: summary.remainingWeight };
  }

  return {
    courses: courses.map((course) => ({
      id: course.id,
      code: course.code,
      title: course.title,
      term: course.term,
      credits: course.credits,
      finalGrade: course.finalGrade,
    })),
    marks,
    ...effectiveScale(settings.gpaScale),
    targetGpa: settings.targetGpa,
  };
}

function parseCredits(credits: number | null): number | null {
  if (credits === null) return null;
  if (typeof credits !== "number" || !Number.isFinite(credits)) {
    throw new AppError("VALIDATION_ERROR", "Credits must be a number.");
  }
  if (credits < 0 || credits > MAX_CREDITS) {
    throw new AppError("VALIDATION_ERROR", `Credits must be between 0 and ${MAX_CREDITS}.`);
  }
  // Zero credits means "not set", the same as none.
  return credits === 0 ? null : Math.round(credits * 100) / 100;
}

function parseLetter(letter: string | null): string | null {
  if (letter === null || letter.trim() === "") return null;
  const normalised = normaliseLetter(letter);
  if (normalised === null) {
    throw new AppError("VALIDATION_ERROR", "A letter is one to four letters, digits, + or -.");
  }
  return normalised;
}

/**
 * Records a course's credits and official letter. Both are checked before anything is
 * written, and a course that is not the caller's, is deleted or does not exist is one
 * and the same refusal.
 */
export async function setCourseGrade(
  userId: string,
  courseId: string,
  input: { credits: number | null; finalGrade: string | null },
): Promise<void> {
  const credits = parseCredits(input.credits);
  const finalGrade = parseLetter(input.finalGrade);

  const changed = await courseRepository.setCourseGrade(userId, courseId, { credits, finalGrade });
  if (!changed) throw new AppError("RESOURCE_NOT_FOUND", "That course no longer exists.");
}

/** A target must be above zero and no higher than the best grade in the account's scale. */
export async function setTargetGpa(userId: string, target: number | null): Promise<void> {
  if (target !== null) {
    const { scale } = effectiveScale((await profileRepository.getGpaSettings(userId)).gpaScale);
    if (typeof target !== "number" || !Number.isFinite(target) || target <= 0 || target > maxPoints(scale)) {
      throw new AppError("VALIDATION_ERROR", "That target is outside your scale.");
    }
  }
  await profileRepository.setTargetGpa(userId, target);
}

/** Saves a scale after validating it, or resets to the preset with null. */
export async function saveGradeScale(userId: string, scale: unknown | null): Promise<void> {
  if (scale === null) {
    await profileRepository.setGpaScale(userId, null);
    return;
  }
  const check = validateScale(scale);
  if (!check.ok) throw new AppError("VALIDATION_ERROR", check.message);
  await profileRepository.setGpaScale(userId, check.scale);
}
