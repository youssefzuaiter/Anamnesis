import Link from "next/link";
import { formatDuration, sessionsLabel } from "@/lib/study-time";
import type { CourseStudyTime } from "@/services/focus-service";

/*
 * Recorded time for one course, as a short observation. Hidden entirely when nothing is being recorded
 * and nothing has been: a course page does not ask for anything it does not need.
 */

export function CourseStudyCard({ view }: { view: CourseStudyTime }) {
  if (!view.visible) return null;

  const empty = view.writing.sessions + view.timer.sessions === 0;

  return (
    <section
      aria-labelledby="course-time-heading"
      className="mb-6 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="course-time-heading" className="text-sm font-semibold text-text">
          Time on this course
        </h2>
        <span className="text-xs text-text-faint">Last 28 days</span>
      </div>

      {empty ? (
        <p className="mt-2.5 text-sm text-text-muted">
          Nothing recorded for this course in the last 28 days.
        </p>
      ) : (
        <>
          <dl className="mt-2.5 flex flex-col gap-1.5">
            {view.shown.writing && (
              <div className="flex items-baseline gap-3">
                <dt className="w-16 text-xs text-text-muted">Writing</dt>
                <dd className="w-[4.75rem] text-sm font-medium tabular-nums text-text">
                  {formatDuration(view.writing.seconds)}
                </dd>
                <dd className="text-xs text-text-faint">{sessionsLabel(view.writing.sessions)}</dd>
              </div>
            )}
            {view.shown.timer && (
              <div className="flex items-baseline gap-3">
                <dt className="w-16 text-xs text-text-muted">Timer</dt>
                <dd className="w-[4.75rem] text-sm font-medium tabular-nums text-text">
                  {formatDuration(view.timer.seconds)}
                </dd>
                <dd className="text-xs text-text-faint">{sessionsLabel(view.timer.sessions)}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-text-muted">
            Recorded while the switches on the Focus page were on. Anything you studied
            elsewhere is not included.
          </p>
          <Link
            href="/focus#by-course"
            className="flex min-h-11 items-center text-[13px] text-accent hover:underline sm:min-h-0 sm:pt-1"
          >
            Every course, side by side
          </Link>
        </>
      )}
    </section>
  );
}
