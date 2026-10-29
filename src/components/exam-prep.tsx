"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  applyPrepAction,
  proposePrepAction,
  type PrepProposalView,
} from "@/actions/exam-prep";
import { Icon } from "@/components/icons";
import { Mark } from "@/components/template-picker";
import {
  DEFAULT_PREP_HOURS,
  DEFAULT_SESSION_MINUTES,
  PREP_HOURS,
  SESSION_MINUTES,
} from "@/lib/exam-prep";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border-[1.5px] px-3.5 text-sm transition-colors";

function Chips<T extends number>({
  label,
  options,
  value,
  unit,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T;
  unit: string;
  onPick: (value: T) => void;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5">
      <span id={id} className="text-xs font-semibold text-text-faint">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(option)}
              className={`${CHIP} ${
                selected
                  ? "border-accent bg-accent-soft font-semibold text-accent-ink"
                  : "border-control bg-surface text-text hover:bg-surface-subtle"
              }`}
            >
              <Mark checked={selected} />
              {option} {unit}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Exam prep card on a course page. Picks an assessment, a review time and
 * a session length, asks the server for a plan, shows it, and adds the ticked
 * sessions to the calendar only when confirmed: the shape Plan my day uses.
 */
export function ExamPrep({
  assessments,
  defaultId,
}: {
  /** The course's unscored, dated, future assessments, soonest first. */
  assessments: { id: string; label: string }[];
  defaultId: string | null;
}) {
  const router = useRouter();
  const selectId = useId();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [hours, setHours] = useState<(typeof PREP_HOURS)[number]>(DEFAULT_PREP_HOURS);
  const [minutes, setMinutes] = useState<(typeof SESSION_MINUTES)[number]>(DEFAULT_SESSION_MINUTES);
  const [proposal, setProposal] = useState<PrepProposalView | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The page re-renders with a new list when an assessment is added; a choice
  // that is no longer in it falls back to the default.
  const selectedId = assessments.some((a) => a.id === chosenId) ? chosenId : defaultId;

  /** Any change to the controls makes an open proposal stale, so it closes. */
  function change(update: () => void) {
    update();
    setProposal(null);
    setMessage(null);
    setError(null);
  }

  const toggle = (start: number) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });

  const cut = proposal?.shortfall ? proposal.shortfall.indexOf(". ") + 1 : 0;

  return (
    <section
      aria-labelledby="prep-title"
      className="mb-6 rounded-xl border border-border-subtle bg-surface p-5"
    >
      <h2 id="prep-title" className="text-base font-bold text-text">
        Exam prep
      </h2>

      {assessments.length === 0 || !selectedId ? (
        <p className="mt-1 text-sm text-text-muted">
          Add an assessment with a date to plan review sessions.
        </p>
      ) : (
        <>
          <p className="mb-4 mt-1 max-w-xl text-sm leading-normal text-text-muted">
            Review sessions are spread over the days before an assessment, in the free gaps
            of your calendar. Nothing is added until you confirm.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={selectId} className="text-xs font-semibold text-text-faint">
                Assessment
              </label>
              <select
                id={selectId}
                value={selectedId}
                onChange={(event) => change(() => setChosenId(event.target.value))}
                className="min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-sm text-text"
              >
                {assessments.map((assessment) => (
                  <option key={assessment.id} value={assessment.id}>
                    {assessment.label}
                  </option>
                ))}
              </select>
            </div>
            <Chips
              label="Review time"
              options={PREP_HOURS}
              value={hours}
              unit="h"
              onPick={(value) => change(() => setHours(value))}
            />
            <Chips
              label="Session length"
              options={SESSION_MINUTES}
              value={minutes}
              unit="min"
              onPick={(value) => change(() => setMinutes(value))}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              aria-expanded={proposal !== null}
              onClick={() => {
                setError(null);
                setMessage(null);
                startTransition(async () => {
                  const result = await proposePrepAction({
                    assessmentId: selectedId,
                    hours,
                    sessionMinutes: minutes,
                  });
                  if (!result.success) {
                    setError(result.error.message);
                    return;
                  }
                  setProposal(result.data);
                  setTicked(new Set(result.data.sessions.map((session) => session.start)));
                });
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border-strong bg-surface px-4.5 text-sm font-semibold text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
            >
              <Icon name="calendar" />
              {pending && proposal === null ? "Working…" : "Propose a plan"}
            </button>
            <span className="text-sm text-text-muted">
              Six hours is a starting point you choose, not a rule.
            </span>
          </div>
        </>
      )}

      {proposal && (
        <div className="mt-4 flex flex-col gap-3.5 rounded-xl bg-surface-subtle p-4">
          <div>
            <h3 className="text-base font-bold text-text">Review plan for {proposal.title}</h3>
            <p className="mt-1 text-sm leading-normal text-text-muted">
              {proposal.plannedCount > 0 &&
                `Already planned: ${plural(proposal.plannedCount, "session")} (${proposal.plannedHours} h). This plan adds the rest. `}
              {proposal.sessions.length > 0 &&
                `${plural(proposal.sessions.length, "session")} of ${proposal.sessionMinutes} min, spread over the ${proposal.windowDays} days before ${proposal.dueLabel}. Nothing is planned on the day itself.`}
            </p>
          </div>

          {proposal.message && (
            <p role="status" className="rounded-lg bg-surface px-3.5 py-3 text-sm leading-normal text-text">
              {proposal.message}
            </p>
          )}

          {proposal.shortfall && (
            <div role="status" className="flex items-start gap-2.5 rounded-lg bg-warn-soft px-3.5 py-3">
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                aria-hidden="true"
                className="mt-px shrink-0 text-warn"
              >
                <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M9 5v4.4l2.8 1.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="text-sm leading-normal text-text">
                <strong className="text-warn">{proposal.shortfall.slice(0, cut)}</strong>
                {proposal.shortfall.slice(cut)}
              </p>
            </div>
          )}

          {proposal.sessions.length > 0 && (
            <>
              <fieldset className="flex min-w-0 flex-col gap-1.5">
                <legend className="mb-1.5 text-xs font-semibold text-text-faint">Sessions</legend>
                {proposal.sessions.map((session) => (
                  <label
                    key={session.start}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-surface px-3 py-1.5 text-sm transition-colors hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={ticked.has(session.start)}
                      onChange={() => toggle(session.start)}
                      className="size-5 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <span className="text-text">
                        <strong>{session.day}</strong> · {session.time}
                      </span>
                      <span className="text-xs text-text-muted">
                        {session.label} · {session.minutes} min
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="rounded-lg bg-surface px-3.5 py-3 text-sm leading-normal text-text">
                <div className="text-xs font-semibold text-text-faint">What to review</div>
                <p className="mt-2">
                  {proposal.noteCount === 0 ? (
                    "No notes in this course yet."
                  ) : (
                    <>
                      <strong>Notes from this course · {proposal.noteCount}.</strong>{" "}
                      {proposal.notes.map((note, i) => (
                        <span key={note.id}>
                          {i > 0 && ", "}
                          <Link href={`/notes/${note.id}`} className="text-accent hover:underline">
                            {note.title}
                          </Link>
                        </span>
                      ))}
                      {proposal.noteCount > proposal.notes.length &&
                        ` and ${proposal.noteCount - proposal.notes.length} more`}
                      . Each session lists them.
                    </>
                  )}
                </p>
                <p className="mt-2">
                  {proposal.dueCards === 0 ? (
                    "No flashcards are due right now."
                  ) : (
                    <>
                      <Link href="/cards" className="text-accent hover:underline">
                        <strong>{plural(proposal.dueCards, "flashcard")} due</strong>
                      </Link>{" "}
                      now. Cards come due as you study, so open the queue at the start of a
                      session.
                    </>
                  )}
                </p>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {proposal.sessions.length > 0 &&
              (ticked.size > 0 ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await applyPrepAction({
                        assessmentId: proposal.assessmentId,
                        hours,
                        sessionMinutes: minutes,
                        starts: [...ticked],
                      });
                      if (!result.success) {
                        setError(result.error.message);
                        return;
                      }
                      setProposal(null);
                      setMessage(
                        `Added ${plural(result.data.added, "session")} to your calendar. They show on Today and the calendar as planned blocks.`,
                      );
                      router.refresh();
                    });
                  }}
                  className="min-h-11 rounded-lg bg-accent px-4.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? "Adding…" : `Add ${plural(ticked.size, "session")} to my calendar`}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="min-h-11 cursor-not-allowed rounded-lg border border-border-strong bg-surface px-4.5 text-sm font-semibold text-text-faint"
                >
                  Nothing selected
                </button>
              ))}
            <button
              type="button"
              onClick={() => setProposal(null)}
              className="min-h-11 rounded-lg px-3.5 text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm text-text-muted">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
