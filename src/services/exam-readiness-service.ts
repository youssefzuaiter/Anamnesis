import "server-only";
import { daysUntil, summarise } from "@/lib/grades";
import { sessionProgress, type SessionProgress } from "@/lib/exam-readiness";
import * as courseRepository from "@/repositories/course-repository";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import * as taskRepository from "@/repositories/task-repository";
import type { UpcomingAssessment } from "@/repositories/course-repository";

/** What Today's "Next exam" card shows about being ready for the exam (ROADMAP item 38). Read only: nothing is written. */
export type ExamReadiness = {
  assessmentId: string;
  courseId: string;
  code: string;
  title: string;
  dueDate: Date;
  /** Whole calendar days to go, never negative. */
  days: number;
  sessions: SessionProgress;
  /** Cards of this course's live notes that are due now. */
  cardsDue: number;
  /** The mark so far in this course, or null before anything is marked. */
  average: number | null;
  /** The course mark if everything still to come were perfect. */
  bestPossible: number;
};

/** The readiness for one upcoming assessment; every read is scoped by `userId`, so rows of another account that name these ids count for nothing. */
export async function getExamReadiness(userId: string, assessment: UpcomingAssessment, now: Date): Promise<ExamReadiness> {
  const [sessions, cardsDue, marks] = await Promise.all([
    taskRepository.listPrepSessionsDetailed(userId, assessment.id),
    flashcardRepository.countDueForCourse(userId, assessment.course.id, now),
    courseRepository.listMarks(userId, assessment.course.id),
  ]);
  const grade = summarise(marks);
  return {
    assessmentId: assessment.id,
    courseId: assessment.course.id,
    code: assessment.course.code,
    title: assessment.title,
    dueDate: assessment.dueDate,
    days: daysUntil(assessment.dueDate, now),
    sessions: sessionProgress(sessions, now),
    cardsDue,
    average: grade.currentAverage,
    bestPossible: grade.bestPossible,
  };
}
