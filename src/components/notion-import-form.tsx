"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ApiResponse } from "@/lib/api-response";
import type { NotionImportReport } from "@/services/notion-service";
import type { DatabaseChoice } from "@/lib/notion";

const SHOWN = 10;
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

type Phase =
  | { name: "idle" }
  | { name: "working"; mode: "preview" | "apply" }
  | { name: "previewed"; report: NotionImportReport }
  | { name: "done"; report: NotionImportReport }
  | { name: "failed"; message: string };

const primary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-control px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60";

const TARGET_TEXT: Record<NotionImportReport["databases"][number]["target"], string> = {
  existing: "uses the one you already have with this name",
  new: "will be made",
  none: "rows come in as plain notes",
  ambiguous: "you have more than one with this name, so rows come in as plain notes",
};

function More({ total }: { total: number }) {
  return total > SHOWN ? <li className="text-text-muted">…and {(total - SHOWN).toLocaleString("en-US")} more</li> : null;
}

function Findings({ report }: { report: NotionImportReport }) {
  const { notes, links, attachments } = report;
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text">
      {!report.apply && notes.create > 0 && (
        <li>
          Would add <strong>{plural(notes.create, "note", "notes")}</strong>.
        </li>
      )}
      {notes.present > 0 && <li>{plural(notes.present, "page is", "pages are")} already in your notes (the same title and the same text), so left alone.</li>}
      {notes.renamed.length > 0 && (
        <li>
          {plural(notes.renamed.length, "note comes", "notes come")} in under a new title, because you already have a different note with that title:
          <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
            {notes.renamed.slice(0, SHOWN).map((r, i) => (
              <li key={i} className="break-words">
                “{r.from}” as “{r.to}”
              </li>
            ))}
            <More total={notes.renamed.length} />
          </ul>
        </li>
      )}
      {notes.deferred > 0 && <li>{plural(notes.deferred, "more note is", "more notes are")} left for the next run: one run adds at most 500 notes. Import the same file again; nothing is added twice.</li>}
      {notes.failed > 0 && <li>{plural(notes.failed, "note could", "notes could")} not be saved. Importing the same file again tries them again.</li>}
      {links.converted > 0 && (
        <li>
          {plural(links.converted, "link to another page became", "links to other pages became")} <code className="font-mono">[[wiki links]]</code>.
        </li>
      )}
      {links.unresolved > 0 && <li>{plural(links.unresolved, "link points", "links point")} at something that is not in the export, so only its words are kept.</li>}
      {attachments.stored > 0 && (
        <li>
          {report.apply ? "Stored" : "Would store"} <strong>{plural(attachments.stored, "file", "files")}</strong> as attachments of the notes that use them.
        </li>
      )}
      {attachments.rejected.length > 0 && (
        <li>
          {plural(attachments.rejectedTotal, "file is", "files are")} not attached:
          <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
            {attachments.rejected.slice(0, SHOWN).map((r, i) => (
              <li key={i} className="break-words">
                {r.name}: {r.reason}
              </li>
            ))}
            <More total={attachments.rejectedTotal} />
          </ul>
        </li>
      )}
      {report.made.projects.length + report.made.courses.length > 0 && (
        <li>
          {report.apply ? "Made" : "Would make"}{" "}
          {[...report.made.projects.map((name) => `the project “${name}”`), ...report.made.courses.map((name) => `the course “${name}”`)].join(", ")}.
        </li>
      )}
      {report.skippedTotal > 0 && (
        <li>
          {plural(report.skippedTotal, "file is", "files are")} skipped:
          <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
            {report.skipped.slice(0, SHOWN).map((s, i) => (
              <li key={i} className="break-words">
                {s.path}: {s.reason}
              </li>
            ))}
            <More total={report.skippedTotal} />
          </ul>
        </li>
      )}
      {report.ignored > 0 && <li>{plural(report.ignored, "other file is", "other files are")} ignored (folders and system files).</li>}
    </ul>
  );
}

