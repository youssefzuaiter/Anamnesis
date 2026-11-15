import Link from "next/link";
import { countdown } from "@/lib/exam-readiness";
import type { ExamReadiness } from "@/services/exam-readiness-service";

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const SESSION = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const percent = (value: number) => `${Math.round(value)}%`;
const button =
  "inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold transition-colors";

/**
 * Today's "Next exam" card (ROADMAP item 38): the countdown, how far the review sessions planned for it have got, the cards due for its
 * course, and the mark so far. Everything shown is read from the account; nothing here is a prediction. The mark the exam
 * must reach is not shown, because no target is stored (the grade panel's target is a field on the course page, not saved).
 */
export function ExamReadinessCard({ readiness }: { readiness: ExamReadiness }) {
  const { days, sessions } = readiness;
  const count = countdown(days);
  return (
    <section aria-labelledby="exam-title" className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface px-5 py-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="exam-title" className="text-xs font-semibold text-text-faint">
            Next exam
          </p>
          <p className="mt-1 break-words text-lg font-bold leading-snug text-text">{readiness.title}</p>
          <p className="text-sm text-text-muted">
            {readiness.code} · {DAY.format(readiness.dueDate)} · {TIME.format(readiness.dueDate)}
          </p>
        </div>
        <div className="shrink-0 text-right text-warn" aria-label={`${count.big} ${count.small}`.trim()}>
          <p aria-hidden="true" className={`font-bold leading-none ${count.small ? "text-3xl" : "text-xl"}`}>
            {count.big}
          </p>
          {count.small && (
            <p aria-hidden="true" className="mt-0.5 text-[13px] font-semibold">
              {count.small}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {sessions.total === 0 ? (
          <p className="text-sm text-text-muted">No review planned for this exam.</p>
        ) : (
          <>
            <p className="flex justify-between gap-3 text-sm font-semibold text-text">
              <span>Review sessions</span>
              <span>
                {sessions.done} of {sessions.total} done
              </span>
            </p>
            <div
              role="img"
              aria-label={`${sessions.done} of ${sessions.total} review sessions done`}
              className="h-2 overflow-hidden rounded bg-surface-subtle"
            >
              <div className="h-full bg-accent" style={{ width: `${sessions.percent}%` }} />
            </div>
            <p className="text-[13px] text-text-muted">
              {sessions.next ? `Next: ${SESSION.format(sessions.next.start)} (${sessions.next.minutes} min)` : "None left to do."}
            </p>
          </>
        )}
      </div>

      <dl className="flex flex-col gap-1 border-t border-border-subtle pt-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-text">Flashcards due for {readiness.code}</dt>
          <dd className="shrink-0 whitespace-nowrap font-semibold">
            {readiness.cardsDue > 0 ? (
              <Link href={`/cards?course=${readiness.courseId}`} className="text-accent-ink hover:underline">
                {readiness.cardsDue}, review now
              </Link>
            ) : (
              <span className="text-text-muted">none</span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text">Your mark so far</dt>
          <dd className="shrink-0 whitespace-nowrap font-semibold text-text">{readiness.average === null ? "nothing marked yet" : percent(readiness.average)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text">Best possible in the course</dt>
          <dd className="shrink-0 whitespace-nowrap font-semibold text-text">{percent(readiness.bestPossible)}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Link href={`/courses/${readiness.courseId}#exam-prep`} className={`${button} bg-accent text-on-accent hover:bg-accent-hover`}>
          {sessions.total === 0 ? "Plan review" : "Plan more review"}
        </Link>
        <Link href={`/courses/${readiness.courseId}`} className={`${button} border border-control text-text hover:bg-surface-subtle`}>
          Open course
        </Link>
      </div>
    </section>
  );
}
