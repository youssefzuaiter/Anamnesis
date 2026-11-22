"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPostTasksAction, readPostAction } from "@/actions/post-intake";
import { MAX_POST_CHARS } from "@/lib/post-intake";

type CourseOption = { id: string; code: string; title: string };
type Row = { key: number; on: boolean; title: string; dueDate: string; quote: string; existing: boolean };

const FIELD =
  "min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none sm:min-h-10";
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60 sm:min-h-10";

/**
 * "Add from a teacher's post" (ROADMAP item 55): paste a post, check the proposed tasks against the sentence each came from, add the ones you want.
 * Nothing is saved before Add; only title, date, course and a note go back to the server.
 */
export function PostIntake({ courses, defaultCourseId = null }: { courses: CourseOption[]; defaultCourseId?: string | null }) {
  const router = useRouter();
  const id = useId();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [courseId, setCourseId] = useState(defaultCourseId ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  function read() {
    if (busy.current || text.trim() === "") return;
    busy.current = true;
    setError(null);
    setStatus("");
    setRows(null);
    setReading(true);
    startTransition(async () => {
      try {
        const response = await readPostAction(text, courseId === "" ? null : courseId);
        if (!response.success) return void setError(response.error.message);
        const { rows: found, courseId: detected, engine } = response.data;
        if (detected && courseId === "") setCourseId(detected);
        if (found.length === 0) {
          setStatus("No work with a date found in that post. Add the task by hand, or paste only the part that sets it.");
          return;
        }
        setRows(found.map((row, key) => ({ key, on: !row.existing, title: row.title, dueDate: row.dueDate ?? "", quote: row.quote, existing: row.existing })));
        setStatus(`Found ${found.length} ${found.length === 1 ? "task" : "tasks"}${engine === "rules" ? " (read by rules; the assistant was not used)" : ""}. Nothing is saved until you add them. Check each against the sentence it came from.`);
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

  function add() {
    if (busy.current || !rows) return;
    if (ticked.some((row) => row.title.trim() === "")) return void setError("Every task needs a name.");
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await addPostTasksAction(
          ticked.map((row) => ({
            title: row.title.trim(),
            dueDate: row.dueDate === "" ? null : row.dueDate,
            courseId: courseId === "" ? null : courseId,
            note: `From a pasted post: “${row.quote}”`.slice(0, 500),
          })),
        );
        if (!response.success) return void setError(response.error.message);
        const n = response.data.created;
        setRows(null);
        setText("");
        setStatus(`Added ${n} ${n === 1 ? "task" : "tasks"}.`);
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <details className="mt-4 rounded-xl border border-border-subtle bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold text-text">Add from a teacher&rsquo;s post</summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-t`} className="text-[13px] font-semibold text-text">Paste the post</label>
          <textarea id={`${id}-t`} value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={MAX_POST_CHARS} placeholder="Paste a post from Teams, Classroom or an email" className={`${FIELD} py-2`} />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${id}-c`} className="text-[13px] font-semibold text-text">Course</label>
            <select id={`${id}-c`} value={courseId} onChange={(event) => setCourseId(event.target.value)} className={FIELD}>
              <option value="">No course</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
            </select>
          </div>
          <button type="button" onClick={read} disabled={pending || text.trim() === ""} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>
            {reading ? "Reading…" : "Find tasks"}
          </button>
        </div>
        <p role="status" className="text-[13px] text-text-muted empty:hidden">{status}</p>
        {rows && (
          <div className="flex flex-col gap-3">
            <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
              {rows.map((row, index) => (
                <li key={row.key} className="flex flex-col gap-2 px-3 py-3 sm:grid sm:grid-cols-[2rem_minmax(0,1.4fr)_9.5rem_minmax(0,1.6fr)] sm:items-center sm:gap-3">
                  <input type="checkbox" checked={row.on} onChange={(event) => update(row.key, { on: event.target.checked })} className="h-5 w-5 accent-[var(--accent)]" aria-label={`Add row ${index + 1}`} />
                  <input value={row.title} onChange={(event) => update(row.key, { title: event.target.value })} maxLength={120} aria-label={`Name, row ${index + 1}`} className={FIELD} />
                  <input type="date" value={row.dueDate} onChange={(event) => update(row.key, { dueDate: event.target.value })} aria-label={`Due date, row ${index + 1}`} className={FIELD} />
                  <div className="min-w-0 text-xs text-text-muted">
                    <p className="break-words">“{row.quote}”</p>
                    {row.existing && <p className="mt-1 font-semibold text-warn">You already have this task{row.on ? "." : ", so it is not ticked."}</p>}
                    {row.dueDate === "" && <p className="mt-1">No date read; add one if you want it on your list by day.</p>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={add} disabled={pending || ticked.length === 0} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>
                {pending && !reading ? "Adding…" : `Add ${ticked.length} ${ticked.length === 1 ? "task" : "tasks"}`}
              </button>
              <button type="button" disabled={pending} onClick={() => { setRows(null); setStatus(""); setError(null); }} className={`${BUTTON} border border-border-strong text-text hover:bg-surface-subtle`}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-[13px] font-semibold text-danger">{error}</p>}
        <p className="text-xs text-text-muted">Dates are read from the sentence by rules, not by the assistant, and nothing is added without Add. Only what you paste is read.</p>
      </div>
    </details>
  );
}
