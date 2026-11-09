import Link from "next/link";
import {
  barPercent,
  formatDuration,
  rangeHeading,
  sessionsLabel,
  totalsSentence,
  type Measure,
  type StudyRange,
} from "@/lib/study-time";
import type { StudyTimeView } from "@/services/focus-service";

/*
 * Recorded time per course, as an observation. Two measures, side by side and never added: writing
 * (the focus tracker) and timer (the study timer). Courses are listed by code, not ranked, and nothing
 * here is coloured as good or bad. The bars are only a picture of the numbers beside them.
 */

const RANGES: { range: StudyRange; label: string }[] = [
  { range: "7", label: "7 days" },
  { range: "28", label: "28 days" },
  { range: "all", label: "All recorded" },
];

function MeasureRow({
  label,
  measure,
  scaleSeconds,
  tone,
}: {
  label: string;
  measure: Measure;
  scaleSeconds: number;
  tone: string;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 sm:flex-nowrap sm:items-center">
      <span className="w-14 text-xs text-text-muted">{label}</span>
      <span className="ml-auto text-[13px] font-medium tabular-nums text-text sm:order-3 sm:ml-0 sm:w-16 sm:text-right">
        {formatDuration(measure.seconds)}
      </span>
      <span className="text-xs tabular-nums text-text-faint sm:order-4 sm:w-[5.25rem] sm:text-right">
        {sessionsLabel(measure.sessions)}
      </span>
      <span
        aria-hidden="true"
        className="order-last mt-1 h-2 w-full overflow-hidden rounded bg-surface-subtle sm:order-2 sm:mt-0 sm:w-auto sm:flex-1"
      >
        <span
          className={`block h-full rounded ${tone}`}
          style={{ width: `${barPercent(measure.seconds, scaleSeconds)}%` }}
        />
      </span>
    </div>
  );
}

function emptyMessage(view: StudyTimeView): string {
  if (!view.settings.tracking && !view.settings.timer && !view.hasHistory) {
    return "Recording is off, so nothing has been collected.";
  }
  if (!view.hasHistory) {
    return "Nothing recorded yet. Write a note for a minute, or run the timer on a task, and it will appear here.";
  }
  return `Nothing recorded in the ${rangeHeading(view.range)}.`;
}

export function StudyByCourse({ view }: { view: StudyTimeView }) {
  // Nothing is recorded and nothing ever was: just say so, without a heading, a range or an explanation
  // of numbers that do not exist. (The heading stays for screen readers, which name the region by it.)
  const bare = view.lines.length === 0 && !view.hasHistory;
  const totals = totalsSentence({
    range: view.range,
    shown: view.shown,
    writing: view.writing,
    timer: view.timer,
  });

  return (
    <section id="by-course" aria-labelledby="by-course-heading" className="mt-7">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2
          id="by-course-heading"
          className={bare ? "sr-only" : "text-xs font-semibold text-text-faint"}
        >
          By course · {rangeHeading(view.range)}
        </h2>
        {!bare && (
          <nav aria-label="Time range" className="flex w-full gap-2 sm:w-auto sm:gap-1">
            {RANGES.map(({ range, label }) => (
              <Link
                key={range}
                href={`/focus?range=${range}`}
                aria-current={view.range === range ? "true" : undefined}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-full border px-2.5 text-xs transition-colors sm:min-h-0 sm:flex-none sm:py-1 ${
                  view.range === range
                    ? "border-accent bg-accent-soft text-accent-ink"
                    : "border-border-subtle text-text-muted hover:bg-surface-subtle"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {!bare && (
        <p className="mb-2.5 max-w-prose text-xs text-text-muted">
          Time the app recorded while the switches above were on. It leaves out everything you
          did elsewhere, and says nothing about how well it went. Listed by course code, not
          ranked.
        </p>
      )}

      {view.lines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-5 text-center text-sm text-text-muted">
          {emptyMessage(view)}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
            {view.lines.map((line) => (
              <li key={line.courseId ?? "no-course"} className="px-4 pb-3.5 pt-1 sm:py-3.5">
                {line.courseId ? (
                  <Link
                    href={`/courses/${line.courseId}`}
                    className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-text hover:underline sm:min-h-0"
                  >
                    <span className="font-mono text-[13px] text-accent-ink">{line.code}</span>
                    {line.title}
                  </Link>
                ) : (
                  <span className="flex min-h-11 items-center text-sm font-medium text-text-muted sm:min-h-0">
                    No course
                  </span>
                )}
                {view.shown.writing && (
                  <MeasureRow
                    label="Writing"
                    measure={line.writing}
                    scaleSeconds={view.scaleSeconds}
                    tone="bg-accent"
                  />
                )}
                {view.shown.timer && (
                  <MeasureRow
                    label="Timer"
                    measure={line.timer}
                    scaleSeconds={view.scaleSeconds}
                    tone="bg-control"
                  />
                )}
              </li>
            ))}
          </ul>
          {totals && <p className="mt-2.5 text-xs text-text-muted">{totals}</p>}
          {view.courseHint && (
            <p className="mt-2 text-xs text-text-muted">
              Writing sessions are being recorded without their course, so they all appear
              here. Turn on “Include the course” above to split them from now on. Sessions
              already recorded stay here.
            </p>
          )}
        </>
      )}
    </section>
  );
}
