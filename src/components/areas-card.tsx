"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAreasAction } from "@/actions/areas";
import type { Areas } from "@/lib/areas";

const CHOICES: { value: Areas; title: string; text: string }[] = [
  { value: "school", title: "School", text: "Courses, exams, assessments, grades and GPA, flashcards, quizzes, study stats." },
  { value: "work", title: "Work", text: "Projects, deadlines and meetings, with no grading. Courses, Cards, Review and Stats are hidden." },
  { value: "both", title: "Both", text: "For a working student. Today can be looked at as School or Work, and nothing is hidden." },
];

/** Which areas of life the account keeps (ROADMAP item 56). Saves on change; turning an area off hides pages and deletes nothing. */
export function AreasCard({ initial }: { initial: Areas }) {
  const router = useRouter();
  const name = useId();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [areas, setAreas] = useState<Areas>(initial);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  function choose(value: Areas) {
    if (busy.current || value === areas) return;
    busy.current = true;
    const previous = areas;
    setAreas(value);
    setError(null);
    setStatus("");
    startTransition(async () => {
      try {
        const response = await setAreasAction(value);
        if (!response.success) {
          setAreas(previous);
          setError(response.error.message);
          return;
        }
        setStatus("Saved.");
        router.refresh();
      } catch {
        setAreas(previous);
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <section aria-labelledby={`${name}-h`} className="rounded-xl border border-border-subtle bg-surface p-4">
      <h2 id={`${name}-h`} className="text-sm font-semibold text-text">Areas</h2>
      <p className="mt-1 text-[13px] text-text-muted">Choose which parts of your life this app keeps. Turning one off only hides its pages: nothing is deleted, and your notes, tasks and projects are the same data.</p>
      <fieldset className="mt-3 grid gap-3 sm:grid-cols-3" disabled={pending}>
        <legend className="sr-only">Areas</legend>
        {CHOICES.map((choice) => (
          <label key={choice.value} className={`flex min-h-11 cursor-pointer flex-col gap-1.5 rounded-xl border p-3.5 ${areas === choice.value ? "border-2 border-accent bg-accent-soft" : "border-border-strong bg-surface hover:bg-surface-subtle"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-text">
              <input type="radio" name={name} value={choice.value} checked={areas === choice.value} onChange={() => choose(choice.value)} className="h-4 w-4 accent-[var(--accent)]" />
              {choice.title}
            </span>
            <span className="text-[13px] text-text-muted">{choice.text}</span>
          </label>
        ))}
      </fieldset>
      <p className="mt-3 text-xs text-text-muted">A task or event counts as School when it has a course or a University project, and as Work when it is under a Work or Career project. Anything else belongs to neither and is always shown.</p>
      <p role="status" className="mt-2 text-[13px] text-text-muted empty:hidden">{status}</p>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">{error}</p>}
    </section>
  );
}
