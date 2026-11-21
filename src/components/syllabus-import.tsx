"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAssessmentsAction, findAssessmentsAction } from "@/actions/syllabus";
import { MAX_ROWS, totalWeight } from "@/lib/syllabus";

export type SyllabusNote = { id: string; title: string };

type Row = { key: number; on: boolean; title: string; weight: string; dueDate: string; quote: string; existing: boolean };

const FIELD =
  "min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none sm:min-h-10";
const GRID = "grid grid-cols-1 gap-2 sm:grid-cols-[2rem_minmax(0,1.4fr)_5.5rem_9.5rem_minmax(0,1.6fr)] sm:items-center sm:gap-3";

const numberOrNull = (text: string): number | null => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
};

/**
 * "Read the assessments from a note" on a course page (ROADMAP item 50). The model reads one note and proposes assessments; each row quotes the line
 * it came from and can be edited or unticked, and nothing is saved until Add. Only name, weight and date are sent back, never anything of the note.
 */
export function SyllabusImport({ courseId, courseCode, inCourse, elsewhere, defaultNoteId }: {
  courseId: string;
  courseCode: string;
  inCourse: SyllabusNote[];
  elsewhere: SyllabusNote[];
  defaultNoteId: string | null;
}) {
  const router = useRouter();
  const selectId = useId();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [noteId, setNoteId] = useState(defaultNoteId ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  if (inCourse.length + elsewhere.length === 0) return null;

  function find() {
    if (busy.current || noteId === "") return;
    busy.current = true;
    setError(null);
    setStatus("");
    setRows(null);
    setReading(true);
    startTransition(async () => {
      try {
        const response = await findAssessmentsAction(courseId, noteId);
        if (!response.success) {
          setError(response.error.message);
          return;
        }
        const { rows: found, noteTitle: title } = response.data;
        setNoteTitle(title);
        if (found.length === 0) {
          setStatus(`No assessments found in “${title}”. A syllabus lists them with a name and a weight, like “Midterm, 30%”. Try another note, or add them by hand.`);
          return;
        }
        setRows(found.map((row, key) => ({ key, on: !row.existing, title: row.title, weight: row.weight === null ? "" : String(row.weight), dueDate: row.dueDate ?? "", quote: row.quote, existing: row.existing })));
        setStatus(`Found ${found.length} ${found.length === 1 ? "assessment" : "assessments"} in “${title}”. Nothing is saved until you add them. Check each against the quoted line.`);
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
        setReading(false);
      }
    });
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current?.map((row) => (row.key === key ? { ...row, ...patch } : row)) ?? null);
  }

  const ticked = rows?.filter((row) => row.on) ?? [];
  const total = totalWeight((rows ?? []).map((row) => ({ weight: numberOrNull(row.weight), on: row.on })));

  function add() {
    if (busy.current || !rows) return;
    for (const row of ticked) {
      const weight = numberOrNull(row.weight);
      if (row.title.trim() === "") return void setError("Every assessment needs a name.");
      if (weight === null || weight < 0 || weight > 100) return void setError(`“${row.title.trim()}” needs a weight from 0 to 100.`);
    }
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await addAssessmentsAction(courseId, ticked.map((row) => ({ title: row.title.trim(), weight: numberOrNull(row.weight) as number, dueDate: row.dueDate === "" ? null : row.dueDate })));
        if (!response.success) {
          setError(response.error.message);
          return;
        }
        const n = response.data.created;
        setRows(null);
        setStatus(`Added ${n} ${n === 1 ? "assessment" : "assessments"} to ${courseCode}.`);
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <section aria-labelledby={`${selectId}-h`} className="mb-6 rounded-xl border border-border-subtle bg-surface p-4">
      <h2 id={`${selectId}-h`} className="text-sm font-semibold text-text">Assessments from a syllabus</h2>
      <div className="mt-3 flex flex-col gap-3 rounded-xl bg-surface-subtle p-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={selectId} className="text-[13px] font-semibold text-text">Read the assessments from a note</label>
          <select id={selectId} value={noteId} onChange={(event) => setNoteId(event.target.value)} className={FIELD}>
            {noteId === "" && <option value="">Choose a note</option>}
            {inCourse.length > 0 && (
              <optgroup label="In this course">
                {inCourse.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
              </optgroup>
            )}
            {elsewhere.length > 0 && (
              <optgroup label="Not in any course">
                {elsewhere.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <button type="button" onClick={find} disabled={pending || noteId === ""} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60 sm:min-h-10">
          {reading ? "Reading…" : "Find assessments"}
        </button>
      </div>
      {reading && <p className="mt-2 text-xs text-text-muted">Reading the note with the local model. A longer syllabus can take a minute.</p>}

      <p role="status" className="mt-3 text-[13px] text-text-muted empty:hidden">{status}</p>

      {rows && (
        <div className="mt-3 flex flex-col gap-3">
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
            <li className={`hidden bg-surface-subtle px-3 py-2 text-xs font-semibold text-text-muted sm:grid ${GRID}`} aria-hidden>
              <span>Add</span><span>Name</span><span>Weight</span><span>Due date</span><span>From “{noteTitle}”</span>
            </li>
            {rows.map((row, index) => (
              <li key={row.key} className={`px-3 py-3 ${GRID}`}>
                <label className="flex min-h-11 items-center gap-2 text-[13px] font-semibold text-text sm:min-h-0">
                  <input type="checkbox" checked={row.on} onChange={(event) => update(row.key, { on: event.target.checked })} className="h-5 w-5 accent-[var(--accent)]" aria-label={`Add row ${index + 1}`} />
                  <span className="sm:sr-only">Add this one</span>
                </label>
                <input value={row.title} onChange={(event) => update(row.key, { title: event.target.value })} maxLength={120} aria-label={`Name, row ${index + 1}`} className={FIELD} />
                <div className="flex items-center gap-1.5">
                  <input value={row.weight} onChange={(event) => update(row.key, { weight: event.target.value })} inputMode="decimal" placeholder="weight" aria-label={`Weight in percent, row ${index + 1}`} className={FIELD} />
                  <span className="text-sm text-text-muted" aria-hidden>%</span>
                </div>
                <input type="date" value={row.dueDate} onChange={(event) => update(row.key, { dueDate: event.target.value })} aria-label={`Due date, row ${index + 1}`} className={FIELD} />
                <div className="min-w-0 text-xs text-text-muted">
                  <p className="break-words">“{row.quote}”</p>
                  {row.existing && <p className="mt-1 font-semibold text-warn">You already have “{row.title.trim()}”{row.on ? "." : ", so it is not ticked. Tick it to add a second one."}</p>}
                  {row.dueDate === "" && <p className="mt-1">No date in the note; add one if you want it on your calendar.</p>}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-text-muted">
            Total weight <strong className="text-text">{Number.isInteger(total) ? total : total.toFixed(1)} %</strong> across the {ticked.length} you are adding.
            {ticked.length > 0 && total !== 100 && " The weights do not have to add up to 100, but they usually do: check the rows."} Dates that are not written as a day and month, such as “week 7”, are left for you to set.
          </p>
          {rows.length >= MAX_ROWS && <p className="text-xs text-text-muted">A proposal shows at most {MAX_ROWS} rows.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={add} disabled={pending || ticked.length === 0} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60 sm:min-h-10">
              {pending ? "Adding…" : `Add ${ticked.length} ${ticked.length === 1 ? "assessment" : "assessments"}`}
            </button>
            <button type="button" disabled={pending} onClick={() => { setRows(null); setStatus(""); setError(null); }} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle disabled:opacity-60 sm:min-h-10">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] font-semibold text-danger">{error}</p>}
      <p className="mt-3 text-xs text-text-muted">The model reads the note in sections and can be wrong: each row quotes the line it came from so you can check it. It never adds anything on its own.</p>
    </section>
  );
}
