"use client";

import { useId, useRef, useState, useTransition } from "react";
import { setCourseGradeAction } from "@/actions/gpa";
import { MAX_CREDITS, courseEffect, formatGpa } from "@/lib/gpa";
import type { GradeScale } from "@/lib/gpa-scale";

const OTHER = "__other__";

const FIELD =
  "min-h-11 w-full max-w-60 rounded-lg border border-control bg-surface-subtle px-3 text-sm text-text";
const STEP =
  "inline-flex size-11 items-center justify-center rounded-lg border border-control bg-surface-subtle text-lg text-text transition-colors hover:bg-surface-hover";

/**
 * Credits and the official final letter of one course. Local state leads: every change
 * sends the latest values as they stand (never a delta), because Next dispatches a
 * client's actions one at a time, in order, so the last one sent is the one that stays.
 */
export function CourseGrade({
  courseId,
  credits: initialCredits,
  finalGrade,
  scale,
  base,
}: {
  courseId: string;
  credits: number | null;
  finalGrade: string | null;
  scale: GradeScale;
  /** Credits and quality points of every other counted course. */
  base: { credits: number; qualityPoints: number };
}) {
  const creditsLabel = useId();
  const [, startTransition] = useTransition();
  const [credits, setCredits] = useState(initialCredits ?? 0);
  const [letter, setLetter] = useState(finalGrade ?? "");
  const [other, setOther] = useState(
    finalGrade !== null && finalGrade !== "" && !scale.some((entry) => entry.letter === finalGrade),
  );
  const [inFlight, setInFlight] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ credits: initialCredits ?? 0, letter: finalGrade ?? "" });

  function save(next: { credits: number; letter: string }) {
    latest.current = next;
    setInFlight((count) => count + 1);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await setCourseGradeAction(
        courseId,
        next.credits > 0 ? next.credits : null,
        next.letter === "" ? null : next.letter,
      );
      setInFlight((count) => count - 1);
      if (result.success) setSaved(true);
      else setError(result.error.message);
    });
  }

  function stepCredits(delta: number) {
    const next = Math.min(MAX_CREDITS, Math.max(0, latest.current.credits + delta));
    setCredits(next);
    save({ ...latest.current, credits: next });
  }

  function pickLetter(value: string) {
    if (value === OTHER) {
      setOther(true);
      return;
    }
    setOther(false);
    setLetter(value);
    save({ ...latest.current, letter: value });
  }

  function commitOther(raw: string) {
    const value = raw.trim().toUpperCase();
    if (value === "") {
      setOther(false);
      setLetter("");
      save({ ...latest.current, letter: "" });
      return;
    }
    setLetter(value);
    save({ ...latest.current, letter: value });
  }

  const effect = courseEffect(base, credits > 0 ? credits : null, letter === "" ? null : letter, scale);
  const tone =
    effect.kind === "counted"
      ? "bg-ok-soft text-ok"
      : effect.kind === "no-letter"
        ? "bg-surface-subtle text-text-muted"
        : "bg-warn-soft text-warn";

  return (
    <section
      aria-labelledby="grade-title"
      className="mb-6 rounded-xl border border-border-subtle bg-surface p-5 shadow-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="grade-title" className="text-base font-semibold text-text">
          Credits and final grade
        </h2>
        <span role="status" className="text-xs text-text-faint">
          {inFlight > 0 ? "Saving…" : saved ? "Saved" : ""}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
        These feed your GPA on the Courses page.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div id={creditsLabel} className="mb-1.5 text-xs font-semibold text-text-faint">
            Credits
          </div>
          <div role="group" aria-labelledby={creditsLabel} className="flex items-center gap-2">
            <button
              type="button"
              aria-label="One credit fewer"
              onClick={() => stepCredits(-1)}
              className={STEP}
            >
              −
            </button>
            <span className="min-w-10 text-center text-xl font-semibold tabular-nums text-text">
              {credits}
            </span>
            <button
              type="button"
              aria-label="One credit more"
              onClick={() => stepCredits(1)}
              className={STEP}
            >
              +
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="final-grade" className="mb-1.5 block text-xs font-semibold text-text-faint">
            Final grade
          </label>
          <select
            id="final-grade"
            value={other ? OTHER : letter}
            onChange={(event) => pickLetter(event.target.value)}
            className={FIELD}
          >
            <option value="">Not graded yet</option>
            {scale.map((entry) => (
              <option key={entry.letter} value={entry.letter}>
                {entry.letter} · {entry.points.toFixed(1)} points
              </option>
            ))}
            <option value={OTHER}>Other letter…</option>
          </select>
          {other && (
            <input
              type="text"
              aria-label="Other letter"
              defaultValue={letter}
              maxLength={4}
              autoFocus
              autoCapitalize="characters"
              onBlur={(event) => commitOther(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitOther(event.currentTarget.value);
                }
              }}
              className={`${FIELD} mt-2 uppercase`}
            />
          )}
        </div>
      </div>

      <div className={`mt-4 rounded-[10px] px-3.5 py-3 text-sm leading-relaxed ${tone}`}>
        {effect.kind === "counted" && (
          <>
            <strong className="block font-semibold">Counted in your GPA.</strong>
            <span className="mt-0.5 block">
              {credits} {credits === 1 ? "credit" : "credits"} × {(effect.qualityPoints / credits).toFixed(1)} points ={" "}
              {effect.qualityPoints.toFixed(1)} quality points.{" "}
              {effect.before === null
                ? `Your CGPA would be ${formatGpa(effect.after)}.`
                : `Your CGPA moves from ${formatGpa(effect.before)} to ${formatGpa(effect.after)} (${
                    effect.after >= effect.before ? "+" : "−"
                  }${Math.abs(effect.after - effect.before).toFixed(2)}).`}
            </span>
          </>
        )}
        {effect.kind === "no-letter" && (
          <>
            <strong className="block font-semibold">Not counted yet.</strong>
            <span className="mt-0.5 block">
              Pick the official letter once your university publishes it.
            </span>
          </>
        )}
        {effect.kind === "no-credits" && (
          <>
            <strong className="block font-semibold">Not counted: credits are not set.</strong>
            <span className="mt-0.5 block">
              Give the course its credits so it can weigh in on your GPA.
            </span>
          </>
        )}
        {effect.kind === "not-in-scale" && (
          <>
            <strong className="block font-semibold">
              Not counted: {effect.letter} is not in your letter scale.
            </strong>
            <span className="mt-0.5 block">
              It is left out of the GPA, as a pass/fail grade would be.
            </span>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-text-faint">
        Enter the official letter once your university publishes it. A letter is never worked out
        from the marks below, because many universities curve the final grade.
      </p>
    </section>
  );
}
