import "server-only";
import { AppError } from "@/lib/api-response";
import { indexEntity, deleteEntityEmbeddings } from "@/lib/vector";
import * as courseRepository from "@/repositories/course-repository";
import {
  embeddableTextFor,
  courseAssessmentSummary,
} from "@/services/embeddable-text";

/**
 * A client-supplied courseId must be checked, exactly as a projectId is: the
 * database would otherwise happily attach one tenant's note to another
 * tenant's course on an id alone.
 */
export async function assertCourseOwned(
  userId: string,
  courseId: string | null | undefined,
): Promise<void> {
  if (!courseId) return;

  const course = await courseRepository.getCourseRow(userId, courseId);
  if (!course) {
    throw new AppError("RESOURCE_NOT_FOUND", "That course no longer exists.");
  }
}

/** The same check for an assessment id that came from the browser. */
export async function assertAssessmentOwned(
  userId: string,
  assessmentId: string | null | undefined,
): Promise<void> {
  if (!assessmentId) return;

  const assessment = await courseRepository.getAssessment(userId, assessmentId);
  if (!assessment) {
    throw new AppError("RESOURCE_NOT_FOUND", "That assessment no longer exists.");
  }
}

/**
 * Keeps a course's vector index in step with its own fields and its
 * assessments — a course's embedded prose includes a grade rundown (see
 * `courseAssessmentSummary`), so adding, scoring or deleting an assessment
 * must re-embed the *course*, not just leave it untouched. Mirrors
 * `syncNoteIndex` in `note-service.ts`: a failed re-index drops the stale
 * embeddings rather than leaving superseded text searchable, so the course
 * just goes missing from semantic search until it is saved again.
 */
export async function indexCourse(
  userId: string,
  courseId: string,
): Promise<void> {
  const course = await courseRepository.getCourse(userId, courseId);
  if (!course) return;

  try {
    await indexEntity(
      userId,
      "course",
      course.id,
      embeddableTextFor.course(
        course,
        courseAssessmentSummary(course.assessments),
      ),
    );
  } catch (error) {
    console.error(`[WARN] Failed to index course ${course.id}:`, error);
    await deleteEntityEmbeddings(userId, "course", course.id).catch(() => {});
  }
}
