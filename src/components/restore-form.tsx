"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiResponse } from "@/lib/api-response";
import type { RestoreReport } from "@/services/restore-service";
import { RESTORE_KINDS, type RestoreKind } from "@/lib/restore";

const SHOWN = 10;

const LABEL: Record<RestoreKind, [string, string]> = {
  courses: ["course", "courses"],
  goals: ["goal", "goals"],
  projects: ["project", "projects"],
  assessments: ["grade or exam", "grades and exams"],
  notes: ["note", "notes"],
  tasks: ["task", "tasks"],
  checklistItems: ["checklist step", "checklist steps"],
  events: ["event", "events"],
  references: ["reference", "references"],
  weeklyGoals: ["weekly goal", "weekly goals"],
  flashcards: ["flashcard", "flashcards"],
};

type Phase =
  | { name: "idle" }
  | { name: "working"; mode: "preview" | "apply" }
  | { name: "previewed"; report: RestoreReport }
  | { name: "done"; report: RestoreReport }
  | { name: "failed"; message: string };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const count = (n: number, kind: RestoreKind) => `${n.toLocaleString("en-US")} ${LABEL[kind][n === 1 ? 0 : 1]}`;

/** What would be (or was) added. Zero when the file holds nothing new. */
const toCreate = (report: RestoreReport) => RESTORE_KINDS.reduce((sum, kind) => sum + (report.apply ? report.kinds[kind].created : report.kinds[kind].create), 0);

function Findings({ report }: { report: RestoreReport }) {
  const verb = report.apply ? "Added" : "Would add";
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text">
      {RESTORE_KINDS.map((kind) => {
        const k = report.kinds[kind];
        const added = report.apply ? k.created : k.create;
        const lines: string[] = [];
        if (added > 0) lines.push(`${verb} ${count(added, kind)}.`);
        if (k.present > 0) lines.push(`${count(k.present, kind)} already here, left alone.`);
        if (k.unlinked > 0) lines.push(`${k.unlinked.toLocaleString("en-US")} ${k.unlinked === 1 ? "link" : "links"} from ${LABEL[kind][1]} to a project, course, goal or note cannot be kept: what ${k.unlinked === 1 ? "it points" : "they point"} at is not in the file or in your account.`);
        if (k.deferred > 0) lines.push(`${count(k.deferred, kind)} wait for the next run, because the notes they belong to do.`);
        if (k.invalid > 0) lines.push(`${count(k.invalid, kind)} skipped: not valid, or the thing they belong to is missing.`);
        return lines.map((line) => <li key={`${kind}-${line}`}>{line}</li>);
      })}
      {report.renamed.length > 0 && (
        <li>
          {report.renamed.length} note{report.renamed.length === 1 ? " comes" : "s come"} in under a new title, because you already have a different note with that title:
          <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
            {report.renamed.slice(0, SHOWN).map((r, i) => (
              <li key={i} className="break-words">
                “{r.from}” as “{r.to}”
              </li>
            ))}
            {report.renamed.length > SHOWN && <li className="text-text-muted">…and {report.renamed.length - SHOWN} more</li>}
          </ul>
        </li>
      )}
      {report.lockedNotes > 0 && <li>{plural(report.lockedNotes, "locked note is", "locked notes are")} not restored: {report.lockedNotes === 1 ? "its" : "their"} text is encrypted for the place {report.lockedNotes === 1 ? "it was" : "they were"} made and cannot be opened here. A database backup keeps {report.lockedNotes === 1 ? "it" : "them"}.</li>}
      {report.fromFeed > 0 && <li>{plural(report.fromFeed, "imported calendar event is", "imported calendar events are")} not restored: add the calendar feed again and {report.fromFeed === 1 ? "it comes" : "they come"} back.</li>}
      {report.invalidTotal > 0 && <li>{plural(report.invalidTotal, "row", "rows")} could not be read and {report.invalidTotal === 1 ? "was" : "were"} skipped.</li>}
      {report.overCap > 0 && <li>{plural(report.overCap, "row is", "rows are")} beyond what one file restores and {report.overCap === 1 ? "was" : "were"} left.</li>}
      {report.failed > 0 && <li>{plural(report.failed, "row", "rows")} could not be saved. Restoring the same file again tries them again.</li>}
    </ul>
  );
}

