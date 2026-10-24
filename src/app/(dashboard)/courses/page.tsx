import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listCourses } from "@/repositories/course-repository";
import { CourseForm } from "@/components/course-form";
import { summarise } from "@/lib/grades";

export const metadata = { title: "Courses · Anamnesis" };

/** "Fall 2026" / "Spring 2027", by the month — a sensible default, not a rule. */
function currentTerm(now = new Date()): string {
  const month = now.getMonth();
  if (month >= 8) return `Fall ${now.getFullYear()}`;
  if (month >= 5) return `Summer ${now.getFullYear()}`;
  return `Spring ${now.getFullYear()}`;
}

export default async function CoursesPage() {
  const userId = await requireUserId();
  const courses = await listCourses(userId);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Courses
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {courses.length} {courses.length === 1 ? "course" : "courses"}. A
          course gathers its timetable, notes, tasks and marks in one place.
        </p>
      </header>

      <CourseForm defaultTerm={currentTerm()} />

      {courses.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          No courses yet. Add one above, then claim its timetable events.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {courses.map((course) => {
            const grade = summarise(course.assessments);
            return (
              <li key={course.id}>
                <Link
                  href={`/courses/${course.id}`}
                  className="block rounded-xl border border-border-subtle bg-surface p-4 transition-colors hover:border-border-strong"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="truncate font-medium text-text">
                      <span className="font-mono text-sm text-accent">
                        {course.code}
                      </span>{" "}
                      {course.title}
                    </h2>
                    <span className="shrink-0 text-xs text-text-muted">
                      {course.term}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-text">
                    {grade.currentAverage === null
                      ? "Nothing marked yet"
                      : `${grade.currentAverage.toFixed(1)}% average · ${grade.remainingWeight.toFixed(0)}% left`}
                  </p>

                  <p className="mt-1 text-xs text-text-muted">
                    {course.counts.notes} notes · {course.counts.openTasks} open
                    of {course.counts.tasks} tasks · {course.counts.events} events
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