export function NotionImportForm() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [choices, setChoices] = useState<Record<string, DatabaseChoice>>({});
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (phase.name === "previewed" || phase.name === "done") result.current?.focus();
    if (phase.name === "failed") alert.current?.focus();
  }, [phase.name]);

  async function send(mode: "preview" | "apply", picked: Record<string, DatabaseChoice> = choices) {
    if (!file || busy.current) return;
    busy.current = true;
    setPhase({ name: "working", mode });
    try {
      const query = new URLSearchParams({ mode });
      for (const [id, choice] of Object.entries(picked)) query.append("db", `${id}:${choice}`);
      const response = await fetch(`/api/import/notion?${query}`, { method: "POST", body: file, headers: { "Content-Type": "application/zip" } });
      const body = (await response.json()) as ApiResponse<NotionImportReport>;
      if (!body.success) setPhase({ name: "failed", message: body.error.message });
      else setPhase(mode === "preview" ? { name: "previewed", report: body.data } : { name: "done", report: body.data });
    } catch {
      setPhase({
        name: "failed",
        message:
          mode === "apply"
            ? "The connection was lost. Some pages may already have been imported: choose the same file and check it again to see what is left. Nothing is added twice."
            : "Could not reach the server. Try again.",
      });
    } finally {
      busy.current = false;
    }
  }

  function chooseAnother() {
    setFile(null);
    setChoices({});
    setPhase({ name: "idle" });
    if (input.current) input.current.value = "";
    input.current?.focus();
  }

  const working = phase.name === "working";
  const previewed = phase.name === "previewed" ? phase.report : null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-text">Notion export (zip)</span>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          aria-label="Notion export"
          disabled={working}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setChoices({});
            setPhase({ name: "idle" });
          }}
          className="w-full rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
        />
      </label>

      {(phase.name === "idle" || (working && phase.mode === "preview")) && (
        <div>
          <button type="button" onClick={() => send("preview")} disabled={!file || working} className={primary}>
            {working ? "Checking…" : "Check the Notion export"}
          </button>
          <p className="mt-2 text-xs text-text-muted">Nothing is saved by checking: you see what an import would do first.</p>
        </div>
      )}

      <div ref={result} role="group" aria-label="Notion import result" aria-live="polite" tabIndex={-1} className="-m-2 rounded-lg p-2 outline-none">
        {previewed && (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium text-text">{previewed.notes.create > 0 ? "This is what importing would do." : "There is nothing new to import."}</p>
            {previewed.databases.length > 0 && (
              <fieldset className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                <legend className="px-1 text-sm font-medium text-text">Databases in this export</legend>
                {previewed.databases.map((db) => (
                  <div key={db.id} className="flex flex-col gap-1.5 text-sm">
                    <label htmlFor={`db-${db.id}`} className="break-words font-medium text-text">
                      “{db.name}” ({plural(db.rows, "row", "rows")}) becomes
                    </label>
                    <select
                      id={`db-${db.id}`}
                      value={choices[db.id] ?? db.choice}
                      disabled={working}
                      onChange={(event) => {
                        const next = { ...choices, [db.id]: event.target.value as DatabaseChoice };
                        setChoices(next);
                        void send("preview", next);
                      }}
                      className="min-h-11 w-full min-w-0 max-w-full rounded-lg border border-control bg-surface px-3 text-sm text-text"
                    >
                      <option value="project">a project</option>
                      <option value="course">a course</option>
                      <option value="none">nothing: just notes</option>
                    </select>
                    <p className="text-xs text-text-muted">{TARGET_TEXT[db.target]}</p>
                  </div>
                ))}
              </fieldset>
            )}
            <Findings report={previewed} />
          </div>
        )}
        {phase.name === "done" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">Imported {plural(phase.report.notes.created, "note", "notes")}.</p>
            <Findings report={phase.report} />
            <p className="text-sm text-text-muted">
              If search does not find them yet, rebuild the search index in{" "}
              <Link href="/settings" className="text-accent hover:underline">
                Settings
              </Link>
              .
            </p>
          </div>
        )}
        {working && phase.mode === "apply" && <p className="text-sm text-text-muted">Importing… this can take a while for a large export.</p>}
      </div>

      {phase.name === "failed" && (
        <p ref={alert} role="group" aria-label="Notion import problem" aria-live="assertive" tabIndex={-1} className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger outline-none">
          {phase.message}
        </p>
      )}

      {(phase.name === "previewed" || (working && phase.mode === "apply")) && (
        <div className="flex flex-wrap gap-2">
          {previewed && previewed.notes.create > 0 && (
            <button type="button" onClick={() => send("apply")} disabled={working} className={primary}>
              Import {plural(previewed.notes.create, "note", "notes")} from Notion
            </button>
          )}
          {working && (
            <button type="button" disabled className={primary}>
              Importing…
            </button>
          )}
          <button type="button" onClick={chooseAnother} disabled={working} className={quiet}>
            Choose another file
          </button>
        </div>
      )}
      {phase.name === "done" && (
        <div className="flex flex-wrap gap-2">
          <Link href="/notes" className={primary}>
            Open notes
          </Link>
          <button type="button" onClick={chooseAnother} className={quiet}>
            Import another file
          </button>
        </div>
      )}
      {phase.name === "failed" && (
        <div>
          <button type="button" onClick={chooseAnother} className={quiet}>
            Choose another file
          </button>
        </div>
      )}
    </div>
  );
}
