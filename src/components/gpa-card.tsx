"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveGradeScaleAction, setTargetGpaAction } from "@/actions/gpa";
import {
  defaultExpectedLetter,
  formatGpa,
  neededAverage,
  projectCgpa,
  summariseGpa,
} from "@/lib/gpa";
import {
  DEFAULT_GRADE_SCALE,
  MAX_POINTS,
  maxPoints,
  normaliseLetter,
  type GradeScale,
} from "@/lib/gpa-scale";
import type { GpaOverview } from "@/services/gpa-service";

const TARGET_OPTIONS = [2, 2.5, 3, 3.25, 3.5, 3.75, 4];

const FIELD = "min-h-11 rounded-lg border border-control bg-surface-subtle px-3 text-sm text-text";
const STEP =
  "inline-flex size-11 items-center justify-center rounded-lg border border-control bg-surface-subtle text-lg text-text transition-colors hover:bg-surface-hover";
const OUTLINED =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-hover disabled:opacity-60";
const SECTION_HEADING = "mb-2 mt-6 text-xs font-semibold text-text-faint";
const ICON = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The same letters with the same points, whatever the order. */
function sameScale(a: GradeScale, b: GradeScale): boolean {
  return (
    a.length === b.length &&
    a.every((entry) => b.some((other) => other.letter === entry.letter && other.points === entry.points))
  );
}

/**
 * The GPA card on the Courses page. Everything shown is worked out here, from the same
 * pure functions the server uses, so the what-if (expected letters), the target and the
 * scale draft all preview live. Expected letters are never saved; the target is saved
 * when it changes; the scale is saved only when asked.
 */
