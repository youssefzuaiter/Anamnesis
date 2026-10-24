"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import {
  addAssessmentAction,
  setAssessmentScoreAction,
  deleteAssessmentAction,
  linkTimetableAction,
} from "@/actions/courses";
import { summarise, neededForTarget, type Assessed } from "@/lib/grades";

export type AssessmentRow = {
  id: string;
  title: string;
  weight: number;
  score: number | null;
  maxScore: number;
  dueDate: string | null;
};

const FIELD =
  "rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add assessment"}
    </button>
  );
}

function ScoreCell({ row }: { row: AssessmentRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(row.score === null ? "" : String(row.score));

  return (
    <input
      value={value}
      disabled={pending}
      inputMode="decimal"
      aria-label={`Score for ${row.title}`}
      placeholder="—"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const normalized = value.trim();
        const unchanged =
          normalized === (row.score === null ? "" : String(row.score));
        if (unchanged) return;
        startTransition(async () => {
          await setAssessmentScoreAction(row.id, normalized);
          // Every figure above this input is derived from the scores, so the
          // panel has to re-render for the new mark to show up in them.
          router.refresh();
        });
      }}
      className={`w-20 text-right tabular-nums ${FIELD} disabled:opacity-60`}
    />
  );
}

export function GradePanel({
  courseId,
  assessments,
}: {
  courseId: string;
  assessments: AssessmentRow[];
}) {
  const [state, formAction] = useActionState<ApiResponse<null> | null, FormData>(
    addAssessmentAction.bind(null, courseId),
    null,
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [target, setTarget] = useState(80);
  const [pending, startTransition] = useTransition();
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  const items: Assessed[] = assessments.map((row) => ({
    weight: row.weight,
    score: row.score,
    maxScore: row.maxScore,
  }));
  const summary = summarise(items);
  const needed = neededForTarget(summary, target);

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border-subtle bg-surface p-4">
          <p className="text-2xl font-semibold tabular-nums text-text">
            {summary.currentAverage === null
              ? "—"
              : `${summary.currentAverage.toFixed(1)}%`}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">Average so far</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface p-4">
          <p className="text-2xl font-semibold tabular-nums text-text">
            {summary.earned.toFixed(1)}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">Points banked</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface p-4">
          <p className="text-2xl font-semibold tabular-nums text-text">
            {summary.remainingWeight.toFixed(0)}%
          </p>
          <p className="mt-0.5 text-xs text-text-muted">Still to come</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface p-4">
          <p className="text-2xl font-semibold tabular-nums text-text">
            {summary.bestPossible.toFixed(0)}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">Best possible</p>
        </div>
      </section>

      {summary.declaredWeight !== 100 && assessments.length > 0 && (
        <p className="text-xs text-text-muted">
          The weights add up to {summary.declaredWeight.toFixed(0)}%, not 100 —
          the figures above are read against what you have entered, so add the
          missing components for a true picture.
        </p>
      )}

      <section className="rounded-xl border border-border-subtle bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">To finish on</span>
          <input
            type="number"
            value={target}
            min={0}
            max={100}
            aria-label="Target mark"
            onChange={(event) => setTarget(Number(event.target.value))}
            className={`w-20 tabular-nums ${FIELD}`}
          />
          <span className="text-text-muted">overall,</span>
          {needed.kind === "achieved" && (
            <span className="font-medium text-text">
              you already have it — {summary.earned.toFixed(1)} points banked.
            </span>
          )}
          {needed.kind === "impossible" && (
            <span className="font-medium text-danger">
              it is out of reach by {needed.short.toFixed(1)} points, even with
              full marks on everything left.
            </span>
          )}
          {needed.kind === "needed" && (
            <span className="font-medium text-text">
              you need {needed.percent.toFixed(1)}% across the remaining{" "}
              {summary.remainingWeight.toFixed(0)}%.
            </span>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-text-faint">
          Assessments · {assessments.length}
        </h2>

        {assessments.length > 0 && (
          <ul className="mb-3 flex flex-col gap-2">
            {assessments.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {row.title}
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {row.weight}% of course
                </span>
                {row.dueDate && (
                  <span className="shrink-0 text-xs text-text-muted">
                    {row.dueDate}
                  </span>
                )}
                <ScoreCell row={row} />
                <span className="shrink-0 text-xs text-text-muted">
                  / {row.maxScore}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Delete “${row.title}”?`)) return;
                    startTransition(async () => {
                      await deleteAssessmentAction(row.id);
                      router.refresh();
                    });
                  }}
                  className="shrink-0 text-xs text-text-muted transition-colors hover:text-danger"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          ref={formRef}
          action={formAction}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-border-subtle bg-surface p-4"
        >
          <input
            name="title"
            placeholder="Midterm"
            required
            maxLength={120}
            aria-label="Assessment name"
            className={`min-w-0 flex-1 ${FIELD}`}
          />
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Weight %
            <input
              name="weight"
              type="number"
              min={0}
              max={100}
              step="0.5"
              required
              defaultValue={20}
              className={`w-24 tabular-nums ${FIELD}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Score
            <input
              name="score"
              inputMode="decimal"
              placeholder="—"
              className={`w-20 tabular-nums ${FIELD}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Out of
            <input
              name="maxScore"
              type="number"
              min={1}
              defaultValue={100}
              className={`w-20 tabular-nums ${FIELD}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Due
            <input name="dueDate" type="date" className={FIELD} />
          </label>
          <AddButton />
        </form>

        {state && !state.success && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {state.error.message}
          </p>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setLinkMessage(null);
            startTransition(async () => {
              const result = await linkTimetableAction(courseId);
              setLinkMessage(
                result.success
                  ? result.data.linked === 0
                    ? "No unclaimed events matched this course code."
                    : `Linked ${result.data.linked} timetable ${
                        result.data.linked === 1 ? "event" : "events"
                      }.`
                  : result.error.message,
              );
              if (result.success) router.refresh();
            });
          }}
          className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
        >
          Claim matching timetable events
        </button>
        {linkMessage && (
          <p className="text-xs text-text-muted">{linkMessage}</p>
        )}
      </section>
    </div>
  );
}