const primary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-control px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60";

/** Restore from the JSON export: choose, check (nothing is saved), then restore. The same file is posted twice. */
export function RestoreForm({ notRestored }: { notRestored: string[] }) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (phase.name === "previewed" || phase.name === "done") result.current?.focus();
    if (phase.name === "failed") alert.current?.focus();
  }, [phase.name]);

  async function send(mode: "preview" | "apply") {
    if (!file || busy.current) return;
    busy.current = true;
    setPhase({ name: "working", mode });
    try {
      const response = await fetch(`/api/import/json?mode=${mode}`, { method: "POST", body: file, headers: { "Content-Type": "application/json" } });
      const body = (await response.json()) as ApiResponse<RestoreReport>;
      if (!body.success) setPhase({ name: "failed", message: body.error.message });
      else setPhase(mode === "preview" ? { name: "previewed", report: body.data } : { name: "done", report: body.data });
    } catch {
      setPhase({
        name: "failed",
        message:
          mode === "apply"
            ? "The connection was lost. Some rows may already have been restored: choose the same file and check it again to see what is left. Nothing is added twice."
            : "Could not reach the server. Try again.",
      });
    } finally {
      busy.current = false;
    }
  }

  function chooseAnother() {
    setFile(null);
    setPhase({ name: "idle" });
    if (input.current) input.current.value = "";
    input.current?.focus();
  }

  const working = phase.name === "working";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-text">Export file (JSON)</span>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          aria-label="Export file"
          disabled={working}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPhase({ name: "idle" });
          }}
          className="w-full rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
        />
      </label>

      {(phase.name === "idle" || (working && phase.mode === "preview")) && (
        <div>
          <button type="button" onClick={() => send("preview")} disabled={!file || working} className={primary}>
            {working ? "Checking…" : "Check the file"}
          </button>
          <p className="mt-2 text-xs text-text-muted">
            Nothing is saved by checking. A restore only adds: what you already have is never changed or deleted, and restoring the same file twice adds nothing.
          </p>
        </div>
      )}

      <div ref={result} role="group" aria-label="Restore result" aria-live="polite" tabIndex={-1} className="-m-2 rounded-lg p-2 outline-none">
        {phase.name === "previewed" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">{toCreate(phase.report) > 0 ? "This is what restoring would do." : "There is nothing new to restore."}</p>
            <Findings report={phase.report} />
          </div>
        )}
        {phase.name === "done" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">Restored {toCreate(phase.report).toLocaleString("en-US")} items.</p>
            <Findings report={phase.report} />
            <p className="text-sm text-text-muted">
              Tasks, events and cards are not in semantic search until you rebuild the search index below.
            </p>
          </div>
        )}
        {working && phase.mode === "apply" && <p className="text-sm text-text-muted">Restoring… this can take a while for a large file.</p>}
      </div>

      {phase.name === "failed" && (
        <p ref={alert} role="group" aria-label="Restore problem" aria-live="assertive" tabIndex={-1} className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger outline-none">
          {phase.message}
        </p>
      )}

      {(phase.name === "previewed" || (working && phase.mode === "apply")) && (
        <div className="flex flex-wrap gap-2">
          {phase.name === "previewed" && toCreate(phase.report) > 0 && (
            <button type="button" onClick={() => send("apply")} className={primary}>
              Restore {toCreate(phase.report).toLocaleString("en-US")} items
            </button>
          )}
          {working && (
            <button type="button" disabled className={primary}>
              Restoring…
            </button>
          )}
          <button type="button" onClick={chooseAnother} disabled={working} className={quiet}>
            Choose another file
          </button>
        </div>
      )}
      {(phase.name === "done" || phase.name === "failed") && (
        <div>
          <button type="button" onClick={chooseAnother} className={quiet}>
            Choose another file
          </button>
        </div>
      )}

      <details className="text-xs text-text-muted">
        <summary className="cursor-pointer font-medium text-text">What a restore does not bring back</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          {notRestored.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
