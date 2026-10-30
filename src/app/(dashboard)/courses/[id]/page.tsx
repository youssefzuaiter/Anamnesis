import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import {
  getCourse,
  listCourseContents,
} from "@/repositories/course-repository";
import { countDueForCourse } from "@/repositories/flashcard-repository";
import { summarise, nextUngraded, daysUntilLabel } from "@/lib/grades";
import { GradePanel } from "@/components/grade-panel";
import { ExamPrep } from "@/components/exam-prep";
import { CourseGrade } from "@/components/course-grade";
import { summariseGpa } from "@/lib/gpa";
import { getGpaOverview } from "@/services/gpa-service";
import { dateLabel } from "@/lib/note-templates";
import { scopeHref } from "@/lib/assistant-scope";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { deleteCourseAction } from "@/actions/courses";

export const metadata = { title: "Course · Anamnesis" };

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

const DATETIME = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function CoursePage({
  params,
}: PageProps<"/courses/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  const course = await getCourse(userId, id);
  if (!course) notFound();

  const now = new Date();
  const [contents, dueCards, overview] = await Promise.all([
    listCourseContents(userId, course.id),
    countDueForCourse(userId, course.id, now),
    getGpaOverview(userId),
  ]);
  // Every other counted course, so the card can say what this one does to the CGPA.
  const others = summariseGpa(
    overview.courses.filter((other) => other.id !== course.id),
    overview.scale,
  );
  const deleteThisCourse = deleteCourseAction.bind(null, course.id);

  const grade = summarise(course.assessments);
  const next = nextUngraded(course.assessments, now);
  // What the Exam prep card can plan towards: unscored, dated, still ahead, soonest first.
  const prepTargets = course.assessments
    .flatMap((row) =>
      row.score === null && row.dueDate && row.dueDate > now
        ? [{ id: row.id, label: `${row.title} · ${dateLabel(row.dueDate)}`, due: row.dueDate }]
        : [],
    )
    .sort((a, b) => a.due.getTime() - b.due.getTime());

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link
          href="/courses"
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Courses
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          <span className="font-mono text-xl text-accent">{course.code}</span>{" "}
          {course.title}
        </h1>
        <p className="mt-1 text-sm text-text-muted">{course.term}</p>
        <Link
          href={scopeHref({ kind: "course", id: course.id })}
          className="mt-2 inline-block text-sm text-accent hover:underline"
        >
          Ask about this course
        </Link>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm text-text-muted">
        {next && (
          <span>
            <strong className="text-text">{next.title}</strong>{" "}
            {daysUntilLabel(next.dueDate, now)}
          </span>
        )}
        <span>
          current average{" "}
          <strong className="text-text">
            {grade.currentAverage === null
              ? "—"
              : `${Math.round(grade.currentAverage)}%`}
          </strong>
        </span>
        <span>
          best possible <strong className="text-text">{Math.round(grade.bestPossible)}%</strong>
        </span>
        {dueCards > 0 && (
          <Link href="/cards" className="text-accent hover:underline">
            {dueCards} flashcard{dueCards === 1 ? "" : "s"} due
          </Link>
        )}
      </section>

      <CourseGrade
        courseId={course.id}
        credits={course.credits}
        finalGrade={course.finalGrade}
        scale={overview.scale}
        base={{ credits: others.credits, qualityPoints: others.qualityPoints }}
      />

      <ExamPrep
        assessments={prepTargets.map(({ id, label }) => ({ id, label }))}
        defaultId={prepTargets[0]?.id ?? null}
      />

      <GradePanel
        courseId={course.id}
        assessments={course.assessments.map((row) => ({
          id: row.id,
          title: row.title,
          weight: row.weight,
          score: row.score,
          maxScore: row.maxScore,
          dueDate: row.dueDate ? DATE.format(row.dueDate) : null,
        }))}
      />

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold text-text-faint">
          Next classes · {contents.events.length}
        </h2>
        {contents.events.length === 0 ? (
          <p className="text-sm text-text-muted">
            No upcoming events linked. Import your timetable, then use “Claim
            matching timetable events” above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contents.events.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5"
              >
                <Link
                  href={`/calendar/${event.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-text transition-colors hover:text-accent"
                >
                  {event.title}
                </Link>
                <span className="shrink-0 text-xs text-text-muted">
                  {DATETIME.format(event.startTime)}
                  {event.location ? ` · ${event.location}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold text-text-faint">
          Tasks · {contents.tasks.length}
        </h2>
        {contents.tasks.length === 0 ? (
          <p className="text-sm text-text-muted">No tasks for this course.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contents.tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5"
              >
                <Link
                  href={`/tasks/${task.id}`}
                  className={`min-w-0 flex-1 truncate text-sm transition-colors hover:text-accent ${
                    task.status === "done"
                      ? "text-text-faint line-through"
                      : "text-text"
                  }`}
                >
                  {task.title}
                </Link>
                {task.dueDate && (
                  <span className="shrink-0 text-xs text-text-muted">
                    {DATE.format(task.dueDate)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold text-text-faint">
          Notes · {contents.notes.length}
        </h2>
        {contents.notes.length === 0 ? (
          <p className="text-sm text-text-muted">No notes for this course.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contents.notes.map((note) => (
              <li
                key={note.id}
                className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5"
              >
                <Link
                  href={`/notes/${note.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-text transition-colors hover:text-accent"
                >
                  {note.title}
                </Link>
                <span className="shrink-0 text-xs text-text-muted">
                  {DATE.format(note.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8 border-t border-border-subtle pt-4">
        <ConfirmDeleteButton
          action={deleteThisCourse}
          label="Delete course"
          confirmText="Delete this course? Its notes, tasks and events are kept and simply detached."
        />
      </div>
    </div>
  );
}