export function GpaCard({ courses, marks, scale, targetGpa }: GpaOverview) {
  const [, startTransition] = useTransition();
  const [target, setTarget] = useState<number | null>(targetGpa);
  const [draft, setDraft] = useState<GradeScale>(scale);
  const [savedScale, setSavedScale] = useState<GradeScale>(scale);
  const [expected, setExpected] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (courses.length === 0) return null;

  const summary = summariseGpa(courses, draft);
  const fallbackLetter = defaultExpectedLetter(draft, summary.cgpa);
  const picked = Object.fromEntries(summary.open.map((c) => [c.id, expected[c.id] ?? fallbackLetter]));
  const projected = projectCgpa(summary, picked, draft);
  const needed = target === null ? null : neededAverage(summary, target, draft);
  const top = maxPoints(draft);
  const openTerms = [...new Set(summary.open.map((c) => c.term))];
  const noneOpen = summary.openCredits === 0;
  const targets = [...new Set([...TARGET_OPTIONS, ...(target === null ? [] : [target])])].sort(
    (a, b) => a - b,
  );
  const dirty = !sameScale(draft, savedScale);
  const offPreset = !sameScale(draft, DEFAULT_GRADE_SCALE) || !sameScale(savedScale, DEFAULT_GRADE_SCALE);

  function run(task: () => Promise<{ success: boolean; error: { message: string } | null }>, done: string, then?: () => void) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.success) {
        setMessage(done);
        then?.();
      } else {
        setError(result.error?.message ?? "That could not be saved.");
      }
    });
  }

  function pickTarget(value: string) {
    const next = value === "" ? null : Number.parseFloat(value);
    setTarget(next);
    run(() => setTargetGpaAction(next), "Target saved.");
  }

  function stepPoints(letter: string, delta: number) {
    setMessage(null);
    setDraft((current) =>
      current.map((entry) =>
        entry.letter === letter
          ? { ...entry, points: Math.min(MAX_POINTS, Math.max(0, Math.round((entry.points + delta) * 10) / 10)) }
          : entry,
      ),
    );
  }

  function saveScale() {
    const next = draft;
    run(() => saveGradeScaleAction(next), "Scale saved.", () => setSavedScale(next));
  }

  function resetScale() {
    const preset = DEFAULT_GRADE_SCALE.map((entry) => ({ ...entry }));
    setDraft(preset);
    run(() => saveGradeScaleAction(null), "Scale saved.", () => setSavedScale(preset));
  }

  // What to say about the target.
  let headline = "";
  let detail = "";
  let tone = "bg-surface-subtle text-text-muted";
  let icon: "needed" | "achieved" | "impossible" | null = null;
  if (needed?.kind === "needed") {
    const where = needed.exact
      ? `exactly ${needed.upper}`
      : needed.lower
        ? `between ${needed.lower} and ${needed.upper}`
        : `${needed.upper} or better`;
    headline = `You need an average of ${formatGpa(needed.points)} on the ${summary.openCredits} open credits.`;
    detail = `That is ${where}. Your expected letters give ${formatGpa(projected.expectedAverage)}.`;
    tone = "bg-accent-soft text-accent-ink";
    icon = "needed";
  } else if (needed?.kind === "achieved") {
    headline = `You are already at or above ${formatGpa(target)}.`;
    detail = noneOpen
      ? "No credits are open, so this is your final GPA."
      : `Even a straight ${draft[draft.length - 1].letter} on the ${summary.openCredits} open credits would leave you at ${formatGpa(needed.worst)}.`;
    tone = "bg-ok-soft text-ok";
    icon = "achieved";
  } else if (needed?.kind === "impossible") {
    headline = noneOpen
      ? `${formatGpa(target)} is out of reach with no credits open.`
      : `${formatGpa(target)} is out of reach with the open credits.`;
    detail = noneOpen
      ? `Your GPA is ${formatGpa(needed.best)}, which is ${formatGpa(needed.short)} short.`
      : `A straight ${draft[0].letter} on all ${summary.openCredits} of them gives ${formatGpa(needed.best)}, which is ${formatGpa(needed.short)} short.`;
    tone = "bg-warn-soft text-warn";
    icon = "impossible";
  } else if (needed?.kind === "no-credits") {
    headline = "Nothing to work from yet.";
    detail = "Give a course its credits, and a final grade once you have one.";
  }

  const fillPct = Math.max(0, Math.min(100, ((projected.expectedAverage ?? 0) / top) * 100));
  const tickPct = needed?.kind === "needed" ? Math.max(0, Math.min(100, (needed.points / top) * 100)) : null;

  return (
    <section
      aria-labelledby="gpa-title"
      className="mb-6 rounded-xl border border-border-subtle bg-surface p-5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="gpa-title" className="text-base font-semibold text-text">
          Grade point average
        </h2>
        <span className="text-xs text-text-faint">
          Letter scale: {draft[0].letter} to {draft[draft.length - 1].letter}, {top.toFixed(1)}
          {sameScale(draft, DEFAULT_GRADE_SCALE) ? "" : ", edited"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div role="group" aria-labelledby="cgpa-label">
          <div id="cgpa-label" className="text-xs font-semibold text-text-faint">
            Cumulative GPA
          </div>
          <div className="my-0.5 text-4xl font-bold leading-tight tracking-tight tabular-nums text-text">
            {formatGpa(summary.cgpa)}
          </div>
          <div className="text-[13px] leading-relaxed text-text-muted">
            {summary.credits > 0
              ? `${plural(summary.credits, "credit")} counted across ${plural(summary.terms.length, "term")}`
              : "Nothing counted yet. Give a course credits and a final grade."}
          </div>
        </div>
        <div role="group" aria-labelledby="projected-label">
          <div id="projected-label" className="text-xs font-semibold text-text-faint">
            {openTerms.length === 1
              ? `If ${openTerms[0]} goes as expected`
              : "If your open courses go as expected"}
          </div>
          <div className="my-0.5 text-4xl font-bold leading-tight tracking-tight tabular-nums text-text">
            {formatGpa(projected.cgpa)}
          </div>
          <div className="text-[13px] leading-relaxed text-text-muted">
            {noneOpen
              ? "No open courses."
              : `With ${plural(summary.openCredits, "more credit")}, ${projected.credits} in all`}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="target" className="mb-1.5 block text-xs font-semibold text-text-faint">
            Target CGPA
          </label>
          <select
            id="target"
            value={target === null ? "" : target.toFixed(2)}
            onChange={(event) => pickTarget(event.target.value)}
            className={`${FIELD} w-full max-w-50`}
          >
            <option value="">No target</option>
            {targets.map((value) => (
              <option key={value} value={value.toFixed(2)}>
                {value.toFixed(2)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {needed === null ? (
        <p className="mt-4 text-sm text-text-muted">
          Pick a target to see what you need on the open credits.
        </p>
      ) : (
        <>
          <div className={`mt-4 flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-sm leading-relaxed ${tone}`}>
            {icon === "needed" && (
              <svg {...ICON} className="mt-px flex-none">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            )}
            {icon === "achieved" && (
              <svg {...ICON} className="mt-px flex-none">
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.5 2.5 2.5 4.5-5" />
              </svg>
            )}
            {icon === "impossible" && (
              <svg {...ICON} className="mt-px flex-none">
                <path d="M12 3 2.5 20h19L12 3Z" />
                <path d="M12 10v4" />
                <path d="M12 17.5h.01" />
              </svg>
            )}
            <span className="min-w-0">
              <strong className="block font-semibold">{headline}</strong>
              <span className="mt-0.5 block">{detail}</span>
            </span>
          </div>

          {needed.kind !== "no-credits" && (
            <>
              <div
                aria-hidden="true"
                className="relative mb-1.5 mt-4 h-2 rounded-full bg-surface-subtle"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-accent"
                  style={{ width: `${fillPct}%` }}
                />
                {tickPct !== null && (
                  <div
                    className="absolute -top-1 h-[18px] w-[3px] rounded-sm bg-text"
                    style={{ left: `calc(${tickPct}% - 1px)` }}
                  />
                )}
              </div>
              <div
                aria-hidden="true"
                className="flex justify-between text-xs tabular-nums text-text-faint"
              >
                <span>0.00</span>
                <span>{top.toFixed(2)}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                Bar: your expected average, {formatGpa(projected.expectedAverage)}
                {needed.kind === "needed"
                  ? `. Marker: the average you need, ${formatGpa(needed.points)}.`
                  : "."}
              </p>
            </>
          )}
        </>
      )}

      <p role="status" className="mt-2 min-h-5 text-xs text-text-muted">
        {message}
      </p>
      {error && (
        <p role="alert" className="mt-1 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <h3 className={SECTION_HEADING}>
        Open courses · {summary.open.length} · {plural(summary.openCredits, "credit")}
      </h3>
      {summary.open.length === 0 ? (
        <p className="text-sm text-text-muted">
          No course is waiting for a grade. A course with credits and no final letter appears here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {summary.open.map((course) => {
            const mark = marks[course.id];
            return (
              <li
                key={course.id}
                className="flex flex-col gap-2.5 rounded-[10px] border border-border-subtle bg-surface px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-snug text-text">
                    <span className="font-mono text-[13px] text-accent-ink">{course.code}</span> {course.title}
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-text-muted">
                    {plural(course.credits, "credit")} ·{" "}
                    {mark?.average == null
                      ? "nothing marked yet"
                      : `marks so far ${Math.round(mark.average)}%, ${Math.round(mark.remaining)}% still to come`}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-start">
                  <label
                    htmlFor={`expected-${course.id}`}
                    className="text-xs font-semibold text-text-faint"
                  >
                    Expected
                  </label>
                  <select
                    id={`expected-${course.id}`}
                    aria-label={`Expected letter for ${course.code}`}
                    value={picked[course.id]}
                    onChange={(event) =>
                      setExpected((current) => ({ ...current, [course.id]: event.target.value }))
                    }
                    className={`${FIELD} min-w-22`}
                  >
                    {draft.map((entry) => (
                      <option key={entry.letter} value={entry.letter}>
                        {entry.letter}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs leading-relaxed text-text-faint">
        Expected letters are only for this what-if and are not saved. Marks so far are shown for
        reference and never turned into a letter.
      </p>

      {summary.terms.length > 0 && (
        <>
          <h3 className={SECTION_HEADING}>By term</h3>
          <ul className="rounded-[10px] border border-border-subtle">
            {summary.terms.map((term) => (
              <li
                key={term.term}
                className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-3.5 py-3 last:border-b-0"
              >
                <span className="text-sm font-medium text-text">{term.term}</span>
                <span className="text-xs text-text-muted">{plural(term.credits, "credit")}</span>
                <span className="min-w-11 text-right text-[15px] font-semibold tabular-nums text-text">
                  {formatGpa(term.gpa)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {summary.notCounted.length > 0 && (
        <>
          <h3 className={SECTION_HEADING}>Not counted · {summary.notCounted.length}</h3>
          <ul className="flex flex-col gap-2">
            {summary.notCounted.map(({ course, reason }) => (
              <li
                key={course.id}
                className="flex flex-wrap items-start gap-2.5 rounded-[10px] border border-border-subtle bg-surface px-3.5 py-3 sm:flex-nowrap sm:items-center"
              >
                <svg {...ICON} width={16} height={16} className="mt-0.5 flex-none text-warn">
                  <path d="M12 3 2.5 20h19L12 3Z" />
                  <path d="M12 10v4" />
                  <path d="M12 17.5h.01" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-snug text-text">
                    <span className="font-mono text-[13px] text-accent-ink">{course.code}</span> {course.title}
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-text-muted">
                    {reason === "letter-not-in-scale"
                      ? `Its letter, ${normaliseLetter(course.finalGrade ?? "") ?? course.finalGrade}, is not in your letter scale, so it is left out.`
                      : course.finalGrade && course.finalGrade.trim() !== ""
                        ? "Credits are not set."
                        : "Credits are not set, so it cannot be part of the open credits."}
                  </div>
                </div>
                <Link href={`/courses/${course.id}`} className={`${OUTLINED} flex-none no-underline`}>
                  {reason === "letter-not-in-scale" ? "Change grade" : "Set credits"}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <details id="letter-scale" className="mt-5 border-t border-border-subtle pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-text">
          Edit the letter scale
        </summary>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-text-muted">
          This is a starting point. Check it against your university&apos;s own table before trusting
          the numbers. A letter that is not listed here is not counted.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {draft.map((entry) => (
            <div
              key={entry.letter}
              className="flex items-center gap-2 rounded-[10px] border border-border-subtle py-1 pl-3 pr-1"
            >
              <span className="min-w-8 text-sm font-semibold text-text">{entry.letter}</span>
              <span className="flex-1 text-sm tabular-nums text-text-muted">
                {entry.points.toFixed(1)} points
              </span>
              <button
                type="button"
                aria-label={`Lower ${entry.letter} by 0.1`}
                onClick={() => stepPoints(entry.letter, -0.1)}
                className={STEP}
              >
                −
              </button>
              <button
                type="button"
                aria-label={`Raise ${entry.letter} by 0.1`}
                onClick={() => stepPoints(entry.letter, 0.1)}
                className={STEP}
              >
                +
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {dirty && (
            <>
              <button type="button" onClick={saveScale} className={OUTLINED}>
                Save scale
              </button>
              <span className="text-xs text-text-muted">Not saved yet</span>
            </>
          )}
          {offPreset && (
            <button type="button" onClick={resetScale} className={OUTLINED}>
              Reset to preset
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
